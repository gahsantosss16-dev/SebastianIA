import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StudioAspectRatio, StudioProductionPlan, StudioScene, StudioVisualStyle } from './VideoProductionPlan.js';
import {
  StudioEngineError,
  type StudioEngineAvailability,
  type StudioEngineRenderRequest,
  type StudioRenderEngine,
} from './StudioRenderJobs.js';

/**
 * Studio render engine backed by a self-hosted ComfyUI video model.
 *
 * Split of responsibilities with the renderer work:
 * - workflow template (which model, sampler, resolution limits): the Work.
 *   A ComfyUI API-format JSON where placeholders such as "{{positive_prompt}}"
 *   are filled per scene (see STUDIO_WORKFLOW_PLACEHOLDERS).
 * - generator: anything with generate(workflow, signal) -> video bytes
 *   (studio/ComfyVideoProvider.ts from the Work fits this shape).
 * - composer: joins the scene clips into the final MP4 with pt-BR narration,
 *   lines and captions (the Work's FFmpeg/TTS side). Without it the engine
 *   reports itself unavailable: shipping clips without the dialogue would
 *   silently drop the story's lines.
 * This module owns the plan -> per-scene prompt mapping, progress, the
 * consistent seed across scenes and real cancellation (ComfyUI /interrupt).
 */

export interface ComfyWorkflowGenerator {
  generate(workflow: Record<string, unknown>, signal?: AbortSignal): Promise<{ readonly bytes: Uint8Array; readonly filename: string; readonly mimeType: string }>;
}

export interface StudioSceneClip {
  readonly sceneId: string;
  readonly order: number;
  readonly path: string;
  readonly mimeType: string;
  /** Scene length in the plan; the composer holds/extends the clip to it. */
  readonly targetSeconds: number;
  /** Length requested from the model (bounded by maxClipSeconds). */
  readonly generatedSeconds: number;
  readonly prompt: string;
}

export interface StudioClipComposeRequest {
  readonly plan: StudioProductionPlan;
  readonly clips: readonly StudioSceneClip[];
  readonly outputPath: string;
  readonly workDirectory: string;
  readonly signal: AbortSignal;
}

export interface StudioClipComposer {
  readonly id: string;
  compose(request: StudioClipComposeRequest): Promise<void>;
}

export const STUDIO_WORKFLOW_PLACEHOLDERS = [
  'positive_prompt', 'negative_prompt', 'width', 'height', 'fps', 'frames', 'seed', 'duration_seconds', 'scene_id', 'filename_prefix',
] as const;
type Placeholder = (typeof STUDIO_WORKFLOW_PLACEHOLDERS)[number];

const STYLE_PROMPTS: Readonly<Record<StudioVisualStyle, string>> = {
  '3d_cartoon': '3D animated cartoon, stylized expressive characters, soft global illumination, vibrant colors',
  cinematic: 'cinematic 3D animation, dramatic lighting, shallow depth of field, film camera framing',
  anime: '3D anime style animation, cel-shaded characters, clean outlines',
};

export const DEFAULT_STUDIO_DIMENSIONS: Readonly<Record<StudioAspectRatio, { readonly width: number; readonly height: number }>> = {
  '9:16': { width: 480, height: 832 },
  '16:9': { width: 832, height: 480 },
  '1:1': { width: 640, height: 640 },
};

const DEFAULT_NEGATIVE_PROMPT = 'live action, photo, blurry, distorted faces, extra limbs, text, watermark, flicker';

export interface ComfyStudioEngineOptions {
  readonly baseUrl: string;
  readonly generator: ComfyWorkflowGenerator;
  readonly workflowTemplate: unknown;
  readonly composer?: StudioClipComposer;
  readonly fps?: number;
  readonly maxClipSeconds?: number;
  readonly negativePrompt?: string;
  readonly dimensions?: Readonly<Record<StudioAspectRatio, { readonly width: number; readonly height: number }>>;
  readonly fetchImpl?: typeof fetch;
  readonly probeTimeoutMs?: number;
}

