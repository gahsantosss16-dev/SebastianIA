import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CapabilityResult } from '../../core/capability/index.js';
import type { CommandProcessingInput } from '../../core/command/index.js';
import type { Logger } from '../../core/logger.js';
import type { CognitiveModelProvider } from '../../core/cognition/index.js';
import { ConversationRegistry, FileCommandContextHydrator, FileMemoryStore, resolveMemoryFilePath } from '../../core/memory/index.js';
import { createOnlineSebastianApplication } from '../../application/OnlineSebastianApplication.js';
import {
  DEFAULT_ONLINE_PORT,
  MAX_HTTP_BODY_BYTES,
  WEB_SESSION_TTL_MS,
  resolveOnlineApiToken,
  resolveOnlinePort,
  SebastianHttpServer,
} from '../../application/SebastianHttpServer.js';

const API_TOKEN = 'test-only-private-token-that-is-never-logged';

interface TestApplication {
  executeCommand(input: CommandProcessingInput): Promise<CapabilityResult>;
  shutdown(): void;
}

interface RunningTestServer {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function createTestConversationRegistry(memoryFilePath?: string): ConversationRegistry {
  const path = memoryFilePath ?? join(mkdtempSync(join(tmpdir(), 'sebastian-conversations-')), 'memory.json');
  const store = new FileMemoryStore(path);
  return new ConversationRegistry(store, new FileCommandContextHydrator(store));
}

/** Builds a conversation registry backed by the exact same memory.json a `dataDir`-scoped online application persists to - mirrors how http.ts wires the two together. */
function createConversationRegistryForDataDir(dataDir: string): ConversationRegistry {
  return createTestConversationRegistry(resolveMemoryFilePath(dataDir));
}

async function startServer(
  application: TestApplication,
  logger: Logger = silentLogger,
  executionTimeoutMs?: number,
  now: () => Date = () => new Date('2026-08-27T12:00:00.000Z'),
  webSessionStateFilePath?: string,
  conversationRegistry: ConversationRegistry = createTestConversationRegistry(),
): Promise<RunningTestServer> {
  let sessionSequence = 0;
  const http = new SebastianHttpServer({
    application,
    apiToken: API_TOKEN,
    conversationRegistry,
    logger,
    requestId: () => 'request-test-id',
    sessionToken: () => `opaque-web-session-test-token-${sessionSequence++}`,
    now,
    ...(webSessionStateFilePath === undefined ? {} : { webSessionStateFilePath }),
    ...(executionTimeoutMs === undefined ? {} : { executionTimeoutMs }),
  });
  const started = await http.listen(0, '127.0.0.1');
  return { baseUrl: `http://127.0.0.1:${started.port}`, close: started.close };
}

function successfulApplication(message = 'Resposta real do Sebastian.'): TestApplication {
  return {
    executeCommand: async () => ({
      status: 'succeeded',
      output: { message },
      generatedAt: '2026-08-27T12:00:00.000Z',
    }),
    shutdown: () => undefined,
  };
}

async function converse(baseUrl: string, message: string, token = API_TOKEN): Promise<Response> {
  return fetch(`${baseUrl}/api/converse`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });
}

async function createWebSession(baseUrl: string, token = API_TOKEN): Promise<string> {
  const response = await fetch(`${baseUrl}/api/web/session`, {
    method: 'POST',
    headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  assert.equal(response.status, 201);
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Max-Age=43200/);
  return setCookie.split(';', 1)[0] ?? '';
}

async function webConverse(baseUrl: string, cookie: string, message: string, conversationId?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/web/converse`, {
    method: 'POST',
    headers: { Origin: baseUrl, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(conversationId === undefined ? { message } : { message, conversationId }),
  });
}

async function createWebConversation(baseUrl: string, cookie: string): Promise<{ readonly id: string; readonly title: string }> {
  const response = await fetch(`${baseUrl}/api/web/conversations`, {
    method: 'POST',
    headers: { Origin: baseUrl, Cookie: cookie },
  });
  assert.equal(response.status, 201);
  const body = await response.json() as { readonly conversation: { readonly id: string; readonly title: string } };
  return body.conversation;
}

// Deliberately no Origin header on these two GET helpers - a real browser
// does not send one for a plain same-origin GET, and the server must accept
// that (see SebastianHttpServer's GET vs POST same-origin split).
async function listWebConversations(baseUrl: string, cookie: string): Promise<readonly { readonly id: string; readonly title: string; readonly lastActivityAt: string }[]> {
  const response = await fetch(`${baseUrl}/api/web/conversations`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const body = await response.json() as { readonly conversations: readonly { readonly id: string; readonly title: string; readonly lastActivityAt: string }[] };
  return body.conversations;
}

async function getWebConversation(baseUrl: string, cookie: string, id: string): Promise<Response> {
  return fetch(`${baseUrl}/api/web/conversations/${encodeURIComponent(id)}`, { headers: { Cookie: cookie } });
}

test('SPEC-049: missing API token fails before server construction', () => {
  assert.throws(() => resolveOnlineApiToken({}), /SEBASTIAN_API_TOKEN must be configured/);
  assert.throws(() => resolveOnlineApiToken({ SEBASTIAN_API_TOKEN: '   ' }), /must be configured/);
  assert.equal(resolveOnlineApiToken({ SEBASTIAN_API_TOKEN: API_TOKEN }), API_TOKEN);
});

test('SPEC-049: PORT uses 3000 by default and rejects unsafe values', () => {
  assert.equal(resolveOnlinePort(undefined), DEFAULT_ONLINE_PORT);
  assert.equal(resolveOnlinePort('3000'), 3000);
  for (const value of ['0', '-1', '65536', '3.5', 'abc']) {
    assert.throws(() => resolveOnlinePort(value), /PORT must be an integer/);
  }
});

test('SPEC-049: GET /health is public, minimal and does not expose internals', async () => {
  const running = await startServer(successfulApplication());
  try {
    const response = await fetch(`${running.baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    await running.close();
  }
});

