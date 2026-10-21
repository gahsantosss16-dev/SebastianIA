import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Logger } from '../core/logger.js';
import { validateStudioPlan, type StudioProductionPlan } from './VideoProductionPlan.js';

/**
 * Sebastian Studio asynchronous render jobs.
 *
 * Contract with the render engine (configured by the renderer work):
 * - availability(): whether the engine can render now, and its cost per plan.
 * - render(request): turns the whole validated plan into one MP4 at
 *   request.outputPath, reporting progress and stopping promptly when
 *   request.signal aborts (real cancellation, not just "stop waiting").
 *
 * Jobs run one at a time (a single local GPU/CPU), are kept in memory (a
 * restart loses unfinished jobs; finished MP4s stay on disk) and every
 * produced video gets a manifest with the exact plan it was made from.
 */

export type StudioJobStatus = 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled';

export interface StudioRenderProgress {
  readonly stage: string;
  /** 0..1 */
  readonly progress: number;
}

export interface StudioEngineAvailability {
  readonly available: boolean;
  readonly engine: string;
  readonly message?: string;
  /** Charge for rendering a plan with this engine. Local engines report 0. */
  readonly estimatedCostUsd: number;
}

export interface StudioEngineRenderRequest {
  readonly jobId: string;
  readonly plan: StudioProductionPlan;
  readonly outputPath: string;
  readonly workDirectory: string;
  readonly signal: AbortSignal;
  readonly report: (progress: StudioRenderProgress) => void;
}

export interface StudioRenderEngine {
  readonly id: string;
  availability(): Promise<StudioEngineAvailability>;
  render(request: StudioEngineRenderRequest): Promise<void>;
}

/** An error whose message is safe and useful to show to the Studio user. */
export class StudioEngineError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'StudioEngineError';
  }
}

export type StudioJobErrorCode = 'STUDIO_UNAVAILABLE' | 'STUDIO_BUSY' | 'INVALID_STUDIO_PLAN' | 'STUDIO_COST_APPROVAL_REQUIRED';

export class StudioJobError extends Error {
  public constructor(public readonly code: StudioJobErrorCode, message: string) {
    super(message);
    this.name = 'StudioJobError';
  }
}

/** Engine used when nothing is configured: always reports why it cannot render. */
export class UnavailableStudioEngine implements StudioRenderEngine {
  public readonly id = 'indisponível';
  public constructor(private readonly reason: string) {}
  public async availability(): Promise<StudioEngineAvailability> {
    return { available: false, engine: this.id, message: this.reason, estimatedCostUsd: 0 };
  }
  public async render(): Promise<void> {
    throw new StudioEngineError(this.reason);
  }
}

export interface StudioJobView {
  readonly id: string;
  readonly status: StudioJobStatus;
  readonly stage: string;
  readonly progress: number;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly cancelRequested: boolean;
  readonly statusUrl: string;
  readonly downloadUrl?: string;
  readonly fileName?: string;
  readonly error?: { readonly code: string; readonly message: string };
  readonly production: {
    readonly title: string;
    readonly style: string;
    readonly format: string;
    readonly durationSeconds: number;
    readonly scenes: number;
    readonly characters: readonly string[];
  };
}

export interface StudioRenderJobsOptions {
  readonly outputDirectory: string;
  readonly engine: StudioRenderEngine;
  readonly logger?: Logger;
  readonly maxQueued?: number;
  readonly retainFinished?: number;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

interface StudioJob {
  readonly id: string;
  readonly plan: StudioProductionPlan;
  readonly fileName: string;
  readonly controller: AbortController;
  readonly createdAt: Date;
  status: StudioJobStatus;
  stage: string;
  progress: number;
  startedAt?: Date;
  finishedAt?: Date;
  error?: { readonly code: string; readonly message: string };
}

export const STUDIO_RENDER_FILE_PATTERN = /^sebastian-studio-[0-9a-f-]{36}\.mp4$/;
const JOB_ID_PATTERN = /^[0-9a-f-]{36}$/;

export class StudioRenderJobs {
  private readonly outputDirectory: string;
  private readonly engine: StudioRenderEngine;
  private readonly logger: Logger | undefined;
  private readonly maxQueued: number;
  private readonly retainFinished: number;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly jobs = new Map<string, StudioJob>();
  private readonly queue: StudioJob[] = [];
  private running: Promise<void> | undefined;
  private shuttingDown = false;

