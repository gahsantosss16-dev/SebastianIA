import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CoreOperationalRuntimeBootstrap,
  bootstrapCoreOperationalRuntime,
  type CoreOperationalRuntimeBootstrapInput,
} from '../../core/CoreOperationalRuntimeBootstrap.js';
import {
  CoreRuntimeCompositionError,
  CoreRuntimeCreationError,
  CoreRuntimeInitializationError,
  CoreRuntimeStartError,
} from '../../core/CoreOperationalRuntimeBootstrapErrors.js';
import { composeCorePipelineDependencies } from '../../core/CorePipelineBootstrap.js';
import type { CapabilityHandler, CapabilityProvider } from '../../core/capability/index.js';
import type { CommandProcessingInput } from '../../core/command/index.js';
import { SebastianCore, type CorePipelineDependencies } from '../../core/core.js';
import type { Logger } from '../../core/logger.js';

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const handler: CapabilityHandler = (invocation) => ({ echoed: invocation.input });

const provider: CapabilityProvider = {
  providerId: 'provider.greeting',
  listRegistrations: () => [
    {
      descriptor: {
        id: 'cap.greeting',
        name: 'Greeting Capability',
        version: '1.0.0',
        handlerId: 'handler.greeting',
      },
      handler,
    },
  ],
};

const bootstrapInput: CoreOperationalRuntimeBootstrapInput = {
  composition: {
    providers: [provider],
    bindings: [{ commandType: 'greeting', capabilityId: 'cap.greeting' }],
  },
  name: 'Sebastian Test',
  config: {},
  logger,
};

function commandInput(): CommandProcessingInput {
  return {
    type: 'greeting',
    input: { message: 'hello' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  };
}

function realDependencies(): CorePipelineDependencies {
  return composeCorePipelineDependencies(bootstrapInput.composition);
}

test('operational bootstrap returns an initialized and started SebastianCore', () => {
  const core = bootstrapCoreOperationalRuntime(bootstrapInput);

  assert.ok(core instanceof SebastianCore);
  assert.deepEqual(core.getLifecycleState(), {
    initialized: true,
    started: true,
    shutDown: false,
  });
  assert.equal(core.status, 'ready');
});

test('operational bootstrap composes once in compose -> create -> initialize -> start order', () => {
  const events: string[] = [];
  let compositionCount = 0;

  class OrderedCore extends SebastianCore {
    public override initialize(): void {
      events.push('initialize');
      super.initialize();
    }

    public override start(): void {
      events.push('start');
      super.start();
    }
  }

  const bootstrap = new CoreOperationalRuntimeBootstrap({
    composeDependencies: () => {
      compositionCount += 1;
      events.push('compose');
      return realDependencies();
    },
    createCore: (name, config, currentLogger, dependencies) => {
      events.push('create');
      return new OrderedCore(name, config, currentLogger, dependencies);
    },
  });

  bootstrap.bootstrap(bootstrapInput);

  assert.equal(compositionCount, 1);
  assert.deepEqual(events, ['compose', 'create', 'initialize', 'start']);
});

test('composition failure prevents Core creation and preserves a non-Error cause', () => {
  let creationCount = 0;
  const originalCause = 'composition throwable';
  const bootstrap = new CoreOperationalRuntimeBootstrap({
    composeDependencies: () => {
      throw originalCause;
    },
    createCore: () => {
      creationCount += 1;
      return new SebastianCore();
    },
  });

  assert.throws(
    () => bootstrap.bootstrap(bootstrapInput),
    (error: unknown) => {
      assert.ok(error instanceof CoreRuntimeCompositionError);
      assert.equal(error.cause, originalCause);
      return true;
    },
  );
  assert.equal(creationCount, 0);
});

test('creation failure is typed and preserves its original cause', () => {
  const originalCause = new Error('creation failure');
  const bootstrap = new CoreOperationalRuntimeBootstrap({
    composeDependencies: realDependencies,
    createCore: () => {
      throw originalCause;
    },
  });

  assert.throws(
    () => bootstrap.bootstrap(bootstrapInput),
    (error: unknown) => {
      assert.ok(error instanceof CoreRuntimeCreationError);
      assert.equal(error.cause, originalCause);
      return true;
    },
  );
});

test('initialize failure prevents start and prevents returning a partial Core', () => {
  const originalCause = new Error('initialize failure');
  let startCount = 0;

  class InitializeFailureCore extends SebastianCore {
    public override initialize(): void {
      throw originalCause;
    }

    public override start(): void {
      startCount += 1;
    }
  }

  const bootstrap = new CoreOperationalRuntimeBootstrap({
    composeDependencies: realDependencies,
    createCore: (name, config, currentLogger, dependencies) =>
      new InitializeFailureCore(name, config, currentLogger, dependencies),
  });

  assert.throws(
    () => bootstrap.bootstrap(bootstrapInput),
    (error: unknown) => {
      assert.ok(error instanceof CoreRuntimeInitializationError);
      assert.equal(error.cause, originalCause);
      return true;
    },
  );
  assert.equal(startCount, 0);
});

test('start failure prevents returning a partial Core and preserves cause', () => {
  const originalCause = new Error('start failure');
  let initializeCount = 0;

  class StartFailureCore extends SebastianCore {
    public override initialize(): void {
      initializeCount += 1;
      super.initialize();
    }

    public override start(): void {
      throw originalCause;
    }
  }

  const bootstrap = new CoreOperationalRuntimeBootstrap({
    composeDependencies: realDependencies,
    createCore: (name, config, currentLogger, dependencies) =>
      new StartFailureCore(name, config, currentLogger, dependencies),
  });

  assert.throws(
    () => bootstrap.bootstrap(bootstrapInput),
    (error: unknown) => {
      assert.ok(error instanceof CoreRuntimeStartError);
      assert.equal(error.cause, originalCause);
      return true;
    },
  );
  assert.equal(initializeCount, 1);
});

test('operational bootstrap is deterministic for identical input', () => {
  const left = bootstrapCoreOperationalRuntime(bootstrapInput);
  const right = bootstrapCoreOperationalRuntime(bootstrapInput);

  assert.equal(left.name, right.name);
  assert.equal(left.status, right.status);
  assert.deepEqual(left.getConfig(), right.getConfig());
  assert.deepEqual(left.getLifecycleState(), right.getLifecycleState());
  assert.deepEqual(left.executeCommand(commandInput()), right.executeCommand(commandInput()));
});

test('returned Core executes commands through the composed real pipeline', () => {
  const core = bootstrapCoreOperationalRuntime(bootstrapInput);

  assert.deepEqual(core.executeCommand(commandInput()), {
    status: 'succeeded',
    output: { echoed: { message: 'hello' } },
    generatedAt: '2026-07-31T00:00:00.000Z',
  });
});
