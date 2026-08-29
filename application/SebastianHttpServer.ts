import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname } from 'node:path';
import type { CapabilityResult } from '../core/capability/index.js';
import type { CommandProcessingInput } from '../core/command/index.js';
import type { Logger } from '../core/logger.js';
import { DEFAULT_GEMINI_RESPOND_TIMEOUT_MS } from '../core/cognition/index.js';
import { LOCAL_CONVERSE_COMMAND_TYPE } from './LocalConverseCapabilityProvider.js';
import { SEBASTIAN_WEB_HTML, SEBASTIAN_WEB_SCRIPT, SEBASTIAN_WEB_STYLES } from './SebastianWebInterface.js';

export const SEBASTIAN_API_TOKEN_ENV_VAR = 'SEBASTIAN_API_TOKEN';
export const DEFAULT_ONLINE_PORT = 3000;
export const MAX_HTTP_BODY_BYTES = 16 * 1024;
export const MAX_CONVERSE_MESSAGE_CHARS = 4_000;
export const HTTP_BODY_TIMEOUT_MS = 10_000;
export const HTTP_EXECUTION_TIMEOUT_MS = DEFAULT_GEMINI_RESPOND_TIMEOUT_MS + 1_000;
export const WEB_SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const WEB_SESSION_COOKIE = 'sebastian_session';

interface OnlineCommandExecutor {
  executeCommand(input: CommandProcessingInput): Promise<CapabilityResult>;
  shutdown(): void;
}

export interface SebastianHttpServerOptions {
  readonly application: OnlineCommandExecutor;
  readonly apiToken: string;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly requestId?: () => string;
  readonly sessionToken?: () => string;
  readonly webSessionStateFilePath?: string;
  readonly executionTimeoutMs?: number;
}

export interface StartedSebastianHttpServer {
  readonly server: Server;
  readonly port: number;
  close(): Promise<void>;
}

