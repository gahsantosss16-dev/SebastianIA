import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../core/logger.js';
import { ComfyStudioEngine, type ComfyWorkflowGenerator, type StudioClipComposer } from '../studio/ComfyStudioEngine.js';
import { StudioRenderJobs, UnavailableStudioEngine, type StudioRenderEngine } from '../studio/StudioRenderJobs.js';

/**
 * Wires the Studio render engine from environment variables. Nothing paid or
 * remote: the model runs in a local ComfyUI the renderer work configures.
 *
 *   STUDIO_COMFYUI_URL                 e.g. http://127.0.0.1:8188 (loopback only)
 *   STUDIO_COMFYUI_WORKFLOW_PATH       ComfyUI API-format workflow with {{placeholders}}
 *   STUDIO_COMFYUI_FPS                 optional, default 16
 *   STUDIO_COMFYUI_MAX_CLIP_SECONDS    optional, default 5
 *   STUDIO_COMFYUI_SCENE_TIMEOUT_MS    optional, default 900000 (15 min per scene)
 *
 * Any missing piece yields an engine that reports exactly what is missing.
 */

export const STUDIO_GENERATOR_MODULE = '../studio/ComfyVideoProvider.js';

export interface StudioEngineDependencies {
  /** Loads the ComfyUI client. Default: the Work's studio/ComfyVideoProvider.ts, loaded at runtime. */
  readonly loadGenerator?: (baseUrl: string, timeoutMs: number) => Promise<ComfyWorkflowGenerator>;
  /** Final composition (narration, lines, captions, scene join). Provided by the renderer work. */
  readonly composer?: StudioClipComposer;
  readonly fetchImpl?: typeof fetch;
}

export async function createConfiguredStudioEngine(env: NodeJS.ProcessEnv, logger: Logger, dependencies: StudioEngineDependencies = {}): Promise<StudioRenderEngine> {
  const baseUrl = env.STUDIO_COMFYUI_URL?.trim();
  const workflowPath = env.STUDIO_COMFYUI_WORKFLOW_PATH?.trim();
  if (!baseUrl || !workflowPath) {
    return new UnavailableStudioEngine('O motor generativo de vídeo ainda não foi configurado neste servidor.');
  }
  try {
    const workflowTemplate = JSON.parse(readFileSync(workflowPath, 'utf8')) as unknown;
    const timeoutMs = positiveInteger(env.STUDIO_COMFYUI_SCENE_TIMEOUT_MS, 900_000);
    const generator = await (dependencies.loadGenerator ?? loadWorkGenerator)(baseUrl, timeoutMs);
    const engine = new ComfyStudioEngine({
      baseUrl,
      generator,
      workflowTemplate,
      fps: positiveInteger(env.STUDIO_COMFYUI_FPS, 16),
      maxClipSeconds: positiveInteger(env.STUDIO_COMFYUI_MAX_CLIP_SECONDS, 5),
      ...(dependencies.composer ? { composer: dependencies.composer } : {}),
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
    });
    logger.info('Studio render engine configured.', { engine: engine.id, composer: dependencies.composer?.id ?? 'none' });
    return engine;
  } catch (error) {
    logger.warn('Studio render engine configuration failed.', { message: error instanceof Error ? error.message : String(error) });
    return new UnavailableStudioEngine('A configuração do motor generativo de vídeo está incompleta ou inválida. Consulte os logs do servidor.');
  }
}

export async function createConfiguredStudioRenderJobs(dataDir: string, env: NodeJS.ProcessEnv, logger: Logger, dependencies: StudioEngineDependencies = {}): Promise<StudioRenderJobs> {
  return new StudioRenderJobs({
    outputDirectory: join(dataDir, 'studio-renders'),
    engine: await createConfiguredStudioEngine(env, logger, dependencies),
    logger,
  });
}

/** Loaded by path at runtime so this branch does not depend on the Work's module being merged first. */
async function loadWorkGenerator(baseUrl: string, timeoutMs: number): Promise<ComfyWorkflowGenerator> {
  const specifier: string = STUDIO_GENERATOR_MODULE;
  const module = (await import(specifier)) as { ComfyVideoProvider?: new (options: { baseUrl: string; timeoutMs?: number }) => ComfyWorkflowGenerator };
  if (typeof module.ComfyVideoProvider !== 'function') throw new Error('ComfyVideoProvider not found');
  return new module.ComfyVideoProvider({ baseUrl, timeoutMs });
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid positive integer: ${raw}`);
  return value;
}
