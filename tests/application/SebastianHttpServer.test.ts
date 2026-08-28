import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CapabilityResult } from '../../core/capability/index.js';
import type { CommandProcessingInput } from '../../core/command/index.js';
import type { Logger } from '../../core/logger.js';
import { createOnlineSebastianApplication } from '../../application/OnlineSebastianApplication.js';
import {
  DEFAULT_ONLINE_PORT,
  MAX_HTTP_BODY_BYTES,
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

async function startServer(
  application: TestApplication,
  logger: Logger = silentLogger,
  executionTimeoutMs?: number,
): Promise<RunningTestServer> {
  const http = new SebastianHttpServer({
    application,
    apiToken: API_TOKEN,
    logger,
    requestId: () => 'request-test-id',
    now: () => new Date('2026-08-27T12:00:00.000Z'),
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
    assert.deepEqual(inputs, [
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

test('SPEC-049: an execution timeout keeps the concurrency gate closed until the real operation settles', async () => {
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
  const running = await startServer(application, silentLogger, 10);
  try {
    const timedOut = await converse(running.baseUrl, 'primeira');
    assert.equal(timedOut.status, 504);

    const whileStillRunning = await converse(running.baseUrl, 'segunda');
    assert.equal(whileStillRunning.status, 503);

    release?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const afterSettlement = await converse(running.baseUrl, 'terceira');
    assert.equal(afterSettlement.status, 200);
  } finally {
    release?.();
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

    assert.equal(readFileSync(protectedPath, 'utf8'), 'original\n');
    assert.deepEqual(readdirSync(fixture).slice().sort(), initialEntries);
  } finally {
    await running.close();
    process.chdir(previousCwd);
    rmSync(fixture, { recursive: true, force: true });
  }
});
