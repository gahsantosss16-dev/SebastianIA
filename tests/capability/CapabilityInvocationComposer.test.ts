import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CapabilityInvocationComposer,
  type CapabilityHandler,
  type CapabilityInvocationInput,
  type CapabilityDescriptor,
  CapabilityResolver,
} from '../../core/capability/index.js';
import {
  CapabilityInvocationCompositionError,
  InvalidCapabilityInvocationInputError,
} from '../../core/capability/CapabilityInvocationComposerErrors.js';
import { CapabilityInvocationComposer as CoreCapabilityInvocationComposer } from '../../core/index.js';

const composer = new CapabilityInvocationComposer();

const baseInput: CapabilityInvocationInput = {
  capabilityId: 'cap.echo',
  input: { message: 'hello' },
  context: { source: 'spec-018-test' },
  generatedAt: '2026-07-31T00:00:00.000Z',
};

test('CapabilityInvocationComposer composes a valid invocation', () => {
  const invocation = composer.compose(baseInput);

  assert.equal(invocation.capabilityId, 'cap.echo');
  assert.deepEqual(invocation.input, { message: 'hello' });
  assert.deepEqual(invocation.context, { source: 'spec-018-test' });
  assert.equal(invocation.generatedAt, '2026-07-31T00:00:00.000Z');
});

test('CapabilityInvocationComposer rejects invalid capabilityId', () => {
  assert.throws(
    () =>
      composer.compose({
        ...baseInput,
        capabilityId: '   ',
      }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityInvocationInputError);
      return true;
    },
  );
});

test('CapabilityInvocationComposer rejects invalid input payload', () => {
  assert.throws(
    () =>
      composer.compose({
        ...baseInput,
        input: null as unknown as Readonly<Record<string, unknown>>,
      }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityInvocationInputError);
      return true;
    },
  );
});

test('CapabilityInvocationComposer rejects invalid context payload', () => {
  assert.throws(
    () =>
      composer.compose({
        ...baseInput,
        context: [] as unknown as Readonly<Record<string, unknown>>,
      }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityInvocationInputError);
      return true;
    },
  );
});

test('CapabilityInvocationComposer rejects invalid generatedAt', () => {
  assert.throws(
    () =>
      composer.compose({
        ...baseInput,
        generatedAt: '',
      }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityInvocationInputError);
      return true;
    },
  );
});

test('CapabilityInvocationComposer returns deterministic invocations for identical inputs', () => {
  const left = composer.compose(baseInput);
  const right = composer.compose(baseInput);

  assert.deepEqual(left, right);
});

test('CapabilityInvocationComposer output is immutable from caller-side input mutations', () => {
  const mutableInput = {
    capabilityId: 'cap.echo',
    input: { message: 'hello' },
    context: { source: 'spec-018-test' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  };

  const invocation = composer.compose(mutableInput);

  mutableInput.input.message = 'changed';
  mutableInput.context.source = 'changed';

  assert.deepEqual(invocation.input, { message: 'hello' });
  assert.deepEqual(invocation.context, { source: 'spec-018-test' });
});

test('CapabilityInvocationComposer output does not expose mutable internal references', () => {
  const invocation = composer.compose(baseInput);
  const mutableInvocation = invocation as unknown as {
    input: { message: string };
    context: { source: string };
  };

  mutableInvocation.input.message = 'mutated';
  mutableInvocation.context.source = 'mutated';

  const reloaded = composer.compose(baseInput);
  assert.deepEqual(reloaded.input, { message: 'hello' });
  assert.deepEqual(reloaded.context, { source: 'spec-018-test' });
});

test('CapabilityInvocationComposer wraps composition errors with typed error', () => {
  const circularInput = {
    capabilityId: 'cap.echo',
    input: { message: 'hello' },
    context: { source: 'spec-018-test' } as Record<string, unknown>,
    generatedAt: '2026-07-31T00:00:00.000Z',
  };
  circularInput.context.self = circularInput.context;

  const originalStructuredClone = globalThis.structuredClone;
  globalThis.structuredClone = (() => {
    throw new Error('forced clone failure');
  }) as typeof globalThis.structuredClone;

  try {
    assert.throws(
      () => composer.compose(circularInput),
      (error: unknown) => {
        assert.ok(error instanceof CapabilityInvocationCompositionError);
        return true;
      },
    );
  } finally {
    globalThis.structuredClone = originalStructuredClone;
  }
});

test('CapabilityInvocationComposer output is compatible with CapabilityResolver.invoke', () => {
  const invocation = composer.compose(baseInput);
  const descriptor: CapabilityDescriptor = {
    id: 'cap.echo',
    name: 'Echo',
    version: '1.0.0',
    handlerId: 'handler.echo',
  };

  const handler: CapabilityHandler = (currentInvocation) => ({
    echoed: currentInvocation.input,
    context: currentInvocation.context,
  });

  const resolver = new CapabilityResolver(
    new Map([
      [descriptor.handlerId, handler],
    ]),
  );

  const result = resolver.invoke(invocation, [descriptor]);

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, {
    echoed: { message: 'hello' },
    context: { source: 'spec-018-test' },
  });
});

test('core public entrypoint exposes CapabilityInvocationComposer', () => {
  assert.equal(typeof CoreCapabilityInvocationComposer, 'function');
});