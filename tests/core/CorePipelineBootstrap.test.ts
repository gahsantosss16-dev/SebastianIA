import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CorePipelineBootstrap,
  composeCorePipelineDependencies,
} from '../../core/CorePipelineBootstrap.js';
import {
  CorePipelineBootstrapError,
  InvalidCorePipelineBindingsError,
  InvalidCorePipelineBundleError,
  InvalidCorePipelineExecutorError,
  InvalidCorePipelineProvidersError,
} from '../../core/CorePipelineBootstrapErrors.js';
import {
  CommandCapabilityBindingConsistencyError,
  InvalidCapabilityProviderError,
  type CapabilityHandler,
  type CapabilityProvider,
} from '../../core/capability/index.js';
import type { CommandProcessingInput } from '../../core/command/index.js';
import { SebastianCore, type CorePipelineDependencies } from '../../core/core.js';
import { FileCommandContextHydrator } from '../../core/memory/FileCommandContextHydrator.js';
import { FileCommandResultMemoryWriter } from '../../core/memory/FileCommandResultMemoryWriter.js';
import { FileMemoryStore } from '../../core/memory/FileMemoryStore.js';
import { InMemoryCommandContextHydrator } from '../../core/memory/InMemoryCommandContextHydrator.js';
import { InMemoryCommandResultMemoryWriter } from '../../core/memory/InMemoryCommandResultMemoryWriter.js';

const descriptor = {
  id: 'cap.greeting',
  name: 'Greeting Capability',
  version: '1.0.0',
  handlerId: 'handler.greeting',
} as const;

const handler: CapabilityHandler = (invocation) => ({ echoed: invocation.input });

const provider: CapabilityProvider = {
  providerId: 'provider.greeting',
  listRegistrations: () => [{ descriptor, handler }],
};

const validInput = {
  providers: [provider],
  bindings: [{ commandType: 'greeting', capabilityId: 'cap.greeting' }],
} as const;

function commandInput(): CommandProcessingInput {
  return {
    type: 'greeting',
    input: { message: 'hello' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  };
}

test('bootstrap composes complete Core pipeline dependencies', () => {
  const dependencies = composeCorePipelineDependencies(validInput);

  assert.equal(typeof dependencies.executor.execute, 'function');
  assert.equal(dependencies.bundle.catalog.length, 1);
  assert.equal(dependencies.bundle.handlersById.has('handler.greeting'), true);
  assert.equal(typeof dependencies.commandContextHydrator.hydrate, 'function');
  assert.equal(typeof dependencies.specializedAgent.handoff, 'function');
  assert.equal(typeof dependencies.commandResultMemoryWriter.write, 'function');
  assert.equal(Object.isFrozen(dependencies), true);
});

test('bootstrap rejects invalid providers with typed error and original cause', () => {
  assert.throws(
    () => composeCorePipelineDependencies({ ...validInput, providers: null as never }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCorePipelineProvidersError);
      assert.ok(error.cause instanceof InvalidCapabilityProviderError);
      return true;
    },
  );
});

test('bootstrap rejects bindings inconsistent with the catalog and preserves cause', () => {
  assert.throws(
    () =>
      composeCorePipelineDependencies({
        ...validInput,
        bindings: [{ commandType: 'missing', capabilityId: 'cap.missing' }],
      }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCorePipelineBindingsError);
      assert.ok(error.cause instanceof CommandCapabilityBindingConsistencyError);
      return true;
    },
  );
});

test('bootstrap rejects an invalid bundle without returning partial dependencies', () => {
  const originalCause = new Error('invalid bundle contract');
  const bootstrap = new CorePipelineBootstrap({
    buildBundle: () => {
      throw originalCause;
    },
  });

  assert.throws(
    () => bootstrap.compose(validInput),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCorePipelineBundleError);
      assert.equal(error.cause, originalCause);
      return true;
    },
  );
});