class HttpRequestError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  public constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'HttpRequestError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export class SebastianHttpServer {
  private readonly application: OnlineCommandExecutor;
  private readonly expectedTokenDigest: Buffer;
  private readonly webSessionSigningKey: Buffer;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly createRequestId: () => string;
  private readonly createSessionToken: () => string;
  private readonly webSessionStateFilePath: string | undefined;
  private readonly executionTimeoutMs: number;
  private readonly server: Server;
  private converseInFlight = false;
  private shuttingDown = false;
  private applicationShutDown = false;
  private inMemoryWebSession: WebSessionState | undefined;

  public constructor(options: SebastianHttpServerOptions) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Sebastian HTTP server options must be an object.');
    }
    if (!options.application || typeof options.application.executeCommand !== 'function') {
      throw new TypeError('Sebastian HTTP server application must provide executeCommand.');
    }
    if (typeof options.application.shutdown !== 'function') {
      throw new TypeError('Sebastian HTTP server application must provide shutdown.');
    }

    const apiToken = validateApiToken(options.apiToken);
    const executionTimeoutMs = options.executionTimeoutMs ?? HTTP_EXECUTION_TIMEOUT_MS;
    if (!Number.isInteger(executionTimeoutMs) || executionTimeoutMs <= 0) {
      throw new TypeError('Sebastian HTTP execution timeout must be a positive integer.');
    }

    this.application = options.application;
    this.expectedTokenDigest = digestToken(apiToken);
    this.webSessionSigningKey = createHmac('sha256', apiToken).update('sebastian-web-session-v1', 'utf8').digest();
    this.logger = options.logger ?? silentLogger;
    this.now = options.now ?? (() => new Date());
    this.createRequestId = options.requestId ?? randomUUID;
    this.createSessionToken = options.sessionToken ?? (() => randomBytes(32).toString('base64url'));
    if (options.webSessionStateFilePath !== undefined && options.webSessionStateFilePath.trim() === '') {
      throw new TypeError('Sebastian web session state file path must be non-empty when provided.');
    }
    this.webSessionStateFilePath = options.webSessionStateFilePath;
    this.executionTimeoutMs = executionTimeoutMs;
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    this.server.requestTimeout = HTTP_EXECUTION_TIMEOUT_MS + HTTP_BODY_TIMEOUT_MS;
    this.server.headersTimeout = HTTP_BODY_TIMEOUT_MS;
    this.server.keepAliveTimeout = 5_000;
  }

  public getNodeServer(): Server {
    return this.server;
  }

  public async listen(port: number, host = '0.0.0.0'): Promise<StartedSebastianHttpServer> {
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new TypeError('Sebastian HTTP port must be an integer between 0 and 65535.');
    }
    if (typeof host !== 'string' || host.trim() === '') {
      throw new TypeError('Sebastian HTTP host must be a non-empty string.');
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        this.server.off('error', onError);
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(port, host);
    });

    const address = this.server.address() as AddressInfo | null;
    if (!address) {
      throw new Error('Sebastian HTTP server did not expose a listening address.');
    }

    return {
      server: this.server,
      port: address.port,
      close: () => this.close(),
    };
  }

  public async close(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;

    await new Promise<void>((resolve, reject) => {
      if (!this.server.listening) {
        resolve();
        return;
      }
      this.server.close((error) => (error ? reject(error) : resolve()));
    });

    if (!this.applicationShutDown) {
      this.applicationShutDown = true;
      this.application.shutdown();
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = this.createRequestId();

    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/') {
        if (request.method !== 'GET') {
          this.writeError(response, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido.', requestId, { Allow: 'GET' });
          return;
        }
        this.writeWebAsset(response, 'text/html; charset=utf-8', SEBASTIAN_WEB_HTML);
        return;
      }

      if (url.pathname === '/assets/sebastian.css' || url.pathname === '/assets/sebastian.js') {
        if (request.method !== 'GET') {
          this.writeError(response, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido.', requestId, { Allow: 'GET' });
          return;
        }
        const isStylesheet = url.pathname.endsWith('.css');
        this.writeWebAsset(
          response,
          isStylesheet ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
          isStylesheet ? SEBASTIAN_WEB_STYLES : SEBASTIAN_WEB_SCRIPT,
        );
        return;
      }

      if (url.pathname === '/health') {
        if (request.method !== 'GET') {
          this.writeError(response, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido.', requestId, {
            Allow: 'GET',
          });
          return;
        }
        this.writeJson(response, 200, { status: 'ok' });
        return;
      }

      if (url.pathname === '/api/web/session') {
        await this.handleWebSession(request, response, requestId);
        return;
      }

      if (url.pathname === '/api/web/converse') {
        if (request.method !== 'POST') {
          this.writeError(response, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido.', requestId, { Allow: 'POST' });
          return;
        }
        if (!this.hasSameOrigin(request) || !this.hasValidWebSession(request)) {
          this.writeError(response, 401, 'UNAUTHORIZED', 'Sessão inválida ou expirada.', requestId);
          return;
        }
        await this.handleConverse(request, response, requestId);
        return;
      }

      if (url.pathname !== '/api/converse') {
        this.writeError(response, 404, 'NOT_FOUND', 'Rota não encontrada.', requestId);
        return;
      }
      if (request.method !== 'POST') {
        this.writeError(response, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido.', requestId, {
          Allow: 'POST',
        });
        return;
      }
      if (!this.isAuthorized(request.headers.authorization)) {
        this.writeError(response, 401, 'UNAUTHORIZED', 'Não autorizado.', requestId, {
          'WWW-Authenticate': 'Bearer',
        });
        return;
      }
      await this.handleConverse(request, response, requestId);
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        return;
      }
      if (error instanceof HttpRequestError) {
        this.writeError(response, error.statusCode, error.code, error.message, requestId);
        return;
      }

      this.logger.error('Online request failed.', { requestId });
      this.writeError(response, 500, 'INTERNAL_ERROR', 'Falha interna.', requestId);
    }
  }

  private async handleWebSession(
    request: IncomingMessage,
    response: ServerResponse,
    requestId: string,
  ): Promise<void> {
    if (request.method === 'GET') {
      this.writeJson(response, 200, { authenticated: this.hasValidWebSession(request) });
      return;
    }
    if (request.method === 'DELETE') {
      if (!this.hasSameOrigin(request)) {
        this.writeError(response, 403, 'FORBIDDEN', 'Origem não permitida.', requestId);
        return;
      }
      const sessionToken = readCookie(request.headers.cookie, WEB_SESSION_COOKIE);
      const activeSession = this.readWebSessionState();
      if (sessionToken !== undefined && activeSession !== undefined &&
          safelyEqualText(digestToken(sessionToken).toString('base64url'), activeSession.digest)) {
        this.writeWebSessionState(undefined);
      }
      this.writeJson(response, 200, { authenticated: false }, { 'Set-Cookie': this.expiredSessionCookie() });
      return;
    }
    if (request.method !== 'POST') {
      this.writeError(response, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido.', requestId, { Allow: 'GET, POST, DELETE' });
      return;
    }
    if (!this.hasSameOrigin(request)) {
      this.writeError(response, 403, 'FORBIDDEN', 'Origem não permitida.', requestId);
      return;
    }
    if (!isJsonContentType(request.headers['content-type'])) {
      this.writeError(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type deve ser application/json.', requestId);
      return;
    }
    const body = await readJsonBody(request);
    const candidate = extractSessionCredential(body);
    if (!this.isValidToken(candidate)) {
      this.writeError(response, 401, 'UNAUTHORIZED', 'Chave de acesso inválida.', requestId);
      return;
    }

    const expiresAt = this.now().getTime() + WEB_SESSION_TTL_MS;
    const sessionToken = this.createWebSessionToken(expiresAt);
    this.writeWebSessionState({
      digest: digestToken(sessionToken).toString('base64url'),
      expiresAt,
    });
    this.writeJson(response, 201, { authenticated: true }, {
      'Set-Cookie': `${WEB_SESSION_COOKIE}=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(WEB_SESSION_TTL_MS / 1_000)}`,
    });
  }

  private async handleConverse(
    request: IncomingMessage,
    response: ServerResponse,
    requestId: string,
  ): Promise<void> {
    if (!isJsonContentType(request.headers['content-type'])) {
      this.writeError(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type deve ser application/json.', requestId);
      return;
    }
    if (this.converseInFlight) {
      this.writeError(response, 503, 'SERVICE_BUSY', 'Serviço ocupado. Tente novamente.', requestId, {
        'Retry-After': '1',
      });
      return;
    }

    this.converseInFlight = true;
    const controller = new AbortController();
    const abortOnDisconnect = (): void => controller.abort();
    request.once('aborted', abortOnDisconnect);
    response.once('close', abortOnDisconnect);
    try {
      const body = await readJsonBody(request);
      const message = extractMessage(body);
      const execution = this.application.executeCommand({
        type: LOCAL_CONVERSE_COMMAND_TYPE,
        input: { text: message },
        generatedAt: this.now().toISOString(),
        signal: controller.signal,
      });
      const result = await withTimeout(execution, this.executionTimeoutMs, () => controller.abort());
      const publicMessage = extractPublicMessage(result);
      this.writeJson(response, 200, { ok: true, message: publicMessage, requestId });
    } finally {
      request.off('aborted', abortOnDisconnect);
      response.off('close', abortOnDisconnect);
      this.converseInFlight = false;
    }
  }

  private isAuthorized(authorization: string | undefined): boolean {
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      return false;
    }
    const candidate = authorization.slice('Bearer '.length);
    if (candidate === '') {
      return false;
    }
    return this.isValidToken(candidate);
  }

  private isValidToken(candidate: string): boolean {
    return timingSafeEqual(digestToken(candidate), this.expectedTokenDigest);
  }

  private hasSameOrigin(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (typeof origin !== 'string' || typeof host !== 'string') {
      return false;
    }
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  private hasValidWebSession(request: IncomingMessage): boolean {
    const candidate = readCookie(request.headers.cookie, WEB_SESSION_COOKIE);
    if (candidate === undefined) {
      return false;
    }
    const parts = candidate.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1' || !/^\d+$/.test(parts[1] ?? '')) {
      return false;
    }
    const expiresAt = Number(parts[1]);
    if (!Number.isSafeInteger(expiresAt) || this.now().getTime() >= expiresAt) {
      return false;
    }
    const payload = parts.slice(0, 3).join('.');
    const suppliedSignature = Buffer.from(parts[3] ?? '', 'base64url');
    const expectedSignature = createHmac('sha256', this.webSessionSigningKey).update(payload, 'utf8').digest();
    if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) {
      return false;
    }
    const activeSession = this.readWebSessionState();
    return activeSession !== undefined && activeSession.expiresAt === expiresAt &&
      safelyEqualText(digestToken(candidate).toString('base64url'), activeSession.digest);
  }

  private createWebSessionToken(expiresAt: number): string {
    const payload = `v1.${expiresAt}.${this.createSessionToken()}`;
    const signature = createHmac('sha256', this.webSessionSigningKey).update(payload, 'utf8').digest('base64url');
    return `${payload}.${signature}`;
  }

  private readWebSessionState(): WebSessionState | undefined {
    if (this.webSessionStateFilePath === undefined) {
      return this.inMemoryWebSession;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.webSessionStateFilePath, 'utf8')) as unknown;
      return parseWebSessionState(parsed);
    } catch {
      return undefined;
    }
  }

  private writeWebSessionState(state: WebSessionState | undefined): void {
    this.inMemoryWebSession = state;
    if (this.webSessionStateFilePath === undefined) {
      return;
    }
    mkdirSync(dirname(this.webSessionStateFilePath), { recursive: true });
    writeFileSync(this.webSessionStateFilePath, JSON.stringify(state ?? null), { encoding: 'utf8', mode: 0o600 });
  }

  private expiredSessionCookie(): string {
    return `${WEB_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
  }

  private writeWebAsset(response: ServerResponse, contentType: string, body: string): void {
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    response.end(body);
  }

  private writeError(
    response: ServerResponse,
    statusCode: number,
    code: string,
    message: string,
    requestId: string,
    headers: Readonly<Record<string, string>> = {},
  ): void {
    this.writeJson(response, statusCode, { ok: false, error: { code, message }, requestId }, headers);
  }

  private writeJson(
    response: ServerResponse,
    statusCode: number,
    payload: Readonly<Record<string, unknown>>,
    headers: Readonly<Record<string, string>> = {},
  ): void {
    const body = JSON.stringify(payload);
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    });
    response.end(body);
  }
}

interface WebSessionState {
  readonly digest: string;
  readonly expiresAt: number;
}

function parseWebSessionState(value: unknown): WebSessionState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as { readonly digest?: unknown; readonly expiresAt?: unknown };
  if (typeof candidate.digest !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(candidate.digest) ||
      !Number.isSafeInteger(candidate.expiresAt) || (candidate.expiresAt as number) <= 0) {
    return undefined;
  }
  return { digest: candidate.digest, expiresAt: candidate.expiresAt as number };
}

function safelyEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function resolveOnlineApiToken(env: NodeJS.ProcessEnv = process.env): string {
  return validateApiToken(env[SEBASTIAN_API_TOKEN_ENV_VAR]);
}

export function resolveOnlinePort(value: string | undefined = process.env.PORT): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_ONLINE_PORT;
  }
  if (!/^\d+$/.test(value)) {
    throw new TypeError('PORT must be an integer between 1 and 65535.');
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('PORT must be an integer between 1 and 65535.');
  }
  return port;
}

function validateApiToken(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${SEBASTIAN_API_TOKEN_ENV_VAR} must be configured with a non-empty value.`);
  }
  return value;
}

function digestToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function isJsonContentType(value: string | undefined): boolean {
  return typeof value === 'string' && value.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

function extractMessage(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpRequestError(400, 'INVALID_REQUEST', 'Requisição inválida.');
  }
  const message = (body as { readonly message?: unknown }).message;
  if (typeof message !== 'string' || message.trim() === '') {
    throw new HttpRequestError(400, 'INVALID_REQUEST', 'Mensagem deve ser um texto não vazio.');
  }
  if (message.length > MAX_CONVERSE_MESSAGE_CHARS) {
    throw new HttpRequestError(400, 'INVALID_REQUEST', 'Mensagem excede o limite permitido.');
  }
  return message.trim();
}

function extractSessionCredential(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpRequestError(400, 'INVALID_REQUEST', 'Requisição inválida.');
  }
  const token = (body as { readonly token?: unknown }).token;
  if (typeof token !== 'string' || token === '' || token.length > MAX_HTTP_BODY_BYTES) {
    throw new HttpRequestError(400, 'INVALID_REQUEST', 'Chave de acesso inválida.');
  }
  return token;
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (typeof cookieHeader !== 'string') {
    return undefined;
  }
  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== name) {
      continue;
    }
    const value = entry.slice(separator + 1).trim();
    return value === '' ? undefined : value;
  }
  return undefined;
}

