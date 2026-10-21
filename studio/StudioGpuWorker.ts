import { createReadStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Logger } from '../core/logger.js';
import { parseAssignment } from './RemoteStudioEngine.js';
import { StudioEngineError, verifyMobileMp4, type StudioRenderEngine } from './StudioRenderJobs.js';

/**
 * Runs on the GPU machine, next to ComfyUI (loopback) and the Work's
 * composer. Connects OUT to the Sebastian web app, so the GPU machine needs
 * no public port: claim -> render locally -> report progress (learning about
 * cancellation from each answer) -> verify the MP4 -> upload -> clean up.
 */

export interface StudioGpuWorkerOptions {
  /** Sebastian web app, e.g. https://sebastian.example.com (HTTPS required except on localhost). */
  readonly serverUrl: string;
  readonly workerToken: string;
  /** Local engine: ComfyStudioEngine with the Work's workflow and composer. */
  readonly engine: StudioRenderEngine;
  readonly workDirectory: string;
  readonly logger?: Logger;
  readonly fetchImpl?: typeof fetch;
  /** Progress is sent at most this often; also the keep-alive period while a scene renders (default 10 s). */
  readonly progressIntervalMs?: number;
}

export type WorkerCycle = 'idle' | 'completed' | 'failed' | 'cancelled';

export class StudioGpuWorker {
  private readonly base: URL;
  private readonly fetcher: typeof fetch;
  private readonly progressIntervalMs: number;

  public constructor(private readonly options: StudioGpuWorkerOptions) {
    let url: URL;
    try { url = new URL(options.serverUrl.endsWith('/') ? options.serverUrl : `${options.serverUrl}/`); } catch { throw new StudioEngineError('STUDIO_SERVER_URL inválida.'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new StudioEngineError('STUDIO_SERVER_URL precisa usar HTTPS (o token do processador trafega nela).');
    if (url.username || url.password || url.search || url.hash) throw new StudioEngineError('STUDIO_SERVER_URL não pode conter credenciais, query ou fragmento.');
    if (typeof options.workerToken !== 'string' || options.workerToken.length < 32) throw new StudioEngineError('STUDIO_WORKER_TOKEN precisa ter pelo menos 32 caracteres.');
    this.base = url;
    this.fetcher = options.fetchImpl ?? fetch;
    this.progressIntervalMs = options.progressIntervalMs ?? 10_000;
  }

  /** Runs until the signal aborts, backing off on connection errors. */
  public async run(signal: AbortSignal): Promise<void> {
    let backoff = 1_000;
    while (!signal.aborted) {
      try {
        await this.runOnce(signal);
        backoff = 1_000;
      } catch (error) {
        this.options.logger?.warn('Studio GPU worker cycle failed.', { message: error instanceof Error ? error.message : String(error), retryInMs: backoff });
        await sleep(backoff, signal);
        backoff = Math.min(60_000, backoff * 2);
      }
    }
  }

  /** One claim cycle. Throws only on connection/protocol errors with the server. */
  public async runOnce(signal?: AbortSignal): Promise<WorkerCycle> {
    const status = await this.options.engine.availability().catch(() => ({ available: false, engine: this.options.engine.id, message: 'Falha ao verificar o motor local.', estimatedCostUsd: 0 }));
    const claim = await this.call('api/studio/worker/claim', { method: 'POST', json: status, ...(signal ? { signal } : {}) });
    if (claim.status === 204) return 'idle';
    if (claim.status !== 200) throw new Error(`claim HTTP ${claim.status}`);
    const assignment = parseAssignment(await claim.json());
    const { jobId, plan } = assignment;
    const logger = this.options.logger;
    logger?.info('Studio GPU worker claimed a job.', { jobId, scenes: plan.scenes.length });

    const controller = new AbortController();
    const stopOnShutdown = (): void => controller.abort();
    signal?.addEventListener('abort', stopOnShutdown, { once: true });
    const outputPath = join(this.options.workDirectory, `${jobId}.mp4`);
    const jobWork = join(this.options.workDirectory, `.work-${jobId}`);
    let last = { stage: 'Processador de GPU iniciou a geração', progress: 0.01 };
    let lastSent = 0;
    const send = async (): Promise<void> => {
      lastSent = Date.now();
      try {
        const answer = await this.call(`api/studio/worker/jobs/${jobId}/progress`, { method: 'POST', json: last });
        const body = answer.ok ? await answer.json() as { action?: string } : undefined;
        if (answer.status === 404 || body?.action === 'cancel') controller.abort();
      } catch {
        // Transient: the next tick retries; the server's lease covers short outages.
      }
    };
    const keepAlive = setInterval(() => { if (Date.now() - lastSent >= this.progressIntervalMs) void send(); }, Math.min(this.progressIntervalMs, 5_000));
    try {
      await mkdir(jobWork, { recursive: true });
      await send();
      if (controller.signal.aborted) throw new StudioEngineError('Renderização cancelada.');
      await this.options.engine.render({
        jobId,
        plan,
        outputPath,
        workDirectory: jobWork,
        signal: controller.signal,
        report: (update) => {
          last = { stage: update.stage, progress: update.progress };
          if (Date.now() - lastSent >= this.progressIntervalMs) void send();
        },
      });
      if (controller.signal.aborted) throw new StudioEngineError('Renderização cancelada.');
      await verifyMobileMp4(outputPath);
      last = { stage: 'Enviando o vídeo ao Sebastian', progress: 0.98 };
      await send();
      const size = (await stat(outputPath)).size;
      const upload = await this.call(`api/studio/worker/jobs/${jobId}/result`, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) },
        body: Readable.toWeb(createReadStream(outputPath)) as ReadableStream,
      });
      if (upload.status === 409) return 'cancelled';
      if (upload.status !== 204) throw new StudioEngineError(`O servidor recusou o vídeo (HTTP ${upload.status}).`);
      logger?.info('Studio GPU worker delivered a job.', { jobId, bytes: size });
      return 'completed';
    } catch (error) {
      if (controller.signal.aborted) {
        logger?.info('Studio GPU worker stopped a cancelled job.', { jobId });
        return 'cancelled';
      }
      const message = error instanceof StudioEngineError ? error.message : 'Falha inesperada no processador de GPU.';
      logger?.error('Studio GPU worker job failed.', { jobId, message: error instanceof Error ? error.message : String(error) });
      await this.call(`api/studio/worker/jobs/${jobId}/failure`, { method: 'POST', json: { message } }).catch(() => undefined);
      return 'failed';
    } finally {
      clearInterval(keepAlive);
      signal?.removeEventListener('abort', stopOnShutdown);
      await rm(jobWork, { recursive: true, force: true });
      await rm(outputPath, { force: true });
    }
  }

  private call(path: string, init: { method: string; json?: unknown; headers?: Record<string, string>; body?: ReadableStream; signal?: AbortSignal }): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.options.workerToken}`, ...init.headers };
    let body: string | ReadableStream | undefined = init.body;
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    return this.fetcher(new URL(path, this.base), {
      method: init.method,
      headers,
      ...(body === undefined ? {} : { body }),
      ...(init.body ? { duplex: 'half' } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
      redirect: 'error',
    } as RequestInit);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
