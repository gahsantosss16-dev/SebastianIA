import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LOCAL_GREETING_CAPABILITY_ID,
  LOCAL_GREETING_COMMAND_TYPE,
  localGreetingCapabilityProvider,
} from '../../application/LocalGreetingCapabilityProvider.js';
import { createSebastianApplication } from '../../application/SebastianApplication.js';
import type { CommandProcessingInput } from '../../core/command/index.js';
import { core as defaultApplicationCore } from '../../core/index.js';
import type { Logger } from '../../core/logger.js';

function withTempDataDir(run: (dataDir: string) => void): void {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-application-'));
  try {
    run(dataDir);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function rememberInput(text: string): CommandProcessingInput {
  return {
    type: 'remember',
    input: { text },
    generatedAt: '2026-08-11T00:00:00.000Z',
  };
}

function recallInput(): CommandProcessingInput {
  return {
    type: 'recall',
    input: {},
    generatedAt: '2026-08-11T00:00:01.000Z',
  };
}

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function greetingInput(name?: unknown): CommandProcessingInput {
  return {
    type: LOCAL_GREETING_COMMAND_TYPE,
    input: name === undefined ? {} : { name },
    generatedAt: '2026-07-31T00:00:00.000Z',
  };
}

test('local provider exposes the concrete greeting registration', () => {
  const registrations = localGreetingCapabilityProvider.listRegistrations();

  assert.equal(localGreetingCapabilityProvider.providerId, 'provider.greeting.local');
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0]?.descriptor.id, LOCAL_GREETING_CAPABILITY_ID);
  assert.equal(registrations[0]?.descriptor.handlerId, 'handler.greeting.local');
  assert.equal(typeof registrations[0]?.handler, 'function');
});

test('application composition root returns a fully operational Core', () => {
  const core = createSebastianApplication({ logger });

  assert.equal(core.status, 'ready');
  assert.deepEqual(core.getLifecycleState(), {
    initialized: true,
    started: true,
    shutDown: false,
  });
});

test('application composition root preserves accepted Core configuration', () => {
  const core = createSebastianApplication({
    name: 'Sebastian Local',
    config: {
      appName: 'Sebastian Operational',
      environment: 'test',
      debug: false,
    },
    logger,
  });

  assert.equal(core.name, 'Sebastian Local');
  assert.deepEqual(core.getConfig(), {
    appName: 'Sebastian Operational',
    environment: 'test',
    debug: false,
  });
});

test('local application executes a named greeting through the real pipeline', () => {
  const core = createSebastianApplication({ logger });

  assert.deepEqual(core.executeCommand(greetingInput('Gabriel')), {
    status: 'succeeded',
    output: { message: 'Hello, Gabriel!' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  });
});

test('local greeting returns the generic message without a valid name', () => {
  const core = createSebastianApplication({ logger });

  assert.deepEqual(core.executeCommand(greetingInput('   ')).output, {
    message: 'Hello!',
  });
  assert.deepEqual(core.executeCommand(greetingInput(42)).output, {
    message: 'Hello!',
  });
});

test('local greeting is deterministic and does not mutate command input', () => {
  const core = createSebastianApplication({ logger });
  const command = greetingInput('Gabriel');
  const before = structuredClone(command);

  const left = core.executeCommand(command);
  const right = core.executeCommand(command);

  assert.deepEqual(left, right);
  assert.deepEqual(command, before);
});

test('default entrypoint exports an operational Core with the local capability', () => {
  assert.equal(defaultApplicationCore.status, 'ready');
  assert.deepEqual(defaultApplicationCore.executeCommand(greetingInput('Sebastian')).output, {
    message: 'Hello, Sebastian!',
  });
});

test('without a dataDir, memory does not persist across separate Core instances', () => {
  const first = createSebastianApplication({ logger });
  first.executeCommand(rememberInput('prefiro reuniões de manhã'));

  const second = createSebastianApplication({ logger });
  assert.deepEqual(second.executeCommand(recallInput()).output, {
    message: 'Nenhuma memória registrada ainda.',
    facts: [],
  });
});

test('with a dataDir, a fact remembered by one Core instance is recalled by a later instance', () => {
  withTempDataDir((dataDir) => {
    const writerCore = createSebastianApplication({ logger, dataDir });
    const rememberResult = writerCore.executeCommand(rememberInput('prefiro reuniões de manhã'));
    assert.deepEqual(rememberResult.output, { fact: 'prefiro reuniões de manhã' });

    const readerCore = createSebastianApplication({ logger, dataDir });
    const recallResult = readerCore.executeCommand(recallInput());

    assert.equal(recallResult.output.message, '1 memória(s) registrada(s).');
    const facts = recallResult.output.facts as ReadonlyArray<{ readonly content: string }>;
    assert.deepEqual(
      facts.map((fact) => fact.content),
      ['prefiro reuniões de manhã'],
    );
  });
});

test('recall on a fresh dataDir with no prior facts reports a clear empty-memory message', () => {
  withTempDataDir((dataDir) => {
    const core = createSebastianApplication({ logger, dataDir });

    assert.deepEqual(core.executeCommand(recallInput()).output, {
      message: 'Nenhuma memória registrada ainda.',
      facts: [],
    });
  });
});