function extractPublicMessage(result: CapabilityResult): string {
  const message = result.output.message;
  return typeof message === 'string' && message.trim() !== '' ? message : 'Solicitação processada.';
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new HttpRequestError(408, 'REQUEST_TIMEOUT', 'Tempo de requisição excedido.'));
    }, HTTP_BODY_TIMEOUT_MS);

    const cleanup = (): void => {
      clearTimeout(timeout);
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
    };
    const onData = (chunk: Buffer): void => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_HTTP_BODY_BYTES) {
        cleanup();
        request.resume();
        reject(new HttpRequestError(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisição excede o limite permitido.'));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      cleanup();
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      } catch {
        reject(new HttpRequestError(400, 'INVALID_JSON', 'JSON inválido.'));
      }
    };
    const onError = (): void => {
      cleanup();
      reject(new HttpRequestError(400, 'INVALID_REQUEST', 'Requisição inválida.'));
    };
    const onAborted = (): void => {
      cleanup();
      reject(new HttpRequestError(400, 'INVALID_REQUEST', 'Requisição interrompida.'));
    };

    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAborted);
  });
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => {
        onTimeout();
        reject(new HttpRequestError(504, 'EXECUTION_TIMEOUT', 'Tempo de execução excedido.'));
      },
      timeoutMs,
    );
  });

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