test('WEB: GET / serves the responsive Sebastian interface without embedding environment secrets', async () => {
  const previousCognitiveKey = process.env.SEBASTIAN_COGNITIVE_API_KEY;
  process.env.SEBASTIAN_COGNITIVE_API_KEY = 'cognitive-secret-that-must-not-reach-browser';
  const running = await startServer(successfulApplication());
  try {
    const root = await fetch(`${running.baseUrl}/`);
    const html = await root.text();
    const scriptResponse = await fetch(`${running.baseUrl}/assets/sebastian.js`);
    const script = await scriptResponse.text();
    assert.equal(root.status, 200);
    assert.equal(root.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(root.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    assert.match(html, /SebastianIA/);
    assert.match(html, /Estou online e pronto para conversar/);
    assert.match(html, /class="unlock hidden"/);
    assert.match(script, /shiftKey/);
    assert.match(script, /else \{\s*showUnlock\(\);/);
    for (const forbidden of [
      API_TOKEN,
      'cognitive-secret-that-must-not-reach-browser',
      'SEBASTIAN_API_TOKEN',
      'SEBASTIAN_COGNITIVE_API_KEY',
      'process.env',
      'localStorage',
      'sessionStorage',
    ]) {
      assert.equal(html.includes(forbidden), false);
      assert.equal(script.includes(forbidden), false);
    }
  } finally {
    if (previousCognitiveKey === undefined) delete process.env.SEBASTIAN_COGNITIVE_API_KEY;
    else process.env.SEBASTIAN_COGNITIVE_API_KEY = previousCognitiveKey;
    await running.close();
  }
});

test('WEB: session survives page reopen, expires after 12 hours and logout invalidates it server-side', async () => {
  let nowMs = new Date('2026-08-27T12:00:00.000Z').getTime();
  const running = await startServer(successfulApplication(), silentLogger, undefined, () => new Date(nowMs));
  try {
    const invalid = await fetch(`${running.baseUrl}/api/web/session`, {
      method: 'POST',
      headers: { Origin: running.baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'credencial-inválida' }),
    });
    assert.equal(invalid.status, 401);

    const cookie = await createWebSession(running.baseUrl);
    const refresh = await fetch(`${running.baseUrl}/api/web/session`, { headers: { Cookie: cookie } });
    assert.deepEqual(await refresh.json(), { authenticated: true });

    const reopened = await fetch(`${running.baseUrl}/api/web/session`, { headers: { Cookie: cookie } });
    assert.deepEqual(await reopened.json(), { authenticated: true });

    const logout = await fetch(`${running.baseUrl}/api/web/session`, {
      method: 'DELETE',
      headers: { Origin: running.baseUrl, Cookie: cookie },
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/);
    const afterLogout = await fetch(`${running.baseUrl}/api/web/session`, { headers: { Cookie: cookie } });
    assert.deepEqual(await afterLogout.json(), { authenticated: false });

    const renewedCookie = await createWebSession(running.baseUrl);
    nowMs += WEB_SESSION_TTL_MS;
    const expired = await fetch(`${running.baseUrl}/api/web/session`, { headers: { Cookie: renewedCookie } });
    assert.deepEqual(await expired.json(), { authenticated: false });
    assert.equal((await webConverse(running.baseUrl, renewedCookie, 'Olá')).status, 401);
  } finally {
    await running.close();
  }
});

test('WEB: refresh and a new tab keep the same signed session across backend restart', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'sebastian-web-session-'));
  const stateFile = join(stateDir, 'web-session.json');
  const first = await startServer(successfulApplication(), silentLogger, undefined, undefined, stateFile);
  try {
    const firstCookie = await createWebSession(first.baseUrl);
    const refresh = await fetch(`${first.baseUrl}/api/web/session`, { headers: { Cookie: firstCookie } });
    assert.deepEqual(await refresh.json(), { authenticated: true });

    const secondCookie = await createWebSession(first.baseUrl);
    const persistedState = readFileSync(stateFile, 'utf8');
    assert.equal(persistedState.includes(API_TOKEN), false);
    assert.equal(persistedState.includes(secondCookie.split('=', 2)[1] ?? ''), false);
    const superseded = await fetch(`${first.baseUrl}/api/web/session`, { headers: { Cookie: firstCookie } });
    assert.deepEqual(await superseded.json(), { authenticated: false });
    await first.close();

    const restarted = await startServer(successfulApplication(), silentLogger, undefined, undefined, stateFile);
    try {
      const newTab = await fetch(`${restarted.baseUrl}/api/web/session`, { headers: { Cookie: secondCookie } });
      assert.deepEqual(await newTab.json(), { authenticated: true });

      const logout = await fetch(`${restarted.baseUrl}/api/web/session`, {
        method: 'DELETE', headers: { Origin: restarted.baseUrl, Cookie: secondCookie },
      });
      assert.equal(logout.status, 200);
      await restarted.close();

      const afterLogoutRestart = await startServer(successfulApplication(), silentLogger, undefined, undefined, stateFile);
      try {
        const revoked = await fetch(`${afterLogoutRestart.baseUrl}/api/web/session`, { headers: { Cookie: secondCookie } });
        assert.deepEqual(await revoked.json(), { authenticated: false });

        const tamperedCookie = `${secondCookie.slice(0, -1)}${secondCookie.endsWith('a') ? 'b' : 'a'}`;
        const invalid = await fetch(`${afterLogoutRestart.baseUrl}/api/web/session`, { headers: { Cookie: tamperedCookie } });
        assert.deepEqual(await invalid.json(), { authenticated: false });
      } finally {
        await afterLogoutRestart.close();
      }
    } finally {
      await restarted.close();
    }
  } finally {
    await first.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('WEB: an opaque HttpOnly session reaches the same real converse command without exposing the Bearer token', async () => {
  const inputs: CommandProcessingInput[] = [];
  const application: TestApplication = {
    executeCommand: async (input) => {
      inputs.push(input);
      return { status: 'succeeded', output: { message: 'Resposta pela interface.' }, generatedAt: input.generatedAt };
    },
    shutdown: () => undefined,
  };
  const running = await startServer(application);
  try {
    const unauthenticated = await webConverse(running.baseUrl, '', 'Olá');
    assert.equal(unauthenticated.status, 401);

    const invalidSession = await fetch(`${running.baseUrl}/api/web/session`, {
      method: 'POST',
      headers: { Origin: running.baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'wrong' }),
    });
    assert.equal(invalidSession.status, 401);

    const cookie = await createWebSession(running.baseUrl);
    assert.equal(cookie.includes(API_TOKEN), false);
    const response = await webConverse(running.baseUrl, cookie, '  Olá Sebastian  ');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      message: 'Resposta pela interface.',
      requestId: 'request-test-id',
    });
    assert.equal(inputs[0]?.signal instanceof AbortSignal, true);
    assert.deepEqual(inputs.map(({ signal: _signal, ...input }) => input), [
      { type: 'converse', input: { text: 'Olá Sebastian' }, generatedAt: '2026-08-27T12:00:00.000Z' },
    ]);
  } finally {
    await running.close();
  }
});

