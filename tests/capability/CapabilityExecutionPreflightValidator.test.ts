import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CapabilityExecutionPreflightValidator,
  type CapabilityDescriptor,
  type CapabilityHandler,
  type CapabilityInvocation,
  CapabilityResolver,
} from '../../core/capability/index.js';
import {
  CapabilityPreflightError,
  CapabilityPreflightNotReadyError,
  InvalidCapabilityPreflightInputError,
} from '../../core/capability/CapabilityExecutionPreflightErrors.js';
import { CapabilityExecutionPreflightValidator as CoreCapabilityExecutionPreflightValidator } from '../../core/index.js';

const validator = new CapabilityExecutionPreflightValidator();

const invocation: CapabilityInvocation = {
  capabilityId: 'cap.echo',
  input: { message: 'hello' },
  context: { source: 'spec-019-test' },
  generatedAt: '2026-07-31T00:00:00.000Z',
};

const validCatalog: readonly CapabilityDescriptor[] = [
  {
    id: 'cap.echo',
    name: 'Echo Capability',
    version: '1.0.0',
    handlerId: 'handler.echo',
  },
];

test('CapabilityExecutionPreflightValidator returns ready for consistent invocation and catalog', () => {
  const result = validator.validate(invocation, validCatalog);

  assert.equal(result.status, 'ready');
  assert.equal(result.capabilityId, 'cap.echo');
  assert.deepEqual(result.descriptor, validCatalog[0]);
});

test('CapabilityExecutionPreflightValidator rejects invalid invocation input', () => {
  assert.throws(
    () => validator.validate(null as unknown as CapabilityInvocation, validCatalog),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityPreflightInputError);
      return true;
    },
  );
});

test('CapabilityExecutionPreflightValidator rejects invalid catalog input', () => {
  assert.throws(
    () => validator.validate(invocation, null as unknown as readonly CapabilityDescriptor[]),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityPreflightInputError);
      return true;
    },
  );
});

test('CapabilityExecutionPreflightValidator rejects missing capability in catalog', () => {
  const missingCatalog: readonly CapabilityDescriptor[] = [
    {
      id: 'cap.other',
      name: 'Other Capability',
      version: '1.0.0',
      handlerId: 'handler.other',
    },
  ];

  assert.throws(
    () => validator.validate(invocation, missingCatalog),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityPreflightNotReadyError);
      return true;
    },
  );
});

test('CapabilityExecutionPreflightValidator rejects invalid descriptor shape in catalog', () => {
  const invalidCatalog: readonly CapabilityDescriptor[] = [
    {
      id: 'cap.echo',
      name: 'Echo Capability',
      version: '1.0.0',
      handlerId: '',
    },
  ];

  assert.throws(
    () => validator.validate(invocation, invalidCatalog),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityPreflightInputError);
      return true;
    },
  );
});

test('CapabilityExecutionPreflightValidator is deterministic for identical inputs', () => {
  const left = validator.validate(invocation, validCatalog);
  const right = validator.validate(invocation, validCatalog);

  assert.deepEqual(left, right);
});

test('CapabilityExecutionPreflightValidator output does not expose mutable internal references', () => {
  const result = validator.validate(invocation, validCatalog);
  const mutableResult = result as unknown as {
    descriptor: { name: string };
  };

  mutableResult.descriptor.name = 'Mutated Name';

  const reloaded = validator.validate(invocation, validCatalog);
  assert.equal(reloaded.descriptor.name, 'Echo Capability');
});

test('CapabilityExecutionPreflightValidator does not mutate invocation or catalog input', () => {
  const invocationCopy = structuredClone(invocation);
  const catalogCopy = structuredClone(validCatalog);

  validator.validate(invocation, validCatalog);

  assert.deepEqual(invocation, invocationCopy);
  assert.deepEqual(validCatalog, catalogCopy);
});

test('CapabilityExecutionPreflightValidator wraps result composition failures with typed error', () => {
  const originalStructuredClone = globalThis.structuredClone;
  globalThis.structuredClone = (() => {
    throw new Error('forced preflight clone failure');
  }) as typeof globalThis.structuredClone;

  try {
    assert.throws(
      () => validator.validate(invocation, validCatalog),
      (error: unknown) => {
        assert.ok(error instanceof CapabilityPreflightError);
        return true;
      },
    );
  } finally {
    globalThis.structuredClone = originalStructuredClone;
  }
});

test('CapabilityExecutionPreflightValidator is compatible immediately before CapabilityResolver.invoke', () => {
  const preflightResult = validator.validate(invocation, validCatalog);

  const handler: CapabilityHandler = (currentInvocation) => ({
    echoed: currentInvocation.input,
  });

  const resolver = new CapabilityResolver(
    new Map([
      [preflightResult.descriptor.handlerId, handler],
    ]),
  );

  const result = resolver.invoke(invocation, validCatalog);

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, {
    echoed: { message: 'hello' },
  });
});

test('core public entrypoint exposes CapabilityExecutionPreflightValidator', () => {
  assert.equal(typeof CoreCapabilityExecutionPreflightValidator, 'function');
});