import { randomUUID } from 'node:crypto';

/**
 * Real generative-video backend adapter for a self-hosted ComfyUI instance.
 * Unlike the old FFmpeg/Blender stub, this submits an actual ComfyUI workflow
 * containing the installed video model, and returns its generated artifact.
 * This module does not start a model, install weights, or silently use paid APIs.
 */
export interface ComfyVideoOutput {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mimeType: 'video/mp4' | 'video/webm';
}
export class ComfyVideoError extends Error {
  constructor(message: string) { super(message); this.name = 'ComfyVideoError'; }
}
export interface ComfyVideoOptions {
  /** Explicitly configured URL of a trusted local ComfyUI backend. */
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly fetchImpl?: typeof fetch;
}
type JsonObject = Record<string, unknown>;
function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function cleanName(name: string): string {
  const result = name.replaceAll('\\', '/').split('/').at(-1) ?? '';
  if (!result || result === '.' || result === '..') throw new ComfyVideoError('Invalid output filename');
  return result;
}
/** Only loopback targets: never accept browser/user-provided public URLs. */
function trustedBase(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ComfyVideoError('Invalid ComfyUI endpoint'); }
  if (!['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash) {
    throw new ComfyVideoError('ComfyUI must run on the same host (loopback) without URL credentials');
  }
  return url;
}
export class ComfyVideoProvider {
  private readonly base: URL;
  private readonly fetcher: typeof fetch;
  private readonly timeout: number;
  private readonly poll: number;
  constructor(options: ComfyVideoOptions) {
    this.base = trustedBase(options.baseUrl);
    this.fetcher = options.fetchImpl ?? fetch;
    this.timeout = options.timeoutMs ?? 180_000;
    this.poll = options.pollIntervalMs ?? 2_000;
    if (!Number.isSafeInteger(this.timeout) || this.timeout < 1000 ||
        !Number.isSafeInteger(this.poll) || this.poll < 100) throw new ComfyVideoError('Invalid timeouts');
  }
  async generate(workflow: JsonObject, signal?: AbortSignal): Promise<ComfyVideoOutput> {
    if (!isObject(workflow) || Object.keys(workflow).length === 0) {
      throw new ComfyVideoError('A real installed video-model workflow is required');
    }
    const deadline = Date.now() + this.timeout;
    const clientId = randomUUID();
    const queued = await this.fetcher(new URL('prompt', this.base), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }), signal,
    });
    if (!queued.ok) throw new ComfyVideoError(`ComfyUI queue failed (HTTP ${queued.status})`);
    const result: unknown = await queued.json();
    if (!isObject(result) || typeof result.prompt_id !== 'string') {
      throw new ComfyVideoError('ComfyUI did not accept the workflow');
    }
    const id = result.prompt_id;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new ComfyVideoError('Invalid ComfyUI prompt ID');
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new ComfyVideoError('Video generation cancelled');
      const response = await this.fetcher(new URL('history/' + id, this.base), { signal });
      if (!response.ok) throw new ComfyVideoError(`ComfyUI status failed (HTTP ${response.status})`);
      const history: unknown = await response.json();
      if (!isObject(history)) throw new ComfyVideoError('Invalid ComfyUI status');
      const record = history[id];
      if (isObject(record)) {
        const status = record.status;
        if (isObject(status) && status.status_str === 'error') throw new ComfyVideoError('ComfyUI model execution failed');
        const outputs = record.outputs;
        if (isObject(outputs)) {
          for (const node of Object.values(outputs)) {
            if (!isObject(node)) continue;
            for (const field of ['videos', 'gifs', 'files']) {
              const entries = node[field];
              if (!Array.isArray(entries)) continue;
              for (const entry of entries) {
                if (!isObject(entry) || typeof entry.filename !== 'string') continue;
                const filename = cleanName(entry.filename);
                if (!/\\.(mp4|webm)$/i.test(filename)) continue;
                const resource = new URL('view', this.base);
                resource.searchParams.set('filename', filename);
                if (typeof entry.subfolder === 'string') resource.searchParams.set('subfolder', entry.subfolder);
                resource.searchParams.set('type', typeof entry.type === 'string' ? entry.type : 'output');
                const file = await this.fetcher(resource, { signal });
                if (!file.ok) throw new ComfyVideoError(`ComfyUI artifact unavailable (HTTP ${file.status})`);
                return { filename, bytes: new Uint8Array(await file.arrayBuffer()),
                  mimeType: filename.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/webm' };
              }
            }
          }
        }
        if (isObject(status) && status.completed === true) throw new ComfyVideoError('Workflow finished without video');
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, this.poll);
        function onAbort() { clearTimeout(timer); reject(new ComfyVideoError('Video generation cancelled')); }
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
    throw new ComfyVideoError('ComfyUI rendering timed out');
  }
}
