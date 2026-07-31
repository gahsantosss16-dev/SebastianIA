import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_GREETING_CAPABILITY_ID,
  LOCAL_GREETING_COMMAND_TYPE,
  localGreetingCapabilityProvider,
} from '../../application/LocalGreetingCapabilityProvider.js';
import { createSebastianApplication } from '../../application/SebastianApplication.js';
import type { CommandProcessingInput } from '../../core/command/index.js';
import { core as defaultApplicationCore } from '../../core/index.js';
import type { Logger } from '../../core/logger.js';

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
