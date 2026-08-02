import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemorySpecializedAgent,
  InvalidSpecializedAgentHandoffInputError,
} from '../../core/agent/index.js';
import { SpecializedToolInvocationFailureError } from '../../core/tool/index.js';

test('specialized agent returns completed for valid handoff input', () => {
  let invokeCount = 0;
  let invocationPayload: unknown;
  const agent = new InMemorySpecializedAgent({
    invoke: (input) => {
      invokeCount += 1;
      invocationPayload = input;
      return {
        status: 'completed',
        output: {
          acknowledged: true,
        },
      };
    },
  });

  const result = agent.handoff({
    responsibilityId: 'capability.execute.greeting',
    executionId: 'greeting:2026-08-02T00:00:00.000Z',
    commandType: 'greeting',
    requestedAt: '2026-08-02T00:00:01.000Z',
    payload: {
      commandInput: { type: 'greeting' },
    },
  });

  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }

  assert.equal(result.output.responsibilityId, 'capability.execute.greeting');
  assert.equal(result.output.executionId, 'greeting:2026-08-02T00:00:00.000Z');
  assert.equal(result.output.toolId, 'tool.greeting');
  assert.equal(typeof result.output.acknowledgedAt, 'string');
  assert.equal(invokeCount, 1);
  assert.deepEqual(invocationPayload, {
    toolId: 'tool.greeting',
    executionId: 'greeting:2026-08-02T00:00:00.000Z',
    responsibilityId: 'capability.execute.greeting',
    requestedAt: '2026-08-02T00:00:01.000Z',
    payload: {
      commandInput: { type: 'greeting' },
    },
  });
});

test('specialized agent rejects invalid handoff input with typed error', () => {
  const agent = new InMemorySpecializedAgent();

  assert.throws(
    () => agent.handoff(null as never),
    (error: unknown) => {
      assert.ok(error instanceof InvalidSpecializedAgentHandoffInputError);
      return true;
    },
  );

  assert.throws(
    () =>
      agent.handoff({
        responsibilityId: '   ',
        executionId: 'id',
        commandType: 'greeting',
        requestedAt: '2026-08-02T00:00:01.000Z',
        payload: {},
      }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidSpecializedAgentHandoffInputError);
      return true;
    },
  );
});

test('specialized agent propagates typed tool failure', () => {
  const agent = new InMemorySpecializedAgent({
    invoke: () => ({
      status: 'failed',
      error: new SpecializedToolInvocationFailureError('tool failed'),
    }),
  });

  const result = agent.handoff({
    responsibilityId: 'capability.execute.greeting',
    executionId: 'greeting:2026-08-02T00:00:00.000Z',
    commandType: 'greeting',
    requestedAt: '2026-08-02T00:00:01.000Z',
    payload: {
      commandInput: { type: 'greeting' },
    },
  });

  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') {
    assert.fail('Expected failed status.');
  }

  assert.ok(result.error instanceof SpecializedToolInvocationFailureError);
});
