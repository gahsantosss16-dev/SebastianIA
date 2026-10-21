import { createHash, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  StudioEngineError,
  normalizePlan,
  type StudioEngineAvailability,
  type StudioEngineRenderRequest,
  type StudioRenderEngine,
} from './StudioRenderJobs.js';
import type { StudioProductionPlan } from './VideoProductionPlan.js';

/**
 * Render engine for a remote GPU worker, used by the web app (Hostinger).
 *
 * Security model: the GPU machine runs ComfyUI on loopback only and a
 * StudioGpuWorker that connects OUT to this server over HTTPS with a
 * dedicated worker token. Nothing on the GPU machine is exposed to the
 * internet, and the worker token is separate from the user's access key
 * (worker routes never accept browser sessions, and vice versa).
 *
 * Flow: render() parks the job; the worker claims it (long poll), reports
 * progress (each answer tells it whether the user cancelled), then uploads
 * the MP4 or reports a failure. A worker that goes silent loses the lease
 * and the job fails with a clear message. The worker also reports its own
 * availability and cost: a non-zero cost blocks rendering (no unapproved
 * charges, e.g. a rented cloud GPU).
 */

export interface StudioWorkerStatus {
  readonly available: boolean;
  readonly engine: string;
  readonly message?: string;
  readonly estimatedCostUsd: number;
}

export interface StudioWorkerAssignment {
  readonly jobId: string;
  readonly plan: StudioProductionPlan;
}

export interface RemoteStudioEngineOptions {
  /** Shared secret of the GPU worker (STUDIO_WORKER_TOKEN), at least 32 characters. */
  readonly workerToken: string;
  /** Worker counts as connected this long after its last call (default 90 s). */
  readonly heartbeatTimeoutMs?: number;
  /** A claimed job fails if the worker is silent this long (default 10 min). */
  readonly leaseTimeoutMs?: number;
  /** Largest accepted MP4 upload (default 512 MiB). */
  readonly maxResultBytes?: number;
  /** How long a worker's claim waits for a job before answering 204 (default 25 s, below proxy timeouts). */
  readonly claimWaitMs?: number;
  readonly now?: () => number;
}

interface Assignment {
  readonly request: StudioEngineRenderRequest;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  claimed: boolean;
  lastActivity: number;
  uploading: boolean;
}

export type WorkerProgressAnswer = 'continue' | 'cancel' | 'unknown';

export class RemoteStudioEngine implements StudioRenderEngine {
  public readonly id = 'GPU remota';
  private readonly tokenDigest: Buffer;
  private readonly heartbeatTimeoutMs: number;
  private readonly leaseTimeoutMs: number;
  public readonly maxResultBytes: number;
  public readonly claimWaitMs: number;
  private readonly now: () => number;
  private workerSeenAt = Number.NEGATIVE_INFINITY;
  private workerStatus: StudioWorkerStatus | undefined;
  private readonly waiting: Assignment[] = [];
  private readonly assigned = new Map<string, Assignment>();
  private readonly claimers = new Set<() => void>();
  private readonly cancelled: string[] = [];
  private readonly watchdog: NodeJS.Timeout;

  public constructor(options: RemoteStudioEngineOptions) {
    if (typeof options.workerToken !== 'string' || options.workerToken.length < 32) {
      throw new StudioEngineError('STUDIO_WORKER_TOKEN precisa ter pelo menos 32 caracteres.');
    }
    this.tokenDigest = digest(options.workerToken);
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 90_000;
    this.leaseTimeoutMs = options.leaseTimeoutMs ?? 10 * 60_000;
    this.maxResultBytes = options.maxResultBytes ?? 512 * 1024 * 1024;
    this.claimWaitMs = options.claimWaitMs ?? 25_000;
    this.now = options.now ?? Date.now;
    this.watchdog = setInterval(() => this.expire(), Math.min(15_000, this.leaseTimeoutMs));
    this.watchdog.unref();
  }

