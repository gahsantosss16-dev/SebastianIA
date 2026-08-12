import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const converseDescriptor = {
  id: 'cap.converse',
  name: 'Converse Capability',
  version: '1.0.0',
  handlerId: 'handler.converse',
} as const;

const converseHandler: CapabilityHandler = (invocation) => ({
  text: typeof invocation.input.text === 'string' ? invocation.input.text : '',
});

const converseProvider: CapabilityProvider = {
  providerId: 'provider.converse',
  listRegistrations: () => [{ descriptor: converseDescriptor, handler: converseHandler }],
};

const validInputWithConverse = {
  providers: [provider, converseProvider],
  bindings: [
    { commandType: 'greeting', capabilityId: 'cap.greeting' },
    { commandType: 'converse', capabilityId: 'cap.converse' },
  ],
} as const;

function converseCommandInput(text: string, generatedAt = '2026-08-11T00:00:00.000Z'): CommandProcessingInput {
  return {
    type: 'converse',
    input: { text },
    generatedAt,
  };
}

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

test('SebastianCore executes a real command with composed dependencies', async () => {
  const dependencies: CorePipelineDependencies = composeCorePipelineDependencies(validInput);
  const core = new SebastianCore('Sebastian IA', {}, undefined, dependencies);
  core.initialize();
  core.start();

  const result = await core.executeCommand(commandInput());

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

test('core writes command results through to disk when composed with a memoryFilePath', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-core-bootstrap-persistence-'));
  try {
    const memoryFilePath = join(dir, 'memory.json');

    const dependencies = composeCorePipelineDependencies({ ...validInput, memoryFilePath });
    const core = new SebastianCore('Sebastian IA', {}, undefined, dependencies);
    core.initialize();
    core.start();
    await core.executeCommand(commandInput());

    const independentStore = new FileMemoryStore(memoryFilePath);
    const records = independentStore.listRecords('command-results');
    assert.equal(records.length, 1);
    assert.equal(records[0]?.commandType, 'greeting');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bootstrap rejects an invalid model provider and preserves its validation cause', () => {
  const bootstrap = new CorePipelineBootstrap({
    buildModelProvider: () => ({}) as never,
  });

  assert.throws(
    () => bootstrap.compose(validInput),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Core model provider composition failed.');
      assert.ok((error as { cause?: unknown }).cause instanceof TypeError);
      return true;
    },
  );
});

test('default composition wires a real, working ModelProvider into the specialized agent', async () => {
  const dependencies = composeCorePipelineDependencies(validInput);

  const handoffResult = await dependencies.specializedAgent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-11T00:00:00.000Z',
    commandType: 'converse',
    requestedAt: '2026-08-11T00:00:00.000Z',
    payload: {
      commandInput: { type: 'converse', input: { text: 'Sebastian, lembra que prefiro reuniões de manhã' } },
    },
  });

  assert.equal(handoffResult.status, 'completed');
  if (handoffResult.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  assert.deepEqual(handoffResult.output.finalResult, {
    memoryRecordKind: 'sebastian.memory.fact',
    content: 'prefiro reuniões de manhã',
  });
});

test('bootstrap defaults allowedFilesystemRoot to process.cwd() when not provided', async () => {
  const dependencies = composeCorePipelineDependencies(validInput);

  const handoffResult = await dependencies.specializedAgent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-11T00:00:00.000Z',
    commandType: 'converse',
    requestedAt: '2026-08-11T00:00:00.000Z',
    payload: { commandInput: { type: 'converse', input: { text: 'Leia o arquivo package.json' } } },
  });

  assert.equal(handoffResult.status, 'completed');
  if (handoffResult.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  const message = handoffResult.output.finalResult as { readonly message: string };
  const realContent = readFileSync('package.json', 'utf8');
  assert.equal(message.message, `Conteúdo de "package.json":\n${realContent}`);
});

test('bootstrap rejects a blank allowedFilesystemRoot', () => {
  assert.throws(
    () => composeCorePipelineDependencies({ ...validInput, allowedFilesystemRoot: '   ' }),
    (error: unknown) => {
      assert.ok(error instanceof CorePipelineBootstrapError);
      return true;
    },
  );
});

