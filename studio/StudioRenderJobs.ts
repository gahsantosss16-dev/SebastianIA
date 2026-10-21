import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Logger } from '../core/logger.js';
import { Mp4InspectionError, inspectMp4, mobilePlaybackProblems, type Mp4Inspection } from './Mp4Inspection.js';
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
 * Jobs run one at a time, are persisted (jobs.json) and survive restarts:
 * queued jobs are queued again, a job interrupted mid-render is reported as
 * failed. Every published video is checked for mobile playback (H.264, AAC,
 * faststart) and carries a manifest with the exact plan it was made from.
 * Old videos, temporary files and orphans are removed automatically.
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

export type StudioJobErrorCode = 'STUDIO_UNAVAILABLE' | 'STUDIO_BUSY' | 'STUDIO_RATE_LIMITED' | 'INVALID_STUDIO_PLAN' | 'STUDIO_COST_APPROVAL_REQUIRED';

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
  /** Jobs waiting or running at the same time (default 3). */
  readonly maxQueued?: number;
  /** Jobs accepted per rolling 24 h (default 20). */
  readonly maxJobsPerDay?: number;
  /** Finished jobs (and their videos) kept at most this many days (default 7). */
  readonly retentionDays?: number;
  /** Finished jobs kept in the list at most (default 50); older ones are deleted with their files. */
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

interface PersistedJob {
  readonly id: string;
  readonly plan: unknown;
  readonly status: StudioJobStatus;
  readonly stage: string;
  readonly progress: number;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly error?: { readonly code: string; readonly message: string };
}