  public isWorkerAuthorized(authorization: string | undefined): boolean {
    const match = /^Bearer (.+)$/.exec(authorization ?? '');
    return match !== null && timingSafeEqual(digest(match[1] ?? ''), this.tokenDigest);
  }

  public async availability(): Promise<StudioEngineAvailability> {
    if (!this.workerConnected() || !this.workerStatus) {
      return { available: false, engine: this.id, message: 'O processador de GPU do Studio está desconectado. Assim que ele voltar, a geração fica disponível.', estimatedCostUsd: 0 };
    }
    const status = this.workerStatus;
    return {
      available: status.available,
      engine: `${this.id} · ${status.engine}`,
      ...(status.message ? { message: status.message } : {}),
      estimatedCostUsd: status.estimatedCostUsd,
    };
  }

  public render(request: StudioEngineRenderRequest): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error?: Error): void => {
        if (settled) return;
        settled = true;
        this.assigned.delete(request.jobId);
        const index = this.waiting.indexOf(assignment);
        if (index >= 0) this.waiting.splice(index, 1);
        if (error) reject(error); else resolve();
      };
      const assignment: Assignment = {
        request, resolve: () => settle(), reject: (error) => settle(error), claimed: false, lastActivity: this.now(), uploading: false,
      };
      request.signal.addEventListener('abort', () => {
        // The worker learns it on its next call (progress answers "cancel", uploads are refused).
        this.rememberCancelled(request.jobId);
        settle(new StudioEngineError('Renderização cancelada.'));
      }, { once: true });
      if (request.signal.aborted) {
        settle(new StudioEngineError('Renderização cancelada.'));
        return;
      }
      this.waiting.push(assignment);
      request.report({ stage: 'Aguardando o processador de GPU', progress: 0 });
      for (const wake of this.claimers) wake();
    });
  }

  /** Worker heartbeat + long poll for the next job. Returns undefined when nothing arrived in waitMs. */
  public async claim(status: StudioWorkerStatus, waitMs: number): Promise<StudioWorkerAssignment | undefined> {
    this.heartbeat(status);
    const next = this.takeWaiting();
    if (next || waitMs <= 0) return next;
    await new Promise<void>((resolve) => {
      const wake = (): void => { clearTimeout(timer); this.claimers.delete(wake); resolve(); };
      const timer = setTimeout(wake, waitMs);
      this.claimers.add(wake);
    });
    this.heartbeat(status);
    return this.takeWaiting();
  }

  /** Progress from the worker; the answer tells it to continue or to cancel. */
  public progress(jobId: string, stage: string, progress: number): WorkerProgressAnswer {
    this.workerSeenAt = this.now();
    if (this.cancelled.includes(jobId)) return 'cancel';
    const assignment = this.assigned.get(jobId);
    if (!assignment) return 'unknown';
    assignment.lastActivity = this.now();
    assignment.request.report({ stage: stage.slice(0, 160), progress: Number.isFinite(progress) ? Math.min(0.99, Math.max(0, progress)) : 0 });
    return 'continue';
  }

  /** Streams the worker's MP4 into the job's output path (size-limited). */
  public async complete(jobId: string, body: Readable, declaredBytes: number): Promise<'stored' | 'unknown' | 'cancelled' | 'too_large'> {
    this.workerSeenAt = this.now();
    if (this.cancelled.includes(jobId)) return 'cancelled';
    const assignment = this.assigned.get(jobId);
    if (!assignment || assignment.uploading) return 'unknown';
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes <= 0 || declaredBytes > this.maxResultBytes) return 'too_large';
    assignment.uploading = true;
    let received = 0;
    const limit = this.maxResultBytes;
    try {
      await pipeline(body, async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          received += chunk.length;
          if (received > limit || received > declaredBytes) throw new StudioEngineError('Upload maior que o declarado.');
          yield chunk;
        }
      }, createWriteStream(assignment.request.outputPath, { mode: 0o600 }), { signal: assignment.request.signal });
      if (received !== declaredBytes) throw new StudioEngineError('Upload incompleto do vídeo.');
    } catch (error) {
      assignment.uploading = false;
      await rm(assignment.request.outputPath, { force: true });
      if (assignment.request.signal.aborted) return 'cancelled';
      throw error;
    }
    assignment.resolve();
    return 'stored';
  }

  public fail(jobId: string, message: string): boolean {
    this.workerSeenAt = this.now();
    const assignment = this.assigned.get(jobId);
    if (!assignment) return false;
    const clean = String(message).replace(/\s+/g, ' ').trim().slice(0, 300) || 'falha desconhecida';
    assignment.reject(new StudioEngineError(`O processador de GPU informou uma falha: ${clean}`));
    return true;
  }

  public dispose(): void {
    clearInterval(this.watchdog);
    for (const wake of this.claimers) wake();
  }

  private rememberCancelled(jobId: string): void {
    this.cancelled.push(jobId);
    if (this.cancelled.length > 100) this.cancelled.shift();
  }

  private heartbeat(status: StudioWorkerStatus): void {
    this.workerSeenAt = this.now();
    this.workerStatus = status;
  }

  private workerConnected(): boolean {
    return this.now() - this.workerSeenAt <= this.heartbeatTimeoutMs;
  }

  private takeWaiting(): StudioWorkerAssignment | undefined {
    const assignment = this.waiting.shift();
    if (!assignment) return undefined;
    assignment.claimed = true;
    assignment.lastActivity = this.now();
    this.assigned.set(assignment.request.jobId, assignment);
    assignment.request.report({ stage: 'Processador de GPU iniciou a geração', progress: 0.01 });
    return { jobId: assignment.request.jobId, plan: assignment.request.plan };
  }

  /** Fails claimed jobs whose worker went silent, and waiting jobs when no worker is connected. */
  private expire(): void {
    const now = this.now();
    for (const assignment of [...this.assigned.values()]) {
      if (!assignment.uploading && now - assignment.lastActivity > this.leaseTimeoutMs) {
        assignment.reject(new StudioEngineError('O processador de GPU parou de responder durante a geração.'));
      }
    }
    if (!this.workerConnected()) {
      for (const assignment of [...this.waiting]) {
        if (now - assignment.lastActivity > this.heartbeatTimeoutMs) assignment.reject(new StudioEngineError('O processador de GPU está desconectado; a renderização não pôde começar.'));
      }
    }
  }

  /** Test hook: run the lease/heartbeat checks now. */
  public checkLeases(): void {
    this.expire();
  }
}

/** Validates what a worker claims to be; refuses malformed status. */
export function parseWorkerStatus(body: unknown): StudioWorkerStatus | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const raw = body as Record<string, unknown>;
  if (typeof raw.available !== 'boolean' || typeof raw.estimatedCostUsd !== 'number' || !Number.isFinite(raw.estimatedCostUsd) || raw.estimatedCostUsd < 0) return undefined;
  const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const message = text(raw.message, 300);
  return {
    available: raw.available,
    engine: text(raw.engine, 60) || 'desconhecido',
    ...(message ? { message } : {}),
    estimatedCostUsd: raw.estimatedCostUsd,
  };
}

/** Re-validates a plan received from the server on the worker side. */
export function parseAssignment(body: unknown): StudioWorkerAssignment {
  const raw = (body && typeof body === 'object' ? (body as { job?: unknown }).job : undefined) as { id?: unknown; plan?: unknown } | undefined;
  if (!raw || typeof raw.id !== 'string' || !/^[0-9a-f-]{36}$/.test(raw.id)) throw new StudioEngineError('Tarefa recebida do servidor é inválida.');
  return { jobId: raw.id, plan: normalizePlan(raw.plan) };
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
