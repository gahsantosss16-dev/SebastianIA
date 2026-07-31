import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CapabilityExecutionBundleBuilder,
  CapabilityRegistry,
  CommandCapabilityBindings,
  CommandCapabilityExecutionCoordinator,
  CommandProcessingResultAdapter,
  type CapabilityHandler,
} from '../../core/capability/index.js';
import type { CommandProcessingResult } from '../../core/command/CommandTypes.js';
import {
  CommandProcessingResultAdapterError,
  InvalidCommandProcessingResultAdapterInputError,
} from '../../core/capability/CommandProcessingResultAdapterErrors.js';
import { CommandProcessingResultAdapter as CoreCommandProcessingResultAdapter } from '../../core/index.js';

const greetingDescriptor = {
  id: 'cap.greeting',
  name: 'Greeting Capability',
  version: '1.0.0',
  handlerId: 'handler.greeting',
} as const;

const greetingHandler: CapabilityHandler = (invocation) => ({
  echoed: invocation.input,
  source: invocation.context,
});

function createResult(overrides?: Partial<CommandProcessingResult>): CommandProcessingResult {
  const base: CommandProcessingResult = {
    status: 'succeeded',
    output: {
      type: 'greeting',
      input: { message: 'hello' },
      context: { source: 'spec-023-test' },
      generatedAt: '2026-07-31T00:00:00.000Z',
    },
    generatedAt: '2026-07-31T00:00:00.000Z',
  };

  if (!overrides) {
    return base;
  }

  return {
    ...base,
    ...overrides,
  };
}

function createBundle() {
  const registry = new CapabilityRegistry();
  registry.register(greetingDescriptor, greetingHandler);
  const builder = new CapabilityExecutionBundleBuilder();
  return builder.build(registry);
}

test('CommandProcessingResultAdapter adapts valid result to execution input', () => {
  const adapter = new CommandProcessingResultAdapter();
  const adapted = adapter.adapt(createResult());

  assert.deepEqual(adapted, {
    commandType: 'greeting',
    input: { message: 'hello' },
    context: { source: 'spec-023-test' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  });
});

test('CommandProcessingResultAdapter rejects invalid result input', () => {
  const adapter = new CommandProcessingResultAdapter();

  assert.throws(
    () => adapter.adapt(null as never),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandProcessingResultAdapterInputError);
      return true;
    },
  );
});

test('CommandProcessingResultAdapter rejects unsupported status', () => {
  const adapter = new CommandProcessingResultAdapter();

  assert.throws(
    () => adapter.adapt({ ...createResult(), status: 'failed' as never }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandProcessingResultAdapterInputError);
      return true;
    },
  );
});

test('CommandProcessingResultAdapter rejects invalid output.type', () => {
  const adapter = new CommandProcessingResultAdapter();

  assert.throws(
    () =>
      adapter.adapt(
        createResult({
          output: {
            ...createResult().output,
            type: ' ',
          },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandProcessingResultAdapterInputError);
      return true;
    },
  );
});

test('CommandProcessingResultAdapter rejects invalid output.input', () => {
  const adapter = new CommandProcessingResultAdapter();

  assert.throws(
    () =>
      adapter.adapt(
        createResult({
          output: {
            ...createResult().output,
            input: null,
          } as never,
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandProcessingResultAdapterInputError);
      return true;
    },
  );
});

test('CommandProcessingResultAdapter rejects invalid output.context', () => {
  const adapter = new CommandProcessingResultAdapter();

  assert.throws(
    () =>
      adapter.adapt(
        createResult({
          output: {
            ...createResult().output,
            context: null,
          } as never,
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandProcessingResultAdapterInputError);
      return true;
    },
  );
});

test('CommandProcessingResultAdapter rejects invalid generatedAt', () => {
  const adapter = new CommandProcessingResultAdapter();

  assert.throws(
    () => adapter.adapt(createResult({ generatedAt: ' ' })),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandProcessingResultAdapterInputError);
      return true;
    },
  );
});

test('CommandProcessingResultAdapter is deterministic for identical inputs', () => {
  const adapter = new CommandProcessingResultAdapter();
  const result = createResult();

  const left = adapter.adapt(result);
  const right = adapter.adapt(result);

  assert.deepEqual(left, right);
});

test('CommandProcessingResultAdapter does not mutate original result', () => {
  const adapter = new CommandProcessingResultAdapter();
  const result = createResult();
  const before = structuredClone(result);

  adapter.adapt(result);

  assert.deepEqual(result, before);
});

test('CommandProcessingResultAdapter output does not share mutable references', () => {
  const adapter = new CommandProcessingResultAdapter();
  const result = createResult();

  const adapted = adapter.adapt(result);

  (result.output as { input: { message: string }; context: { source: string } }).input.message = 'changed';
  (result.output as { input: { message: string }; context: { source: string } }).context.source = 'changed';

  assert.deepEqual(adapted.input, { message: 'hello' });
  assert.deepEqual(adapted.context, { source: 'spec-023-test' });
});

test('CommandProcessingResultAdapter output is compatible with CommandCapabilityExecutionCoordinator.execute', () => {
  const adapter = new CommandProcessingResultAdapter();
  const adapted = adapter.adapt(createResult());
  const bundle = createBundle();
  const bindings = new CommandCapabilityBindings([{ commandType: 'greeting', capabilityId: 'cap.greeting' }]);
  const coordinator = new CommandCapabilityExecutionCoordinator(bindings);

  const result = coordinator.execute(adapted, bundle);

  assert.equal(result.status, 'succeeded');
});

test('CommandProcessingResultAdapter wraps non-Error throwables in typed adapter error', () => {
  const adapter = new CommandProcessingResultAdapter();

  const throwingResult = createResult({
    output: {
      type: 'greeting',
      input: {
        get value() {
          throw 'non-error throwable';
        },
      },
      context: { source: 'spec-023-test' },
      generatedAt: '2026-07-31T00:00:00.000Z',
    },
  });

  assert.throws(
    () => adapter.adapt(throwingResult),
    (error: unknown) => {
      assert.ok(error instanceof CommandProcessingResultAdapterError);
      return true;
    },
  );
});

test('core public entrypoint exposes CommandProcessingResultAdapter', () => {
  assert.equal(typeof CoreCommandProcessingResultAdapter, 'function');
});