test('WEB: session flow is same-origin and internal failures stay generic', async () => {
  const application: TestApplication = {
    executeCommand: async () => {
      throw new Error(`private failure containing ${API_TOKEN}`);
    },
    shutdown: () => undefined,
  };
  const running = await startServer(application);
  try {
    const crossOrigin = await fetch(`${running.baseUrl}/api/web/session`, {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: API_TOKEN }),
    });
    assert.equal(crossOrigin.status, 403);

    const cookie = await createWebSession(running.baseUrl);
    const response = await webConverse(running.baseUrl, cookie, 'Falhe com segurança');
    assert.equal(response.status, 500);
    const body = JSON.stringify(await response.json());
    assert.equal(body.includes(API_TOKEN), false);
    assert.equal(body.includes('private failure'), false);
  } finally {
    await running.close();
  }
});

test('SPEC-049: /health rejects other methods and unknown routes stay closed', async () => {
  const running = await startServer(successfulApplication());
  try {
    const wrongMethod = await fetch(`${running.baseUrl}/health`, { method: 'POST' });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET');

    const unknown = await fetch(`${running.baseUrl}/internal`);
    assert.equal(unknown.status, 404);
  } finally {
    await running.close();
  }
});

test('SPEC-049: POST /api/converse requires the Bearer token and never accepts it in the query string', async () => {
  const running = await startServer(successfulApplication());
  try {
    const request = (url: string, authorization?: string) =>
      fetch(url, {
        method: 'POST',
        headers: {
          ...(authorization === undefined ? {} : { Authorization: authorization }),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: 'Olá' }),
      });

    assert.equal((await request(`${running.baseUrl}/api/converse`)).status, 401);
    assert.equal((await request(`${running.baseUrl}/api/converse`, 'Bearer incorreto')).status, 401);
    assert.equal((await request(`${running.baseUrl}/api/converse?token=${API_TOKEN}`)).status, 401);
    assert.equal((await request(`${running.baseUrl}/api/converse`, `Bearer ${API_TOKEN}`)).status, 200);
  } finally {
    await running.close();
  }
});

test('SPEC-049: POST /api/converse reaches the real command contract and only returns the public message', async () => {
  const inputs: CommandProcessingInput[] = [];
  const application: TestApplication = {
    executeCommand: async (input) => {
      inputs.push(input);
      return {
        status: 'succeeded',
        output: { message: 'Resposta pública.', internalPath: 'C:/secret', goalExecution: { steps: ['secret'] } },
        generatedAt: '2026-08-27T12:00:01.000Z',
      };
    },
    shutdown: () => undefined,
  };
  const running = await startServer(application);
  try {
    const response = await converse(running.baseUrl, '  Quais são minhas tarefas?  ');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      message: 'Resposta pública.',
      requestId: 'request-test-id',
    });
    assert.equal(inputs[0]?.signal instanceof AbortSignal, true);
    assert.deepEqual(inputs.map(({ signal: _signal, ...input }) => input), [
      {
        type: 'converse',
        input: { text: 'Quais são minhas tarefas?' },
        generatedAt: '2026-08-27T12:00:00.000Z',
      },
    ]);
  } finally {
    await running.close();
  }
});

test('SPEC-049: invalid JSON, schema, content type, method and oversized bodies are bounded', async () => {
  const running = await startServer(successfulApplication());
  try {
    const headers = { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' };
    const invalidJson = await fetch(`${running.baseUrl}/api/converse`, { method: 'POST', headers, body: '{' });
    assert.equal(invalidJson.status, 400);

    const invalidMessage = await fetch(`${running.baseUrl}/api/converse`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: '   ' }),
    });
    assert.equal(invalidMessage.status, 400);

    const wrongContentType = await fetch(`${running.baseUrl}/api/converse`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'text/plain' },
      body: 'Olá',
    });
    assert.equal(wrongContentType.status, 415);

    const wrongMethod = await fetch(`${running.baseUrl}/api/converse`, { method: 'GET' });
    assert.equal(wrongMethod.status, 405);

    const oversized = await fetch(`${running.baseUrl}/api/converse`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'x'.repeat(MAX_HTTP_BODY_BYTES + 1) }),
    });
    assert.equal(oversized.status, 413);
  } finally {
    await running.close();
  }
});

