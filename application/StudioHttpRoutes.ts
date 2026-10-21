import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { StudioJobError, type StudioJobErrorCode, type StudioRenderJobs } from '../studio/StudioRenderJobs.js';

/**
 * Sebastian Studio API, mounted by SebastianHttpServer under /api/studio/.
 *
 * Authentication: every route requires a valid web session (the single
 * Sebastian owner holds the access key; every valid device session is that
 * owner). Authorization: state-changing routes (POST/DELETE) also require a
 * same-origin request (CSRF), jobs are addressed by unguessable UUIDs and
 * videos only by their exact generated file name.
 *
 *   GET    /api/studio/status                 engine availability and cost
 *   POST   /api/studio/render  { plan }       202 { jobId, statusUrl, ... }
 *   GET    /api/studio/jobs/:id               status, stage, progress, downloadUrl
 *   DELETE /api/studio/jobs/:id               real cancellation
 *   GET    /api/studio/renders/:file.mp4      MP4 with Range (206) support; HEAD too
 */

export interface StudioRouteContext {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
  readonly authenticated: boolean;
  readonly sameOrigin: boolean;
  readJson(): Promise<unknown>;
  writeJson(statusCode: number, payload: Readonly<Record<string, unknown>>, headers?: Readonly<Record<string, string>>): void;
  writeError(statusCode: number, code: string, message: string, headers?: Readonly<Record<string, string>>): void;
}

const JOB_PATH = /^\/api\/studio\/jobs\/([0-9a-f-]{36})$/;
const RENDER_PREFIX = '/api/studio/renders/';

const ERROR_STATUS: Readonly<Record<StudioJobErrorCode, number>> = {
  STUDIO_UNAVAILABLE: 503,
  STUDIO_BUSY: 429,
  INVALID_STUDIO_PLAN: 400,
  STUDIO_COST_APPROVAL_REQUIRED: 402,
};

export async function handleStudioApi(jobs: StudioRenderJobs, context: StudioRouteContext): Promise<void> {
  const { request, url } = context;
  const method = request.method ?? 'GET';
  if (!context.authenticated) {
    context.writeError(401, 'UNAUTHORIZED', 'Sessão inválida ou expirada.');
    return;
  }
  if ((method === 'POST' || method === 'DELETE') && !context.sameOrigin) {
    context.writeError(403, 'FORBIDDEN', 'Origem não permitida.');
    return;
  }

  if (url.pathname === '/api/studio/status') {
    if (method !== 'GET') return methodNotAllowed(context, 'GET');
    context.writeJson(200, { ok: true, ...(await jobs.availability()) });
    return;
  }

  if (url.pathname === '/api/studio/render') {
    if (method !== 'POST') return methodNotAllowed(context, 'POST');
    if (!/^application\/json(\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
      context.writeError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type deve ser application/json.');
      return;
    }
    const body = await context.readJson();
    const plan = body && typeof body === 'object' && !Array.isArray(body) ? (body as { readonly plan?: unknown }).plan : undefined;
    try {
      const job = await jobs.submit(plan);
      context.writeJson(202, { ok: true, jobId: job.id, ...job }, { Location: job.statusUrl });
    } catch (error) {
      if (!(error instanceof StudioJobError)) throw error;
      context.writeError(ERROR_STATUS[error.code], error.code, error.message);
    }
    return;
  }

  const jobMatch = JOB_PATH.exec(url.pathname);
  if (jobMatch) {
    const id = jobMatch[1] ?? '';
    if (method !== 'GET' && method !== 'DELETE') return methodNotAllowed(context, 'GET, DELETE');
    const job = method === 'DELETE' ? jobs.cancel(id) : jobs.get(id);
    if (!job) {
      context.writeError(404, 'STUDIO_JOB_NOT_FOUND', 'Renderização não encontrada.');
      return;
    }
    context.writeJson(200, { ok: true, ...job });
    return;
  }

  if (url.pathname.startsWith(RENDER_PREFIX)) {
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(context, 'GET, HEAD');
    const path = jobs.resolveRender(url.pathname.slice(RENDER_PREFIX.length));
    if (!path) {
      context.writeError(404, 'NOT_FOUND', 'Vídeo não encontrado.');
      return;
    }
    await serveVideo(context, path, url.pathname.slice(RENDER_PREFIX.length));
    return;
  }

  context.writeError(404, 'NOT_FOUND', 'Rota do Studio não encontrada.');
}

function methodNotAllowed(context: StudioRouteContext, allow: string): void {
  context.writeError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.', { Allow: allow });
}

/** Single-range byte serving (RFC 9110): enough for <video> seeking and Safari/iOS playback. */
async function serveVideo(context: StudioRouteContext, path: string, fileName: string): Promise<void> {
  const { request, response } = context;
  const size = (await stat(path)).size;
  const headers: Record<string, string> = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `inline; filename="${fileName}"`,
    'X-Content-Type-Options': 'nosniff',
  };
  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = request.headers.range;
  if (typeof range === 'string' && range.trim() !== '') {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    // Multi-range or other units are ignored: a full 200 response is a valid answer.
    if (match && (match[1] !== '' || match[2] !== '')) {
      if (match[1] === '') {
        const suffix = Number(match[2]);
        start = Math.max(0, size - suffix);
      } else {
        start = Number(match[1]);
        if (match[2] !== '') end = Math.min(end, Number(match[2]));
      }
      if (size === 0 || start >= size || start > end || (match[1] === '' && Number(match[2]) === 0)) {
        response.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': '0' });
        response.end();
        return;
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
  }
  headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1);
  response.writeHead(status, headers);
  if (request.method === 'HEAD' || size === 0) {
    response.end();
    return;
  }
  try {
    await pipeline(createReadStream(path, { start, end }), response);
  } catch {
    response.destroy();
  }
}
