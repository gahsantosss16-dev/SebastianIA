import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Logger } from '../core/logger.js';
import { ComfyStudioEngine, type ComfyWorkflowGenerator, type StudioClipComposer } from '../studio/ComfyStudioEngine.js';
import { RemoteStudioEngine } from '../studio/RemoteStudioEngine.js';
import { StudioRenderJobs, UnavailableStudioEngine, type StudioRenderEngine } from '../studio/StudioRenderJobs.js';

/**
 * Wires the Studio render engine from environment variables. Nothing paid:
 * the model runs in a ComfyUI the renderer work configures, on a machine
 * with a GPU.
 *
 * Web app (Hostinger) with a remote GPU machine:
 *   STUDIO_WORKER_TOKEN                shared secret (>= 32 chars) of the GPU worker
 *   STUDIO_WORKER_MAX_RESULT_MB        optional, default 512
 *
 * GPU machine (worker, application/studio-worker.ts) or single machine:
 *   STUDIO_COMFYUI_URL                 e.g. http://127.0.0.1:8188 (loopback only)
 *   STUDIO_COMFYUI_WORKFLOW_PATH       ComfyUI API-format workflow with {{placeholders}}
 *   STUDIO_COMPOSER_MODULE             module exporting createStudioComposer(env) (the Work's composer)
 *   STUDIO_COMFYUI_FPS / _MAX_CLIP_SECONDS / _SCENE_TIMEOUT_MS   optional (16 / 5 / 900000)
 *
 * Limits (web app): STUDIO_MAX_JOBS_PER_DAY (20), STUDIO_RENDER_RETENTION_DAYS (7).
 * Any missing piece yields an engine that reports exactly what is missing.
 */

export const STUDIO_GENERATOR_MODULE = '../studio/ComfyVideoProvider.js';

export interface StudioEngineDependencies {
  /** Loads the ComfyUI client. Default: the Work's studio/ComfyVideoProvider.ts, loaded at runtime. */
  readonly loadGenerator?: (baseUrl: string, timeoutMs: number) => Promise<ComfyWorkflowGenerator>;
  /** Final composition (narration, lines, captions, scene join). Default: STUDIO_COMPOSER_MODULE. */
  readonly composer?: StudioClipComposer;
  readonly fetchImpl?: typeof fetch;
}

/** The engine that renders on this machine (single machine, or the GPU worker). */
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
    const composer = dependencies.composer ?? await loadComposer(env);
    const engine = new ComfyStudioEngine({
      baseUrl,
      generator,
      workflowTemplate,
      fps: positiveInteger(env.STUDIO_COMFYUI_FPS, 16),
      maxClipSeconds: positiveInteger(env.STUDIO_COMFYUI_MAX_CLIP_SECONDS, 5),
      ...(composer ? { composer } : {}),
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
    });
    logger.info('Studio render engine configured.', { engine: engine.id, composer: composer?.id ?? 'none' });
    return engine;
  } catch (error) {
    logger.warn('Studio render engine configuration failed.', { message: error instanceof Error ? error.message : String(error) });
    return new UnavailableStudioEngine('A configuração do motor generativo de vídeo está incompleta ou inválida. Consulte os logs do servidor.');
  }
}

/** The engine of the web app: a remote GPU worker when STUDIO_WORKER_TOKEN is set, otherwise this machine. */
export async function createWebStudioEngine(env: NodeJS.ProcessEnv, logger: Logger, dependencies: StudioEngineDependencies = {}): Promise<StudioRenderEngine> {
  const workerToken = env.STUDIO_WORKER_TOKEN?.trim();
  if (!workerToken) return createConfiguredStudioEngine(env, logger, dependencies);
  try {
    const engine = new RemoteStudioEngine({
      workerToken,
      maxResultBytes: positiveInteger(env.STUDIO_WORKER_MAX_RESULT_MB, 512) * 1024 * 1024,
    });
    logger.info('Studio remote GPU worker engine configured.', {});
    return engine;
  } catch (error) {
    logger.warn('Studio remote GPU worker configuration failed.', { message: error instanceof Error ? error.message : String(error) });
    return new UnavailableStudioEngine('A configuração do processador de GPU remoto está inválida. Consulte os logs do servidor.');
  }
}

export async function createConfiguredStudioRenderJobs(dataDir: string, env: NodeJS.ProcessEnv, logger: Logger, dependencies: StudioEngineDependencies = {}): Promise<StudioRenderJobs> {
  return new StudioRenderJobs({
    outputDirectory: join(dataDir, 'studio-renders'),
    engine: await createWebStudioEngine(env, logger, dependencies),
    logger,
    maxJobsPerDay: positiveInteger(env.STUDIO_MAX_JOBS_PER_DAY, 20),
    retentionDays: positiveInteger(env.STUDIO_RENDER_RETENTION_DAYS, 7),
  });
}

/** Loaded by path at runtime so this branch does not depend on the Work's module being merged first. */
async function loadWorkGenerator(baseUrl: string, timeoutMs: number): Promise<ComfyWorkflowGenerator> {
  const specifier: string = STUDIO_GENERATOR_MODULE;
  const module = (await import(specifier)) as { ComfyVideoProvider?: new (options: { baseUrl: string; timeoutMs?: number }) => ComfyWorkflowGenerator };
  if (typeof module.ComfyVideoProvider !== 'function') throw new Error('ComfyVideoProvider not found');
  return new module.ComfyVideoProvider({ baseUrl, timeoutMs });
}

/**
 * Integration point for the Work's composer: STUDIO_COMPOSER_MODULE points to
 * a module exporting createStudioComposer(env) -> StudioClipComposer.
 */
export async function loadComposer(env: NodeJS.ProcessEnv): Promise<StudioClipComposer | undefined> {
  const modulePath = env.STUDIO_COMPOSER_MODULE?.trim();
  if (!modulePath) return undefined;
  const module = (await import(pathToFileURL(resolve(modulePath)).href)) as { createStudioComposer?: (env: NodeJS.ProcessEnv) => unknown };
  if (typeof module.createStudioComposer !== 'function') throw new Error('STUDIO_COMPOSER_MODULE must export createStudioComposer(env)');
  const composer = await module.createStudioComposer(env) as Partial<StudioClipComposer> | undefined;
  if (!composer || typeof composer.id !== 'string' || typeof composer.compose !== 'function') {
    throw new Error('createStudioComposer(env) must return { id: string, compose(request) }');
  }
  return composer as StudioClipComposer;
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid positive integer: ${raw}`);
  return value;
}