export class ComfyStudioEngine implements StudioRenderEngine {
  public readonly id = 'ComfyUI';
  private readonly base: URL;
  private readonly template: Record<string, unknown>;
  private readonly fps: number;
  private readonly maxClipSeconds: number;
  private readonly fetcher: typeof fetch;

  public constructor(private readonly options: ComfyStudioEngineOptions) {
    this.base = loopbackUrl(options.baseUrl);
    this.template = validateWorkflowTemplate(options.workflowTemplate);
    this.fps = options.fps ?? 16;
    this.maxClipSeconds = options.maxClipSeconds ?? 5;
    if (!Number.isInteger(this.fps) || this.fps < 1 || this.fps > 60) throw new StudioEngineError('FPS do motor inválido.');
    if (!Number.isInteger(this.maxClipSeconds) || this.maxClipSeconds < 1 || this.maxClipSeconds > 60) throw new StudioEngineError('Duração máxima de clipe inválida.');
    this.fetcher = options.fetchImpl ?? fetch;
  }

  public async availability(): Promise<StudioEngineAvailability> {
    if (!this.options.composer) {
      return {
        available: false,
        engine: this.id,
        message: 'O modelo de vídeo está configurado, mas a composição final (narração pt-BR, falas, legendas e junção das cenas) ainda não foi conectada.',
        estimatedCostUsd: 0,
      };
    }
    try {
      const response = await this.fetcher(new URL('system_stats', this.base), { signal: AbortSignal.timeout(this.options.probeTimeoutMs ?? 3000) });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      return { available: false, engine: this.id, message: 'O ComfyUI local não respondeu. Verifique se o serviço do modelo de vídeo está em execução.', estimatedCostUsd: 0 };
    }
    return { available: true, engine: this.id, estimatedCostUsd: 0 };
  }