export const STUDIO_RENDER_FILE_PATTERN = /^sebastian-studio-[0-9a-f-]{36}\.mp4$/;
const STUDIO_ARTIFACT_PATTERN = /^sebastian-studio-([0-9a-f-]{36})\.(mp4|json)$/;
const JOB_ID_PATTERN = /^[0-9a-f-]{36}$/;
const STATE_FILE = 'jobs.json';
const PROGRESS_PERSIST_INTERVAL_MS = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class StudioRenderJobs {
  private readonly outputDirectory: string;
  private readonly engine: StudioRenderEngine;
  private readonly logger: Logger | undefined;
  private readonly maxQueued: number;
  private readonly maxJobsPerDay: number;
  private readonly retentionMs: number;
  private readonly retainFinished: number;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly jobs = new Map<string, StudioJob>();
  private readonly queue: StudioJob[] = [];
  private running: Promise<void> | undefined;
  private shuttingDown = false;
  private lastProgressPersist = 0;

  public constructor(options: StudioRenderJobsOptions) {
    this.outputDirectory = resolve(options.outputDirectory);
    this.engine = options.engine;
    this.logger = options.logger;
    this.maxQueued = options.maxQueued ?? 3;
    this.maxJobsPerDay = options.maxJobsPerDay ?? 20;
    this.retentionMs = (options.retentionDays ?? 7) * DAY_MS;
    this.retainFinished = options.retainFinished ?? 50;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    mkdirSync(this.outputDirectory, { recursive: true });
    this.restore();
    this.cleanup();
    this.persist();
    this.pump();
  }

  public get engineId(): string {
    return this.engine.id;
  }

  /** The configured engine (the HTTP layer mounts worker routes when it is remote). */
  public get renderEngine(): StudioRenderEngine {
    return this.engine;
  }

  public async availability(): Promise<StudioEngineAvailability> {
    try {
      return await this.engine.availability();
    } catch (error) {
      this.logger?.warn('Studio engine availability check failed.', { engine: this.engine.id, message: errorMessage(error) });
      return { available: false, engine: this.engine.id, message: 'Não foi possível verificar o motor de renderização.', estimatedCostUsd: 0 };
    }
  }

  /** Validates, checks the engine, the cost gate and the limits, then queues. Throws StudioJobError. */
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
    const since = this.now().getTime() - DAY_MS;
    if ([...this.jobs.values()].filter((job) => job.createdAt.getTime() > since).length >= this.maxJobsPerDay) {
      throw new StudioJobError('STUDIO_RATE_LIMITED', `Limite de ${this.maxJobsPerDay} vídeos por dia atingido. Tente novamente mais tarde.`);
    }
    const pending = this.queue.length + (this.running ? 1 : 0);
    if (pending >= this.maxQueued) {
      throw new StudioJobError('STUDIO_BUSY', 'O Studio já tem vídeos demais na fila. Aguarde a conclusão e tente novamente.');
    }
    const id = this.createId();
    if (!JOB_ID_PATTERN.test(id) || this.jobs.has(id)) throw new Error('Studio job id generator returned an invalid id.');
    const job = this.createJob(id, plan, this.now());
    this.jobs.set(id, job);
    this.queue.push(job);
    this.persist();
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
      this.persist();
      this.logger?.info('Studio render job cancellation requested.', { jobId: id });
    }
    return this.view(job);
  }

  /** Absolute path of a finished render, or undefined. Only exact generated names of known jobs are accepted. */
  public resolveRender(fileName: string): string | undefined {
    if (!STUDIO_RENDER_FILE_PATTERN.test(fileName)) return undefined;
    const job = this.jobs.get(fileName.slice('sebastian-studio-'.length, -'.mp4'.length));
    if (job?.status !== 'completed') return undefined;
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
    // Releases long-polling GPU workers and timers of a remote engine.
    (this.engine as { dispose?: () => void }).dispose?.();
    this.persist();
  }

  private createJob(id: string, plan: StudioProductionPlan, createdAt: Date): StudioJob {
    return {
      id,
      plan,
      fileName: `sebastian-studio-${id}.mp4`,
      controller: new AbortController(),
      createdAt,
      status: 'queued',
      stage: 'Na fila de renderização',
      progress: 0,
    };
  }

  private pump(): void {
    if (this.running || this.shuttingDown) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running = this.execute(job).finally(() => {
      this.running = undefined;
      this.cleanup();
      this.persist();
      this.pump();
    });
  }

  private async execute(job: StudioJob): Promise<void> {
    job.status = 'rendering';
    job.startedAt = this.now();
    job.stage = 'Preparando a produção';
    this.persist();
    const signal = job.controller.signal;
    const workDirectory = join(this.outputDirectory, `.work-${job.id}`);
    const partialPath = join(this.outputDirectory, `.${job.fileName}.partial`);
    const finalPath = join(this.outputDirectory, job.fileName);
    const manifestPath = join(this.outputDirectory, job.fileName.replace(/\.mp4$/, '.json'));
    try {
      await mkdir(workDirectory, { recursive: true });
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
          if (Date.now() - this.lastProgressPersist > PROGRESS_PERSIST_INTERVAL_MS) this.persist();
        },
      });
      if (signal.aborted) throw new StudioEngineError('Renderização cancelada.');
      const media = await verifyMobileMp4(partialPath);
      // The exact plan (characters, lines, scenes, visual descriptions) travels with the video.
      await writeFile(manifestPath, JSON.stringify({
        jobId: job.id,
        engine: this.engine.id,
        createdAt: job.createdAt.toISOString(),
        media,
        plan: job.plan,
      }, null, 2), { encoding: 'utf8', mode: 0o600 });
      await rename(partialPath, finalPath);
      job.progress = 1;
      this.finish(job, 'completed', 'Vídeo pronto');
      this.logger?.info('Studio render job completed.', { jobId: job.id, engine: this.engine.id, subtitleTracks: media.subtitleCodecs.length });
    } catch (error) {
      await rm(partialPath, { force: true });
      await rm(manifestPath, { force: true });
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
    this.persist();
  }

  /** Reloads persisted jobs: queued ones are queued again; ones interrupted mid-render are failed. */
  private restore(): void {
    let records: readonly PersistedJob[] = [];
    try {
      const parsed = JSON.parse(readFileSync(join(this.outputDirectory, STATE_FILE), 'utf8')) as { readonly jobs?: unknown };
      records = Array.isArray(parsed.jobs) ? parsed.jobs as PersistedJob[] : [];
    } catch {
      return;
    }
    for (const record of records) {
      try {
        if (!JOB_ID_PATTERN.test(record.id)) continue;
        const job = this.createJob(record.id, normalizePlan(record.plan), new Date(record.createdAt));
        job.status = record.status;
        job.stage = String(record.stage);
        job.progress = Number(record.progress) || 0;
        if (record.startedAt) job.startedAt = new Date(record.startedAt);
        if (record.finishedAt) job.finishedAt = new Date(record.finishedAt);
        if (record.error) job.error = { code: String(record.error.code), message: String(record.error.message) };
        if (job.status === 'rendering') {
          job.status = 'failed';
          job.stage = 'Interrompida pelo reinício do servidor';
          job.error = { code: 'STUDIO_RENDER_INTERRUPTED', message: 'A renderização foi interrompida porque o servidor reiniciou. Gere o vídeo novamente.' };
          job.finishedAt = this.now();
        } else if (job.status === 'queued') {
          this.queue.push(job);
        } else if (job.status === 'completed' && !existsSync(join(this.outputDirectory, job.fileName))) {
          continue;
        }
        this.jobs.set(job.id, job);
      } catch {
        this.logger?.warn('Discarded an unreadable persisted Studio job.', {});
      }
    }
    if (records.length > 0) this.logger?.info('Studio render jobs restored.', { jobs: this.jobs.size, requeued: this.queue.length });
  }

  /** Expired and over-limit jobs are deleted with their files; temporary and orphan files are removed. */
  private cleanup(): void {
    const cutoff = this.now().getTime() - this.retentionMs;
    const finished = [...this.jobs.values()].filter((job) => job.finishedAt !== undefined);
    const overLimit = new Set(finished.slice(0, Math.max(0, finished.length - this.retainFinished)));
    for (const job of finished) {
      if (overLimit.has(job) || (job.finishedAt?.getTime() ?? 0) < cutoff) this.jobs.delete(job.id);
    }
    let entries: string[] = [];
    try { entries = readdirSync(this.outputDirectory); } catch { return; }
    const active = this.running ? new Set([...this.jobs.values()].filter((job) => job.status === 'rendering').map((job) => job.id)) : new Set<string>();
    for (const name of entries) {
      const path = join(this.outputDirectory, name);
      const artifact = STUDIO_ARTIFACT_PATTERN.exec(name);
      const temporary = /^\.work-([0-9a-f-]{36})$/.exec(name) ?? /^\.sebastian-studio-([0-9a-f-]{36})\.mp4\.partial$/.exec(name);
      try {
        if (temporary && !active.has(temporary[1] ?? '')) rmSync(path, { recursive: true, force: true });
        else if (artifact && this.jobs.get(artifact[1] ?? '')?.status !== 'completed' && !active.has(artifact[1] ?? '')) {
          if (statSync(path).isFile()) rmSync(path, { force: true });
        }
      } catch (error) {
        this.logger?.warn('Studio cleanup could not remove a file.', { name, message: errorMessage(error) });
      }
    }
  }

  private persist(): void {
    this.lastProgressPersist = Date.now();
    const records: PersistedJob[] = [...this.jobs.values()].map((job) => ({
      id: job.id,
      plan: job.plan,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      createdAt: job.createdAt.toISOString(),
      ...(job.startedAt ? { startedAt: job.startedAt.toISOString() } : {}),
      ...(job.finishedAt ? { finishedAt: job.finishedAt.toISOString() } : {}),
      ...(job.error ? { error: job.error } : {}),
    }));
    const path = join(this.outputDirectory, STATE_FILE);
    try {
      writeFileSync(`${path}.tmp`, JSON.stringify({ version: 1, jobs: records }), { encoding: 'utf8', mode: 0o600 });
      renameSync(`${path}.tmp`, path);
    } catch (error) {
      this.logger?.error('Studio jobs could not be persisted.', { message: errorMessage(error) });
    }
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

/** Refuses any output that is not an MP4 playable (with sound) in mobile browsers. */
export async function verifyMobileMp4(path: string): Promise<Mp4Inspection> {
  let media: Mp4Inspection;
  try {
    media = await inspectMp4(path);
  } catch (error) {
    throw new StudioEngineError(`O motor terminou sem produzir um MP4 válido${error instanceof Mp4InspectionError ? `: ${error.message}` : '.'}`);
  }
  const problems = mobilePlaybackProblems(media);
  if (problems.length > 0) throw new StudioEngineError(`O vídeo gerado não é compatível com navegadores móveis: ${problems.join('; ')}.`);
  return media;
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
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