test('SPEC-049: concurrent converse work is rejected instead of building an unbounded queue', async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const application: TestApplication = {
    executeCommand: async () => {
      await gate;
      return { status: 'succeeded', output: { message: 'ok' }, generatedAt: new Date().toISOString() };
    },
    shutdown: () => undefined,
  };
  const running = await startServer(application);
  try {
    const first = converse(running.baseUrl, 'primeira');
    await new Promise<void>((resolve) => setImmediate(resolve));
    const second = await converse(running.baseUrl, 'segunda');
    assert.equal(second.status, 503);
    release?.();
    assert.equal((await first).status, 200);
  } finally {
    release?.();
    await running.close();
  }
});

test('SPEC-049: an execution timeout aborts work and immediately releases the concurrency gate', async () => {
  let calls = 0;
  let aborted = false;
  const application: TestApplication = {
    executeCommand: async (input) => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((_resolve, reject) => {
          input.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          }, { once: true });
        });
      }
      return { status: 'succeeded', output: { message: 'ok' }, generatedAt: new Date().toISOString() };
    },
    shutdown: () => undefined,
  };
  const running = await startServer(application, silentLogger, 10);
  try {
    const timedOut = await converse(running.baseUrl, 'primeira');
    assert.equal(timedOut.status, 504);
    assert.equal(aborted, true);

    const afterTimeout = await converse(running.baseUrl, 'segunda');
    assert.equal(afterTimeout.status, 200);
    assert.equal(calls, 2);
  } finally {
    await running.close();
  }
});

test('SPEC-049: internal failures are generic and neither token nor exception details reach response or logs', async () => {
  const logged: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message, metadata) => logged.push({ message, ...(metadata === undefined ? {} : { metadata }) }),
  };
  const application: TestApplication = {
    executeCommand: async () => {
      throw new Error(`internal path and token ${API_TOKEN}`);
    },
    shutdown: () => undefined,
  };
  const running = await startServer(application, logger);
  try {
    const response = await converse(running.baseUrl, `message containing ${API_TOKEN}`);
    assert.equal(response.status, 500);
    const serializedResponse = JSON.stringify(await response.json());
    const serializedLogs = JSON.stringify(logged);
    assert.equal(serializedResponse.includes(API_TOKEN), false);
    assert.equal(serializedResponse.includes('internal path'), false);
    assert.equal(serializedLogs.includes(API_TOKEN), false);
    assert.equal(serializedLogs.includes('internal path'), false);
  } finally {
    await running.close();
  }
});

test('SPEC-049: shutdown closes the server and shuts down the application exactly once', async () => {
  let shutdownCalls = 0;
  const application: TestApplication = {
    ...successfulApplication(),
    shutdown: () => {
      shutdownCalls += 1;
    },
  };
  const running = await startServer(application);
  await running.close();
  await running.close();
  assert.equal(shutdownCalls, 1);
});

test('SPEC-049: the real online application preserves deterministic conversation', async () => {
  const application = createOnlineSebastianApplication(silentLogger);
  const running = await startServer(application);
  try {
    const response = await converse(running.baseUrl, 'Quais são minhas tarefas?');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      message: 'Você não tem nenhuma tarefa pendente.',
      requestId: 'request-test-id',
    });
  } finally {
    await running.close();
  }
});

