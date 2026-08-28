import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requireSynchronousToolInvocationResult,
  SpecializedToolInvocationFailureError,
} from '../../core/tool/index.js';

test('requireSynchronousToolInvocationResult passes an already-synchronous result through unchanged', () => {
  const result = { status: 'completed' as const, output: { outcome: 'ok' } };

  assert.equal(requireSynchronousToolInvocationResult(result), result);
});

test('requireSynchronousToolInvocationResult fails loudly instead of silently misreading a Promise', () => {
  const asyncResult = Promise.resolve({ status: 'completed' as const, output: { outcome: 'ok' } });

  assert.throws(
    () => requireSynchronousToolInvocationResult(asyncResult),
    (error: unknown) => {
      assert.ok(error instanceof SpecializedToolInvocationFailureError);
      return true;
    },
  );
});