  public constructor(options: StudioRenderJobsOptions) {
    this.outputDirectory = resolve(options.outputDirectory);
    this.engine = options.engine;
    this.logger = options.logger;
    this.maxQueued = options.maxQueued ?? 3;
    this.retainFinished = options.retainFinished ?? 50;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  public get engineId(): string {
    return this.engine.id;
  }

  public async availability(): Promise<StudioEngineAvailability> {
    try {
      return await this.engine.availability();
    } catch (error) {
      this.logger?.warn('Studio engine availability check failed.', { engine: this.engine.id, message: errorMessage(error) });
      return { available: false, engine: this.engine.id, message: 'Não foi possível verificar o motor de renderização.', estimatedCostUsd: 0 };
    }
  }

  /** Validates, checks the engine and the local-cost gate, then queues. Throws StudioJobError. */
  public async submit(candidate: unknown): Promise<StudioJobView> {
    if (this.shuttingDown) throw new StudioJobError('STUDIO_UNAVAILABLE', 'O servidor está sendo reiniciado. Tente novamente em instantes.');
    const plan = normalizePlan(candidate);
    const availability = await this.availability();
    if (!availability.available) {
      throw new StudioJobError('STUDIO_UNAVAILABLE', availability.message ?? 'O motor de renderização não está disponível.');
    }
    if (availability.estimatedCostUsd !== 0) {
      throw new StudioJobError('STUDIO_COST_APPROVAL_REQUIRED', 'Este motor informou custo de processamento. Renderização paga exige aprovação explícita, que ainda não existe; nada foi cobrado.');
    }
    if (plan.status !== 'rendering' || !plan.budgetApproved || plan.estimatedCostUsd !== 0) {
      throw new StudioJobError('INVALID_STUDIO_PLAN', 'O plano precisa estar aprovado para renderização local com custo estimado de US$ 0.');
    }
    const pending = this.queue.length + (this.running ? 1 : 0);
    if (pending >= this.maxQueued) {
      throw new StudioJobError('STUDIO_BUSY', 'O Studio já tem vídeos demais na fila. Aguarde a conclusão e tente novamente.');
    }
    const id = this.createId();
    if (!JOB_ID_PATTERN.test(id) || this.jobs.has(id)) throw new Error('Studio job id generator returned an invalid id.');
    const job: StudioJob = {
      id,
      plan,
      fileName: `sebastian-studio-${id}.mp4`,
      controller: new AbortController(),
      createdAt: this.now(),
      status: 'queued',
      stage: 'Na fila de renderização',
      progress: 0,
    };
    this.jobs.set(id, job);
    this.queue.push(job);
    this.logger?.info('Studio render job queued.', { jobId: id, engine: this.engine.id, scenes: plan.scenes.length });
    const accepted = this.view(job);
    this.pump();
    return accepted;
  }

  public get(id: string): StudioJobView | undefined {
    const job = this.jobs.get(id);
    return job ? this.view(job) : undefined;
  }

  /** Real cancellation: a queued job never starts; a running job's engine is aborted. */
  public cancel(id: string): StudioJobView | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    if (job.status === 'queued') {
      this.queue.splice(this.queue.indexOf(job), 1);
      job.controller.abort();
      this.finish(job, 'cancelled', 'Renderização cancelada antes de começar');
    } else if (job.status === 'rendering' && !job.controller.signal.aborted) {
      job.stage = 'Cancelando a renderização…';
      job.controller.abort();
      this.logger?.info('Studio render job cancellation requested.', { jobId: id });
    }
    return this.view(job);
  }

  /** Absolute path of a finished render, or undefined. Only exact generated names are accepted. */
  public resolveRender(fileName: string): string | undefined {
    if (!STUDIO_RENDER_FILE_PATTERN.test(fileName)) return undefined;
    const path = join(this.outputDirectory, fileName);
    return existsSync(path) ? path : undefined;
  }

