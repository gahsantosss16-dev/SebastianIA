import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CapabilityResult } from '../core/capability/index.js';
import type { CommandProcessingInput } from '../core/command/index.js';
import type { Logger } from '../core/logger.js';
import { LOCAL_CONVERSE_COMMAND_TYPE } from './LocalConverseCapabilityProvider.js';

export const SEBASTIAN_API_TOKEN_ENV_VAR = 'SEBASTIAN_API_TOKEN';
export const DEFAULT_ONLINE_PORT = 3000;
export const MAX_HTTP_BODY_BYTES = 16 * 1024;
export const MAX_CONVERSE_MESSAGE_CHARS = 4_000;
export const HTTP_BODY_TIMEOUT_MS = 10_000;
export const HTTP_EXECUTION_TIMEOUT_MS = 15_000;

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
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly createRequestId: () => string;
  private readonly executionTimeoutMs: number;
  private readonly server: Server;
  private converseInFlight = false;
  private shuttingDown = false;
  private applicationShutDown = false;

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
    this.logger = options.logger ?? silentLogger;
    this.now = options.now ?? (() => new Date());
    this.createRequestId = options.requestId ?? randomUUID;
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
      let executionStarted = false;
      try {
        const body = await readJsonBody(request);
        const message = extractMessage(body);
        const execution = this.application.executeCommand({
          type: LOCAL_CONVERSE_COMMAND_TYPE,
          input: { text: message },
          generatedAt: this.now().toISOString(),
        });
        executionStarted = true;
        void execution.then(
          () => {
            this.converseInFlight = false;
          },
          () => {
            this.converseInFlight = false;
          },
        );
        const result = await withTimeout(
          execution,
          this.executionTimeoutMs,
        );
        const publicMessage = extractPublicMessage(result);
        this.writeJson(response, 200, { ok: true, message: publicMessage, requestId });
      } finally {
        // A timed-out execution may still be settling because Promise.race
        // cannot cancel arbitrary application work. Keep the gate closed until
        // that real operation settles; only pre-execution parse failures can
        // release it here.
        if (!executionStarted) {
          this.converseInFlight = false;
        }
      }
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

  private isAuthorized(authorization: string | undefined): boolean {
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      return false;
    }
    const candidate = authorization.slice('Bearer '.length);
    if (candidate === '') {
      return false;
    }
    return timingSafeEqual(digestToken(candidate), this.expectedTokenDigest);
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

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new HttpRequestError(504, 'EXECUTION_TIMEOUT', 'Tempo de execução excedido.')),
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