  public async render(request: StudioEngineRenderRequest): Promise<void> {
    const composer = this.options.composer;
    if (!composer) throw new StudioEngineError('A composição final do vídeo ainda não foi configurada.');
    const { plan, signal } = request;
    const total = plan.scenes.length + 1;
    const seed = consistentSeed(request.jobId);
    const clips: StudioSceneClip[] = [];
    const interrupt = (): void => { void this.interrupt(); };
    signal.addEventListener('abort', interrupt, { once: true });
    try {
      for (const [index, scene] of plan.scenes.entries()) {
        if (signal.aborted) throw new StudioEngineError('Renderização cancelada.');
        request.report({ stage: `Gerando a cena ${index + 1} de ${plan.scenes.length} no modelo de vídeo`, progress: index / total });
        const generatedSeconds = Math.min(scene.durationSeconds, this.maxClipSeconds);
        const prompt = buildScenePrompt(plan, scene);
        const workflow = fillWorkflowTemplate(this.template, this.sceneValues(plan, scene, prompt, generatedSeconds, seed, request.jobId));
        let output;
        try {
          output = await this.options.generator.generate(workflow, signal);
        } catch (error) {
          if (signal.aborted) throw new StudioEngineError('Renderização cancelada.');
          throw new StudioEngineError(`O modelo de vídeo falhou na cena ${index + 1}: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
        }
        const extension = output.mimeType === 'video/webm' ? 'webm' : 'mp4';
        const path = join(request.workDirectory, `scene-${String(scene.order).padStart(2, '0')}.${extension}`);
        await writeFile(path, output.bytes);
        clips.push({ sceneId: scene.id, order: scene.order, path, mimeType: output.mimeType, targetSeconds: scene.durationSeconds, generatedSeconds, prompt });
      }
      if (signal.aborted) throw new StudioEngineError('Renderização cancelada.');
      request.report({ stage: 'Compondo o vídeo final: narração, falas, legendas e junção das cenas', progress: plan.scenes.length / total });
      await composer.compose({ plan, clips, outputPath: request.outputPath, workDirectory: request.workDirectory, signal });
    } finally {
      signal.removeEventListener('abort', interrupt);
    }
  }

  /** Stops the generation running on the GPU (Studio jobs run one at a time). */
  private async interrupt(): Promise<void> {
    try {
      const response = await this.fetcher(new URL('interrupt', this.base), { method: 'POST', signal: AbortSignal.timeout(5000) });
      await response.body?.cancel();
    } catch {
      // Best effort: the aborted request already stops waiting for the result.
    }
  }

  private sceneValues(plan: StudioProductionPlan, scene: StudioScene, prompt: string, seconds: number, seed: number, jobId: string): Readonly<Record<Placeholder, string | number>> {
    const size = (this.options.dimensions ?? DEFAULT_STUDIO_DIMENSIONS)[plan.format];
    return {
      positive_prompt: prompt,
      negative_prompt: this.options.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT,
      width: size.width,
      height: size.height,
      fps: this.fps,
      // Common video-model convention (e.g. 81 frames for 5 s at 16 fps).
      frames: seconds * this.fps + 1,
      seed,
      duration_seconds: seconds,
      scene_id: scene.id,
      filename_prefix: `sebastian-studio/${jobId}/${scene.id}`,
    };
  }
}

/** Visual prompt for one scene: style, scene action and the fixed look of every character on screen. */
export function buildScenePrompt(plan: StudioProductionPlan, scene: StudioScene): string {
  const onScreen = scene.characterIds
    .filter((id) => id !== 'narrador')
    .map((id) => plan.characters.find((character) => character.id === id))
    .filter((character): character is NonNullable<typeof character> => character !== undefined)
    .map((character) => `${character.name}: ${character.visualDescription}`);
  return [
    STYLE_PROMPTS[plan.style],
    scene.visualPrompt,
    onScreen.length ? `Personagens em cena (aparência fixa em todas as cenas): ${onScreen.join('; ')}` : '',
    `Título da história: ${plan.title}`,
  ].filter(Boolean).join('. ');
}

/** Replaces "{{name}}" placeholders. A string that is exactly one placeholder keeps the value's type. */
export function fillWorkflowTemplate(template: Record<string, unknown>, values: Readonly<Record<Placeholder, string | number>>): Record<string, unknown> {
  const fill = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const exact = /^\{\{([a-z_]+)\}\}$/.exec(node);
      if (exact) return valueOf(exact[1] ?? '');
      return node.replace(/\{\{([a-z_]+)\}\}/g, (_, name: string) => String(valueOf(name)));
    }
    if (Array.isArray(node)) return node.map(fill);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, fill(child)]));
    return node;
  };
  const valueOf = (name: string): string | number => {
    if (!(STUDIO_WORKFLOW_PLACEHOLDERS as readonly string[]).includes(name)) throw new StudioEngineError(`Placeholder desconhecido no workflow: {{${name}}}`);
    return values[name as Placeholder];
  };
  return fill(template) as Record<string, unknown>;
}

export function validateWorkflowTemplate(template: unknown): Record<string, unknown> {
  if (!template || typeof template !== 'object' || Array.isArray(template) || Object.keys(template).length === 0) {
    throw new StudioEngineError('O workflow do ComfyUI precisa ser um objeto JSON no formato da API.');
  }
  const text = JSON.stringify(template);
  if (!text.includes('{{positive_prompt}}')) throw new StudioEngineError('O workflow do ComfyUI precisa conter o placeholder {{positive_prompt}}.');
  for (const match of text.matchAll(/\{\{([a-z_]+)\}\}/g)) {
    if (!(STUDIO_WORKFLOW_PLACEHOLDERS as readonly string[]).includes(match[1] ?? '')) throw new StudioEngineError(`Placeholder desconhecido no workflow: {{${match[1]}}}`);
  }
  return template as Record<string, unknown>;
}

/** Same seed for every scene of a job keeps characters and look consistent. */
function consistentSeed(jobId: string): number {
  return createHash('sha256').update(jobId).digest().readUInt32BE(0) % 2_147_483_647;
}

function loopbackUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw.endsWith('/') ? raw : `${raw}/`); } catch { throw new StudioEngineError('Endereço do ComfyUI inválido.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new StudioEngineError('O ComfyUI precisa rodar neste servidor (localhost), sem credenciais na URL.');
  }
  return url;
}