test('SPEC-050: real online application uses remote cognition only for unknown text and never forwards HTTP token', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-online-cognitive-context-'));
  const requests: unknown[] = [];
  let toolLikeRequestCount = 0;
  const cognitiveSecret = 'fake-cognitive-secret-that-must-never-be-forwarded';
  const cognitiveModelProvider: CognitiveModelProvider = {
    decide: async () => ({ outcome: 'unavailable', reason: 'unused' }),
    respond: async (request) => {
      requests.push(request);
      if (request.text.includes('arquivo')) {
        toolLikeRequestCount += 1;
      }
      return { outcome: 'responded', answer: 'Resposta remota segura.' };
    },
  };
  const application = createOnlineSebastianApplication(silentLogger, cognitiveModelProvider, dataDir);
  const running = await startServer(application);
  try {
    const known = await converse(running.baseUrl, 'Quais são minhas tarefas?');
    assert.equal(known.status, 200);
    assert.equal(requests.length, 0);

    const unknown = await converse(running.baseUrl, 'Explique a diferença entre recursão e iteração.');
    assert.equal(unknown.status, 200);
    assert.deepEqual(await unknown.json(), {
      ok: true,
      message: 'Resposta remota segura.',
      requestId: 'request-test-id',
    });
    assert.deepEqual(requests, [
      {
        text: 'Explique a diferença entre recursão e iteração.',
        requestedAt: '2026-08-27T12:00:00.000Z',
      },
    ]);
    assert.equal(JSON.stringify(requests).includes(API_TOKEN), false);

    const contextual = await converse(running.baseUrl, 'Agora compare as duas abordagens.');
    assert.equal(contextual.status, 200);
    assert.equal((await contextual.json() as { message: string }).message, 'Resposta remota segura.');
    assert.deepEqual(requests[1], {
      text: 'Agora compare as duas abordagens.',
      requestedAt: '2026-08-27T12:00:00.000Z',
      recentExchanges: [{
        requestText: 'Explique a diferença entre recursão e iteração.',
        summary: 'Resposta remota segura.',
      }],
    });

    const webCookie = await createWebSession(running.baseUrl);
    const productionRegression = await webConverse(
      running.baseUrl,
      webCookie,
      'Oi Sebastian. Você está online? Me diga quem você é e o que consegue fazer hoje.',
    );
    assert.equal(productionRegression.status, 200);
    assert.deepEqual(await productionRegression.json(), {
      ok: true,
      message: 'Resposta remota segura.',
      requestId: 'request-test-id',
    });
    assert.deepEqual(requests[2], {
      text: 'Oi Sebastian. Você está online? Me diga quem você é e o que consegue fazer hoje.',
      requestedAt: '2026-08-27T12:00:00.000Z',
    });

    const explicitMemory = await webConverse(running.baseUrl, webCookie, 'O que você sabe sobre mim?');
    assert.equal(explicitMemory.status, 200);
    assert.equal((await explicitMemory.json() as { message: string }).message, 'Ainda não tenho nenhuma memória registrada sobre isso.');
    assert.equal(requests.length, 3, 'explicit memory query must not reach cognitive conversation');
    assert.equal(JSON.stringify(requests).includes(cognitiveSecret), false);

    const sensitive = await converse(running.baseUrl, 'Crie um arquivo chamado invaded.txt com: conteúdo perigoso.');
    assert.equal(sensitive.status, 200);
    assert.equal(toolLikeRequestCount, 0, 'deterministic Tool intent must never be delegated to conversational cognition');
  } finally {
    await running.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('HTTP regression: unrelated general questions use general cognition directly instead of the limited deterministic fallback', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-http-generalist-'));
  let decideCalls = 0;
  const provider: CognitiveModelProvider = {
    decide: async () => {
      decideCalls += 1;
      return { outcome: 'timeout' };
    },
    respond: async ({ text }) => ({
      outcome: 'responded',
      answer: text.includes('viajar')
        ? 'Confira documentos, orçamento, seguro, hospedagem e roteiro antes da viagem.'
        : 'Posso explicar esse assunto geral usando conhecimento e raciocínio.',
    }),
  };
  const application = createOnlineSebastianApplication(undefined, provider, dataDir, {});
  const running = await startServer(application);
  try {
    const travel = await converse(running.baseUrl, 'vou viajar pra europa o q tenho q fazer?');
    assert.match((await travel.json() as { message: string }).message, /documentos|viagem/);
    const other = await converse(running.baseUrl, 'Explique como surgem os arco-íris.');
    assert.match((await other.json() as { message: string }).message, /assunto geral/);
    assert.equal(decideCalls, 0);
  } finally {
    await running.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('HTTP regression: an elliptical follow-up uses the immediately previous exchange, while explicit topic changes and resumptions remain independent', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-http-primary-context-'));
  const cognitiveRequests: Array<{ readonly text: string; readonly recentExchanges: readonly { readonly requestText: string; readonly summary: string }[] }> = [];
  const logCalls: Array<{ readonly message: string; readonly metadata?: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug() {}, warn() {}, error() {},
    info(message, metadata) { logCalls.push(metadata === undefined ? { message } : { message, metadata }); },
  };
  const provider: CognitiveModelProvider = {
    decide: async () => ({ outcome: 'unavailable', reason: 'not expected for ordinary conversation' }),
    respond: async (request) => {
      cognitiveRequests.push({ text: request.text, recentExchanges: request.recentExchanges ?? [] });
      if (request.text.includes('GitHub inicialmente')) {
        return { outcome: 'responded', answer: 'Posso ajudar com GitHub, repositórios e commits.' };
      }
      if (request.text.includes('criar um site')) {
        return { outcome: 'responded', answer: 'Para criar um site, começamos definindo objetivo, páginas e tecnologia.' };
      }
      if (request.text === 'vc pode me ajudar?') {
        const context = (request.recentExchanges ?? []).map((item) => `${item.requestText}\n${item.summary}`).join('\n');
        return { outcome: 'responded', answer: context.includes('criar um site') && !context.includes('repositórios e commits')
          ? 'Claro. Posso ajudar a planejar e construir esse site passo a passo.'
          : 'Contexto incorreto.' };
      }
      if (request.text.includes('Mudando explicitamente')) {
        return { outcome: 'responded', answer: 'Vamos falar do novo assunto sem carregar o anterior.' };
      }
      return { outcome: 'responded', answer: (request.recentExchanges ?? []).some((item) => item.summary.includes('repositórios e commits'))
          ? 'Retomando GitHub, podemos revisar repositórios e commits.'
          : 'Retomada sem contexto.' };
    },
  };
  const application = createOnlineSebastianApplication(logger, provider, dataDir, {});
  let tick = 0;
  const running = await startServer(application, logger, undefined, () => new Date(Date.UTC(2026, 7, 28, 16, 0, tick++)));
  try {
    await converse(running.baseUrl, 'Quero conversar sobre GitHub inicialmente.');
    const site = await converse(running.baseUrl, 'como eu faço pra criar um site?');
    assert.match((await site.json() as { message: string }).message, /criar um site/);
    const persistedAfterSite = readFileSync(join(dataDir, 'memory.json'), 'utf8');
    assert.match(persistedAfterSite, /criar um site/);

    const followUp = await converse(running.baseUrl, 'vc pode me ajudar?');
    assert.match((await followUp.json() as { message: string }).message, /esse site/);
    const followUpRequest = cognitiveRequests.find((request) => request.text === 'vc pode me ajudar?');
    assert.equal(followUpRequest?.recentExchanges.length, 1);
    assert.match(followUpRequest?.recentExchanges[0]?.summary ?? '', /criar um site/);
    assert.doesNotMatch(followUpRequest?.recentExchanges[0]?.summary ?? '', /GitHub|commits/);

    const changed = await converse(running.baseUrl, 'Mudando explicitamente de assunto: quero falar de jardinagem.');
    assert.match((await changed.json() as { message: string }).message, /novo assunto/);
    const changeRequest = cognitiveRequests.find((request) => request.text.includes('Mudando explicitamente'));
    assert.deepEqual(changeRequest?.recentExchanges, []);

    const resumed = await converse(running.baseUrl, 'Vamos continuar o projeto GitHub sobre repositórios e commits.');
    assert.match((await resumed.json() as { message: string }).message, /Retomando GitHub/);
    const resumeRequest = cognitiveRequests.find((request) => request.text.startsWith('Vamos continuar'));
    assert.equal(resumeRequest?.recentExchanges.some((item) => item.summary.includes('repositórios e commits')), true);

    const selections = logCalls.filter((call) => call.message === 'Cognitive conversation context selected.');
    const followUpSelection = selections.find((call) => call.metadata?.intent === 'ellipticalContinuationReference' && call.metadata?.availableExchangeCount === 2);
    const selected = followUpSelection?.metadata?.selectedExchanges as Array<Record<string, unknown>> | undefined;
    assert.equal(selected?.length, 1);
    assert.equal(selected?.[0]?.sourcePosition, 1);
    assert.equal(selected?.[0]?.recencyRank, 1);
    assert.equal(selected?.[0]?.kind, 'respond');
    assert.equal(selected?.[0]?.contextRole, 'primary');
    assert.equal(JSON.stringify(selections).includes('criar um site'), false, 'safe instrumentation must never log conversation content');
    assert.equal(JSON.stringify(selections).includes('GitHub inicialmente'), false);
  } finally {
    await running.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('SPEC-049: hostile HTTP requests cannot create/edit files, execute validations, use Git/diff or auto-correct', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'sebastian-online-security-'));
  const protectedPath = join(fixture, 'protected.txt');
  writeFileSync(protectedPath, 'original\n', 'utf8');
  const initialEntries = readdirSync(fixture).slice().sort();
  const previousCwd = process.cwd();
  process.chdir(fixture);

  const application = createOnlineSebastianApplication(silentLogger);
  const running = await startServer(application);
  try {
    const attempts = [
      'Crie o arquivo invaded.txt com o texto invadido.',
      'Edite protected.txt substituindo original por alterado.',
      'Execute os testes deste projeto.',
      'Mostre o status do Git.',
      'Mostre o diff atual.',
      'Descubra por que os testes falham e corrija automaticamente protected.txt.',
    ];

    for (const attempt of attempts) {
      const response = await converse(running.baseUrl, attempt);
      assert.equal(response.status, 200, `unexpected status for: ${attempt}`);
    }

    const webCookie = await createWebSession(running.baseUrl);
    const webAttempt = await webConverse(
      running.baseUrl,
      webCookie,
      'Crie o arquivo web-invaded.txt com o texto invadido pela interface.',
    );
    assert.equal(webAttempt.status, 200);

    assert.equal(readFileSync(protectedPath, 'utf8'), 'original\n');
    assert.deepEqual(readdirSync(fixture).slice().sort(), initialEntries);
  } finally {
    await running.close();
    process.chdir(previousCwd);
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('CONVERSATIONS: two conversations keep independent history and cognitive context - neither leaks into the other', async () => {
  // Each converse command is persisted under a key derived from
  // `type:generatedAt` (see FileCommandResultMemoryWriter) - a frozen clock
  // would make every message in this test collide on the exact same storage
  // key and overwrite each other regardless of conversationId, so this test
  // (unlike most others in this file) needs its timestamps to actually move.
  let nowMs = new Date('2026-08-27T12:00:00.000Z').getTime();
  const now = () => new Date(nowMs);
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-conversations-isolation-'));
  const requests: { readonly text: string; readonly recentExchanges?: readonly { readonly requestText: string }[] }[] = [];
  const cognitiveModelProvider: CognitiveModelProvider = {
    decide: async () => ({ outcome: 'unavailable', reason: 'unused' }),
    respond: async (request) => {
      requests.push(request);
      return { outcome: 'responded', answer: `Resposta para: ${request.text}` };
    },
  };
  const application = createOnlineSebastianApplication(silentLogger, cognitiveModelProvider, dataDir);
  const registry = createConversationRegistryForDataDir(dataDir);
  const running = await startServer(application, silentLogger, undefined, now, undefined, registry);
  try {
    const cookie = await createWebSession(running.baseUrl);
    const conversationA = await createWebConversation(running.baseUrl, cookie);
    nowMs += 1_000;
    const conversationB = await createWebConversation(running.baseUrl, cookie);
    nowMs += 1_000;
    assert.notEqual(conversationA.id, conversationB.id);

    assert.equal((await webConverse(running.baseUrl, cookie, 'Explique recursão de cauda.', conversationA.id)).status, 200);
    nowMs += 1_000;
    assert.equal((await webConverse(running.baseUrl, cookie, 'Explique grafo acíclico dirigido.', conversationB.id)).status, 200);
    nowMs += 1_000;

    requests.length = 0;
    // "as duas" is a recognized continuation-reference marker (ConversationContextComposer),
    // which deterministically pulls in the immediately preceding exchange regardless of
    // lexical overlap score - the reliable way to force real context into this follow-up.
    assert.equal((await webConverse(running.baseUrl, cookie, 'Compare as duas formas de pensar sobre isso.', conversationA.id)).status, 200);
    assert.equal(requests.length, 1);
    const contextSeenByModel = requests[0]!.recentExchanges ?? [];
    assert.ok(contextSeenByModel.some((exchange) => exchange.requestText.includes('recursão de cauda')));
    assert.equal(contextSeenByModel.some((exchange) => exchange.requestText.includes('grafo acíclico')), false);

    const loadedA = await getWebConversation(running.baseUrl, cookie, conversationA.id);
    assert.equal(loadedA.status, 200);
    const messagesA = (await loadedA.json() as { messages: readonly { content: string }[] }).messages;
    assert.ok(messagesA.some((message) => message.content.includes('recursão de cauda')));
    assert.equal(messagesA.some((message) => message.content.includes('grafo acíclico')), false);

    const loadedB = await getWebConversation(running.baseUrl, cookie, conversationB.id);
    assert.equal(loadedB.status, 200);
    const messagesB = (await loadedB.json() as { messages: readonly { content: string }[] }).messages;
    assert.ok(messagesB.some((message) => message.content.includes('grafo acíclico')));
    assert.equal(messagesB.some((message) => message.content.includes('recursão de cauda')), false);
  } finally {
    await running.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('CONVERSATIONS: listing sorts by most recent activity, and a brand new conversation never resumes the previous one\'s context', async () => {
  let nowMs = new Date('2026-08-27T12:00:00.000Z').getTime();
  const now = () => new Date(nowMs);
  const requests: { readonly recentExchanges?: readonly unknown[] }[] = [];
  const cognitiveModelProvider: CognitiveModelProvider = {
    decide: async () => ({ outcome: 'unavailable', reason: 'unused' }),
    respond: async (request) => {
      requests.push(request);
      return { outcome: 'responded', answer: 'Resposta cognitiva.' };
    },
  };
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-conversations-ordering-'));
  const application = createOnlineSebastianApplication(silentLogger, cognitiveModelProvider, dataDir);
  const registry = createConversationRegistryForDataDir(dataDir);
  const running = await startServer(application, silentLogger, undefined, now, undefined, registry);
  try {
    const cookie = await createWebSession(running.baseUrl);
    const conversationA = await createWebConversation(running.baseUrl, cookie);
    nowMs += 1_000;
    const conversationB = await createWebConversation(running.baseUrl, cookie);
    nowMs += 1_000;

    await webConverse(running.baseUrl, cookie, 'Primeira mensagem em A.', conversationA.id);
    nowMs += 1_000;
    await webConverse(running.baseUrl, cookie, 'Primeira mensagem em B.', conversationB.id);
    nowMs += 1_000;

    assert.deepEqual((await listWebConversations(running.baseUrl, cookie)).map((c) => c.id), [conversationB.id, conversationA.id]);

    requests.length = 0;
    await webConverse(running.baseUrl, cookie, 'Segunda mensagem em A.', conversationA.id);
    assert.deepEqual((await listWebConversations(running.baseUrl, cookie)).map((c) => c.id), [conversationA.id, conversationB.id]);
    // The immediately preceding turn belongs to A itself (its own first message), never to B.
    assert.equal(requests.length, 1);

    const conversationC = await createWebConversation(running.baseUrl, cookie);
    requests.length = 0;
    await webConverse(running.baseUrl, cookie, 'Mensagem em uma conversa totalmente nova.', conversationC.id);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]!.recentExchanges ?? [], [], 'a brand new conversation must start with no prior context at all');
  } finally {
    await running.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('CONVERSATIONS: reopening a conversation returns its real saved history and lets it continue', async () => {
  // Two converse commands are sent below; each needs its own timestamp so
  // they persist under distinct storage keys instead of overwriting each other.
  let nowMs = new Date('2026-08-27T12:00:00.000Z').getTime();
  const now = () => new Date(nowMs);
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-conversations-reopen-'));
  const application = createOnlineSebastianApplication(silentLogger, undefined, dataDir);
  const registry = createConversationRegistryForDataDir(dataDir);
  const running = await startServer(application, silentLogger, undefined, now, undefined, registry);
  try {
    const cookie = await createWebSession(running.baseUrl);
    const conversation = await createWebConversation(running.baseUrl, cookie);
    nowMs += 1_000;
    await webConverse(running.baseUrl, cookie, 'Quais são minhas tarefas?', conversation.id);
    nowMs += 1_000;

    const loaded = await getWebConversation(running.baseUrl, cookie, conversation.id);
    assert.equal(loaded.status, 200);
    const body = await loaded.json() as {
      readonly conversation: { readonly id: string; readonly title: string };
      readonly messages: readonly { readonly role: string; readonly content: string }[];
    };
    assert.equal(body.conversation.id, conversation.id);
    assert.notEqual(body.conversation.title, 'Nova conversa');
    assert.deepEqual(body.messages, [
      { role: 'user', content: 'Quais são minhas tarefas?' },
      { role: 'sebastian', content: 'Você não tem nenhuma tarefa pendente.' },
    ]);

    const continued = await webConverse(running.baseUrl, cookie, 'E se eu adicionar uma agora?', conversation.id);
    assert.equal(continued.status, 200);

    const reloaded = await getWebConversation(running.baseUrl, cookie, conversation.id);
    const reloadedMessages = (await reloaded.json() as { messages: readonly { content: string }[] }).messages;
    assert.equal(reloadedMessages.length, 4);
  } finally {
    await running.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('CONVERSATIONS: conversations and their history survive an application restart', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-conversations-restart-'));
  try {
    const firstApp = createOnlineSebastianApplication(silentLogger, undefined, dataDir);
    const firstRegistry = createConversationRegistryForDataDir(dataDir);
    const first = await startServer(firstApp, silentLogger, undefined, undefined, undefined, firstRegistry);
    const cookie = await createWebSession(first.baseUrl);
    const conversation = await createWebConversation(first.baseUrl, cookie);
    await webConverse(first.baseUrl, cookie, 'Quais são minhas tarefas?', conversation.id);
    await first.close();

    const secondApp = createOnlineSebastianApplication(silentLogger, undefined, dataDir);
    const secondRegistry = createConversationRegistryForDataDir(dataDir);
    const second = await startServer(secondApp, silentLogger, undefined, undefined, undefined, secondRegistry);
    try {
      const secondCookie = await createWebSession(second.baseUrl);
      const list = await listWebConversations(second.baseUrl, secondCookie);
      assert.deepEqual(list.map((c) => c.id), [conversation.id]);

      const reopened = await getWebConversation(second.baseUrl, secondCookie, conversation.id);
      assert.equal(reopened.status, 200);
      const messages = (await reopened.json() as { messages: readonly { content: string }[] }).messages;
      assert.ok(messages.some((message) => message.content === 'Quais são minhas tarefas?'));
    } finally {
      await second.close();
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('CONVERSATIONS: permanent memory stays independent of which conversation is active', async () => {
  // Two converse commands are sent below; each needs its own timestamp so
  // they persist under distinct storage keys instead of overwriting each other.
  let nowMs = new Date('2026-08-27T12:00:00.000Z').getTime();
  const now = () => new Date(nowMs);
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-conversations-memory-independence-'));
  const application = createOnlineSebastianApplication(silentLogger, undefined, dataDir);
  const registry = createConversationRegistryForDataDir(dataDir);
  const running = await startServer(application, silentLogger, undefined, now, undefined, registry);
  try {
    const cookie = await createWebSession(running.baseUrl);
    const conversationA = await createWebConversation(running.baseUrl, cookie);
    nowMs += 1_000;
    const rememberResponse = await webConverse(
      running.baseUrl, cookie, 'Sebastian, lembra que prefiro reuniões de manhã', conversationA.id,
    );
    assert.equal(rememberResponse.status, 200);
    nowMs += 1_000;

    const conversationB = await createWebConversation(running.baseUrl, cookie);
    nowMs += 1_000;
    const recallResponse = await webConverse(
      running.baseUrl, cookie, 'Qual horário eu prefiro para reuniões?', conversationB.id,
    );
    assert.equal(recallResponse.status, 200);
    // The fact was remembered while conversation A was active but is recalled
    // successfully from conversation B, which never mentioned it before -
    // proof that permanent memory does not depend on which conversation asks.
    assert.equal(
      (await recallResponse.json() as { message: string }).message,
      'Sobre isso, você registrou: "prefiro reuniões de manhã".',
    );

    // Isolation the other way around: B's own recall exchange must never
    // appear in A, and A's remember request must never appear in B.
    const loadedA = await getWebConversation(running.baseUrl, cookie, conversationA.id);
    const messagesA = (await loadedA.json() as { messages: readonly { content: string }[] }).messages;
    assert.equal(messagesA.some((message) => message.content.includes('Qual horário')), false);

    const loadedB = await getWebConversation(running.baseUrl, cookie, conversationB.id);
    const messagesB = (await loadedB.json() as { messages: readonly { content: string }[] }).messages;
    assert.equal(messagesB.some((message) => message.content.includes('Sebastian, lembra que')), false);
  } finally {
    await running.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('CONVERSATIONS: invalid or nonexistent conversation ids are rejected instead of silently falling back', async () => {
  const running = await startServer(successfulApplication());
  try {
    const cookie = await createWebSession(running.baseUrl);

    const malformed = await webConverse(running.baseUrl, cookie, 'Olá', '../../etc/passwd');
    assert.equal(malformed.status, 400);

    const wellFormedButMissing = await webConverse(running.baseUrl, cookie, 'Olá', 'conversation-does-not-exist');
    assert.equal(wellFormedButMissing.status, 404);

    const missingGet = await getWebConversation(running.baseUrl, cookie, 'conversation-does-not-exist');
    assert.equal(missingGet.status, 404);

    const malformedGet = await getWebConversation(running.baseUrl, cookie, '../etc/passwd');
    assert.equal(malformedGet.status, 404);
  } finally {
    await running.close();
  }
});

test('CONVERSATIONS: listing and reopening work over a plain same-origin GET with no Origin header, exactly like a real browser sends', async () => {
  const running = await startServer(successfulApplication());
  try {
    const cookie = await createWebSession(running.baseUrl);
    const created = await fetch(`${running.baseUrl}/api/web/conversations`, {
      method: 'POST',
      headers: { Origin: running.baseUrl, Cookie: cookie },
    });
    assert.equal(created.status, 201);
    const { conversation } = await created.json() as { conversation: { id: string } };

    const list = await fetch(`${running.baseUrl}/api/web/conversations`, { headers: { Cookie: cookie } });
    assert.equal(list.status, 200);

    const loaded = await fetch(`${running.baseUrl}/api/web/conversations/${conversation.id}`, { headers: { Cookie: cookie } });
    assert.equal(loaded.status, 200);

    // POST still requires the same-origin guard - only GET is relaxed.
    const createWithoutOrigin = await fetch(`${running.baseUrl}/api/web/conversations`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert.equal(createWithoutOrigin.status, 401);
  } finally {
    await running.close();
  }
});

test('CONVERSATIONS: an installation that only ever had the old linear history sees it migrated into a real, reopenable conversation', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-conversations-legacy-migration-'));
  try {
    // Simulate a pre-existing installation: converse over the plain Bearer
    // route, which never supplies a conversationId, exactly like every
    // caller did before this feature existed.
    const legacyApp = createOnlineSebastianApplication(silentLogger, undefined, dataDir);
    const legacyRegistry = createConversationRegistryForDataDir(dataDir);
    const legacy = await startServer(legacyApp, silentLogger, undefined, undefined, undefined, legacyRegistry);
    await converse(legacy.baseUrl, 'Quais são minhas tarefas?');
    await legacy.close();

    const migratedApp = createOnlineSebastianApplication(silentLogger, undefined, dataDir);
    const migratedRegistry = createConversationRegistryForDataDir(dataDir);
    const migrated = await startServer(migratedApp, silentLogger, undefined, undefined, undefined, migratedRegistry);
    try {
      const cookie = await createWebSession(migrated.baseUrl);
      const list = await listWebConversations(migrated.baseUrl, cookie);
      assert.equal(list.length, 1);
      assert.equal(list[0]!.id, 'conversation-1');

      const loaded = await getWebConversation(migrated.baseUrl, cookie, 'conversation-1');
      assert.equal(loaded.status, 200);
      const messages = (await loaded.json() as { messages: readonly { content: string }[] }).messages;
      assert.ok(messages.some((message) => message.content === 'Quais são minhas tarefas?'));
    } finally {
      await migrated.close();
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
