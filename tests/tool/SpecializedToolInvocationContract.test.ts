import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemorySpecializedTool,
  InvalidSpecializedToolInvocationInputError,
} from '../../core/tool/index.js';

function validInput() {
  return {
    toolId: 'tool.greeting',
    executionId: 'greeting:2026-08-02T00:00:00.000Z',
    responsibilityId: 'capability.execute.greeting',
    requestedAt: '2026-08-02T00:00:01.000Z',
    payload: {
      commandInput: {
        type: 'greeting',
      },
    },
  } as const;
}

test('specialized tool returns completed for valid invocation input', () => {
  const tool = new InMemorySpecializedTool();

  const result = tool.invoke(validInput());

  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }

  assert.equal(result.output.toolId, 'tool.greeting');
  assert.equal(result.output.executionId, 'greeting:2026-08-02T00:00:00.000Z');
  assert.equal(result.output.responsibilityId, 'capability.execute.greeting');
  assert.equal(typeof result.output.processedAt, 'string');
});

test('specialized tool rejects invalid invocation input with typed error', () => {
  const tool = new InMemorySpecializedTool();

  assert.throws(
    () => tool.invoke(null as never),
    (error: unknown) => {
      assert.ok(error instanceof InvalidSpecializedToolInvocationInputError);
      return true;
    },
  );

  assert.throws(
    () => tool.invoke({ ...validInput(), toolId: '   ' }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidSpecializedToolInvocationInputError);
      return true;
    },
  );
});

test('specialized tool does not mutate invocation payload', () => {
  const tool = new InMemorySpecializedTool();
  const input = {
    ...validInput(),
    payload: {
      commandInput: {
        type: 'greeting',
      },
      nested: {
        flags: {
          dryRun: true,
        },
      },
    },
  };
  const before = structuredClone(input);

  tool.invoke(input);

  assert.deepEqual(input, before);
});

test('specialized tool invocation is deterministic for identical input', () => {
  const tool = new InMemorySpecializedTool();
  const input = validInput();

  const left = tool.invoke(input);
  const right = tool.invoke(input);

  assert.equal(left.status, 'completed');
  assert.equal(right.status, 'completed');
  if (left.status !== 'completed' || right.status !== 'completed') {
    assert.fail('Expected completed status for both invocations.');
  }

  assert.equal(left.output.toolId, right.output.toolId);
  assert.equal(left.output.executionId, right.output.executionId);
  assert.equal(left.output.responsibilityId, right.output.responsibilityId);
});