test('bootstrap rejects an invalid executor and preserves its validation cause', () => {
  const bootstrap = new CorePipelineBootstrap({
    buildExecutor: () => ({}) as never,
  });

  assert.throws(
    () => bootstrap.compose(validInput),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCorePipelineExecutorError);
      assert.ok(error.cause instanceof TypeError);
      return true;
    },
  );
});

test('bootstrap rejects an invalid specialized agent and preserves its validation cause', () => {
  const bootstrap = new CorePipelineBootstrap({
    buildSpecializedAgent: () => ({}) as never,
  });

  assert.throws(
    () => bootstrap.compose(validInput),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Core specialized agent composition failed.');
      assert.ok((error as { cause?: unknown }).cause instanceof TypeError);
      return true;
    },
  );
});

test('bootstrap rejects an invalid specialized tool and preserves its validation cause', () => {
  const bootstrap = new CorePipelineBootstrap({
    buildSpecializedTool: () => ({}) as never,
  });

  assert.throws(
    () => bootstrap.compose(validInput),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Core specialized tool composition failed.');
      assert.ok((error as { cause?: unknown }).cause instanceof TypeError);
      return true;
    },
  );
});

test('bootstrap composition is deterministic for identical configuration', () => {
  const left = composeCorePipelineDependencies(validInput);
  const right = composeCorePipelineDependencies(validInput);

  assert.deepEqual(left.bundle.catalog, right.bundle.catalog);
  assert.deepEqual(
    [...left.bundle.handlersById.keys()],
    [...right.bundle.handlersById.keys()],
  );
  assert.equal(left.executor.constructor, right.executor.constructor);
});

test('SebastianCore executes a real command with composed dependencies', () => {
  const dependencies: CorePipelineDependencies = composeCorePipelineDependencies(validInput);
  const core = new SebastianCore('Sebastian IA', {}, undefined, dependencies);
  core.initialize();
  core.start();

  const result = core.executeCommand(commandInput());

  assert.deepEqual(result, {
    status: 'succeeded',
    output: { echoed: { message: 'hello' } },
    generatedAt: '2026-07-31T00:00:00.000Z',
  });
});

test('bootstrap defaults to in-memory persistence when no memoryFilePath is given', () => {
  const dependencies = composeCorePipelineDependencies(validInput);

  assert.ok(dependencies.commandContextHydrator instanceof InMemoryCommandContextHydrator);
  assert.ok(dependencies.commandResultMemoryWriter instanceof InMemoryCommandResultMemoryWriter);
});

test('bootstrap composes file-backed persistence when memoryFilePath is provided', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-core-bootstrap-'));
  try {
    const memoryFilePath = join(dir, 'memory.json');
    const dependencies = composeCorePipelineDependencies({ ...validInput, memoryFilePath });

    assert.ok(dependencies.commandContextHydrator instanceof FileCommandContextHydrator);
    assert.ok(dependencies.commandResultMemoryWriter instanceof FileCommandResultMemoryWriter);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bootstrap rejects a blank memoryFilePath', () => {
  assert.throws(
    () => composeCorePipelineDependencies({ ...validInput, memoryFilePath: '   ' }),
    (error: unknown) => {
      assert.ok(error instanceof CorePipelineBootstrapError);
      return true;
    },
  );
});

test('core writes command results through to disk when composed with a memoryFilePath', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-core-bootstrap-persistence-'));
  try {
    const memoryFilePath = join(dir, 'memory.json');

    const dependencies = composeCorePipelineDependencies({ ...validInput, memoryFilePath });
    const core = new SebastianCore('Sebastian IA', {}, undefined, dependencies);
    core.initialize();
    core.start();
    core.executeCommand(commandInput());

    const independentStore = new FileMemoryStore(memoryFilePath);
    const records = independentStore.listRecords('command-results');
    assert.equal(records.length, 1);
    assert.equal(records[0]?.commandType, 'greeting');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