test('bootstrap composes a real, allowedFilesystemRoot-scoped filesystem Tool reachable end-to-end through SebastianCore', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-core-bootstrap-fs-'));
  try {
    writeFileSync(join(dir, 'nota.txt'), 'conteúdo real de teste');

    const dependencies = composeCorePipelineDependencies({
      ...validInputWithConverse,
      allowedFilesystemRoot: dir,
    });
    const core = new SebastianCore('Sebastian IA', {}, undefined, dependencies);
    core.initialize();
    core.start();

    const listResult = await core.executeCommand(converseCommandInput('Quais arquivos existem?'));
    assert.deepEqual(listResult.output, {
      message: 'Arquivos em ".": nota.txt.',
    });

    const readResult = await core.executeCommand(converseCommandInput('Leia o arquivo nota.txt'));
    assert.deepEqual(readResult.output, {
      message: 'Conteúdo de "nota.txt":\nconteúdo real de teste',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bootstrap keeps filesystem access confined to allowedFilesystemRoot end-to-end through SebastianCore', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'sebastian-core-bootstrap-fs-guard-'));
  try {
    const root = join(parent, 'projeto');
    const outside = join(parent, 'fora');
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(join(outside, 'segredo.txt'), 'nunca deveria ser lido');

    const dependencies = composeCorePipelineDependencies({
      ...validInputWithConverse,
      allowedFilesystemRoot: root,
    });
    const core = new SebastianCore('Sebastian IA', {}, undefined, dependencies);
    core.initialize();
    core.start();

    const result = await core.executeCommand(converseCommandInput('Leia o arquivo ../fora/segredo.txt'));
    assert.deepEqual(result.output, {
      message: 'O caminho "../fora/segredo.txt" está fora da área permitida.',
    });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('a task added, listed, completed and listed again persists correctly across separate SebastianCore instances sharing a memoryFilePath', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-core-bootstrap-tasks-'));
  try {
    const memoryFilePath = join(dir, 'memory.json');
    const newCore = () => {
      const core = new SebastianCore(
        'Sebastian IA',
        {},
        undefined,
        composeCorePipelineDependencies({ ...validInputWithConverse, memoryFilePath }),
      );
      core.initialize();
      core.start();
      return core;
    };

    const addResult = await newCore().executeCommand(
      converseCommandInput('Adiciona uma tarefa: comprar leite', '2026-08-11T00:00:00.000Z'),
    );
    assert.deepEqual(addResult.output, {
      memoryRecordKind: 'sebastian.memory.task.created',
      content: 'comprar leite',
    });

    const firstListing = await newCore().executeCommand(
      converseCommandInput('Quais são minhas tarefas?', '2026-08-11T00:01:00.000Z'),
    );
    assert.deepEqual(firstListing.output, { message: 'Suas tarefas pendentes: comprar leite.' });

    const completeResult = await newCore().executeCommand(
      converseCommandInput("Marca 'comprar leite' como feita", '2026-08-11T00:02:00.000Z'),
    );
    assert.deepEqual(completeResult.output, {
      memoryRecordKind: 'sebastian.memory.task.completed',
      taskId: 'converse:2026-08-11T00:00:00.000Z',
    });

    const secondListing = await newCore().executeCommand(
      converseCommandInput('Quais são minhas tarefas?', '2026-08-11T00:03:00.000Z'),
    );
    assert.deepEqual(secondListing.output, { message: 'Você não tem nenhuma tarefa pendente.' });

    const independentStore = new FileMemoryStore(memoryFilePath);
    const records = independentStore.listRecords('command-results');
    assert.equal(records.length, 4, 'creation, both listings and completion must all persist as separate append-only records');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('completing an unmatched task leaves pending tasks unchanged and does not crash', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-core-bootstrap-tasks-not-found-'));
  try {
    const memoryFilePath = join(dir, 'memory.json');
    const newCore = () => {
      const core = new SebastianCore(
        'Sebastian IA',
        {},
        undefined,
        composeCorePipelineDependencies({ ...validInputWithConverse, memoryFilePath }),
      );
      core.initialize();
      core.start();
      return core;
    };

    await newCore().executeCommand(
      converseCommandInput('Adiciona uma tarefa: comprar leite', '2026-08-11T00:00:00.000Z'),
    );

    const completeResult = await newCore().executeCommand(
      converseCommandInput("Marca 'lavar o carro' como feita", '2026-08-11T00:01:00.000Z'),
    );
    assert.deepEqual(completeResult.output, {
      message: 'Não encontrei nenhuma tarefa pendente correspondente a "lavar o carro".',
    });

    const listing = await newCore().executeCommand(
      converseCommandInput('Quais são minhas tarefas?', '2026-08-11T00:02:00.000Z'),
    );
    assert.deepEqual(listing.output, { message: 'Suas tarefas pendentes: comprar leite.' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