  /** Resolves once no job is running or queued (tests and graceful shutdown). */
  public async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  public async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const job of [...this.queue]) this.cancel(job.id);
    for (const job of this.jobs.values()) if (job.status === 'rendering') job.controller.abort();
    await this.idle();
  }

  private pump(): void {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running = this.execute(job).finally(() => {
      this.running = undefined;
      this.prune();
      this.pump();
    });
  }

  private async execute(job: StudioJob): Promise<void> {
    job.status = 'rendering';
    job.startedAt = this.now();
    job.stage = 'Preparando a produção';
    const signal = job.controller.signal;
    const workDirectory = join(this.outputDirectory, `.work-${job.id}`);
    const partialPath = join(this.outputDirectory, `.${job.fileName}.partial`);
    const finalPath = join(this.outputDirectory, job.fileName);
    try {
      await mkdir(workDirectory, { recursive: true });
      // The exact plan (characters, lines, scenes, visual descriptions) travels with the video.
      await writeFile(join(this.outputDirectory, job.fileName.replace(/\.mp4$/, '.json')), JSON.stringify({
        jobId: job.id,
        engine: this.engine.id,
        createdAt: job.createdAt.toISOString(),
        plan: job.plan,
      }, null, 2), { encoding: 'utf8', mode: 0o600 });
      // Cancelled while preparing: never hand an already-aborted signal to the engine.
      if (signal.aborted) throw new StudioEngineError('Renderização cancelada.');
      await this.engine.render({
        jobId: job.id,
        plan: job.plan,
        outputPath: partialPath,
        workDirectory,
        signal,
        report: (update) => {
          if (job.status !== 'rendering' || signal.aborted) return;
          job.stage = String(update.stage).slice(0, 160);
          job.progress = Math.min(0.99, Math.max(job.progress, Number.isFinite(update.progress) ? update.progress : 0));
        },
      });
      if (signal.aborted) throw new StudioEngineError('Renderização cancelada.');
      await assertMp4(partialPath);
      await rename(partialPath, finalPath);
      job.progress = 1;
      this.finish(job, 'completed', 'Vídeo pronto');
      this.logger?.info('Studio render job completed.', { jobId: job.id, engine: this.engine.id });
    } catch (error) {
      await rm(partialPath, { force: true });
      await rm(join(this.outputDirectory, job.fileName.replace(/\.mp4$/, '.json')), { force: true });
      if (signal.aborted) {
        this.finish(job, 'cancelled', 'Renderização cancelada');
        this.logger?.info('Studio render job cancelled.', { jobId: job.id });
      } else {
        const message = error instanceof StudioEngineError ? error.message : 'O motor de renderização falhou inesperadamente.';
        job.error = { code: 'STUDIO_RENDER_FAILED', message };
        this.finish(job, 'failed', 'Falha na renderização');
        this.logger?.error('Studio render job failed.', { jobId: job.id, engine: this.engine.id, name: error instanceof Error ? error.name : 'UnknownError', message: errorMessage(error) });
      }
    } finally {
      await rm(workDirectory, { recursive: true, force: true });
    }
  }

  private finish(job: StudioJob, status: StudioJobStatus, stage: string): void {
    job.status = status;
    job.stage = stage;
    job.finishedAt = this.now();
  }

  private prune(): void {
    const finished = [...this.jobs.values()].filter((job) => job.finishedAt !== undefined);
    for (const job of finished.slice(0, Math.max(0, finished.length - this.retainFinished))) this.jobs.delete(job.id);
  }

  private view(job: StudioJob): StudioJobView {
    const completed = job.status === 'completed';
    return {
      id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      createdAt: job.createdAt.toISOString(),
      ...(job.startedAt ? { startedAt: job.startedAt.toISOString() } : {}),
      ...(job.finishedAt ? { finishedAt: job.finishedAt.toISOString() } : {}),
      cancelRequested: job.controller.signal.aborted,
      statusUrl: `/api/studio/jobs/${job.id}`,
      ...(completed ? { downloadUrl: `/api/studio/renders/${job.fileName}`, fileName: job.fileName } : {}),
      ...(job.error ? { error: job.error } : {}),
      production: {
        title: job.plan.title,
        style: job.plan.style,
        format: job.plan.format,
        durationSeconds: job.plan.durationSeconds,
        scenes: job.plan.scenes.length,
        characters: job.plan.characters.map((character) => character.name),
      },
    };
  }
}

/** Rebuilds the plan from known fields only (drops extras), validates it and freezes it. */
export function normalizePlan(candidate: unknown): StudioProductionPlan {
  try {
    const raw = candidate as StudioProductionPlan;
    const plan: StudioProductionPlan = {
      title: str(raw.title),
      format: raw.format,
      style: raw.style,
      language: raw.language,
      durationSeconds: raw.durationSeconds,
      characters: list(raw.characters).map((c) => ({
        id: str(c.id), name: str(c.name), visualDescription: str(c.visualDescription), voiceDescription: str(c.voiceDescription),
      })),
      scenes: list(raw.scenes).map((s) => ({
        id: str(s.id),
        order: s.order,
        durationSeconds: s.durationSeconds,
        visualPrompt: str(s.visualPrompt),
        characterIds: list<unknown>(s.characterIds).map(str),
        dialogue: list(s.dialogue).map((d) => ({ characterId: str(d.characterId), text: str(d.text) })),
      })),
      status: raw.status,
      estimatedCostUsd: raw.estimatedCostUsd,
      budgetApproved: raw.budgetApproved === true,
    };
    return deepFreeze(validateStudioPlan(plan));
  } catch (error) {
    throw new StudioJobError('INVALID_STUDIO_PLAN', `Plano de produção inválido: ${errorMessage(error)}`);
  }
}

function str(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('expected text');
  return value;
}

function list<T>(value: readonly T[]): readonly T[] {
  if (!Array.isArray(value)) throw new TypeError('expected a list');
  return value as readonly T[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

async function assertMp4(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, 'r');
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, 12, 0);
    if (bytesRead < 12 || header.toString('latin1', 4, 8) !== 'ftyp') throw new Error('not mp4');
  } catch {
    throw new StudioEngineError('O motor terminou sem produzir um MP4 válido.');
  } finally {
    await handle?.close();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
