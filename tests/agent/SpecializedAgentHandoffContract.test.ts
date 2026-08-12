import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONVERSE_COMMAND_TYPE,
  InMemorySpecializedAgent,
  InvalidSpecializedAgentHandoffInputError,
} from '../../core/agent/index.js';
import { SpecializedToolInvocationFailureError } from '../../core/tool/index.js';
import type { ModelProvider } from '../../core/model/ModelProviderContract.js';

test('specialized agent returns completed for valid handoff input', async () => {
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

  const result = await agent.handoff({
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

test('specialized agent rejects invalid handoff input with typed error', async () => {
  const agent = new InMemorySpecializedAgent();

  await assert.rejects(
    () => agent.handoff(null as never),
    (error: unknown) => {
      assert.ok(error instanceof InvalidSpecializedAgentHandoffInputError);
      return true;
    },
  );

  await assert.rejects(
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

test('specialized agent propagates typed tool failure', async () => {
  const agent = new InMemorySpecializedAgent({
    invoke: () => ({
      status: 'failed',
      error: new SpecializedToolInvocationFailureError('tool failed'),
    }),
  });

  const result = await agent.handoff({
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

test('specialized agent does not consult the ModelProvider for non-converse responsibilities', async () => {
  let interpretCount = 0;
  const modelProvider: ModelProvider = {
    interpret: async () => {
      interpretCount += 1;
      return { intent: 'respond', answer: 'unused' };
    },
  };
  let toolInvokeCount = 0;
  const agent = new InMemorySpecializedAgent(
    { invoke: () => { toolInvokeCount += 1; return { status: 'completed', output: {} }; } },
    modelProvider,
  );

  await agent.handoff({
    responsibilityId: 'capability.execute.remember',
    executionId: 'remember:2026-08-11T00:00:00.000Z',
    commandType: 'remember',
    requestedAt: '2026-08-11T00:00:01.000Z',
    payload: { commandInput: { type: 'remember', input: { text: 'x' } } },
  });

  assert.equal(interpretCount, 0);
  assert.equal(toolInvokeCount, 1);
});

test('specialized agent behaves as plain pass-through for converse when no ModelProvider is supplied', async () => {
  let toolInvokeCount = 0;
  const agent = new InMemorySpecializedAgent({
    invoke: () => {
      toolInvokeCount += 1;
      return { status: 'completed', output: {} };
    },
  });

  const result = await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-11T00:00:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-11T00:00:01.000Z',
    payload: { commandInput: { type: 'converse', input: { text: 'olá' } } },
  });

  assert.equal(toolInvokeCount, 1);
  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  assert.equal(result.output.finalResult, undefined);
});

test('specialized agent consults the ModelProvider for converse and does not invoke the Tool', async () => {
  let interpretRequest: unknown;
  let toolInvokeCount = 0;
  const modelProvider: ModelProvider = {
    interpret: async (request) => {
      interpretRequest = request;
      return { intent: 'remember', content: 'prefiro reuniões de manhã' };
    },
  };
  const agent = new InMemorySpecializedAgent(
    { invoke: () => { toolInvokeCount += 1; return { status: 'completed', output: {} }; } },
    modelProvider,
  );

  const result = await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-11T00:00:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-11T00:00:01.000Z',
    payload: {
      commandInput: {
        type: 'converse',
        input: { text: 'Sebastian, lembra que prefiro reuniões de manhã' },
        temporary: { values: { rememberedFacts: [] } },
      },
    },
  });

  assert.equal(toolInvokeCount, 0);
  assert.deepEqual(interpretRequest, {
    text: 'Sebastian, lembra que prefiro reuniões de manhã',
    rememberedFacts: [],
    pendingTasks: [],
    requestedAt: '2026-08-11T00:00:01.000Z',
  });
  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  assert.deepEqual(result.output.finalResult, {
    memoryRecordKind: 'sebastian.memory.fact',
    content: 'prefiro reuniões de manhã',
  });
});

test('specialized agent composes a respond finalResult using hydrated remembered facts', async () => {
  const modelProvider: ModelProvider = {
    interpret: async (request) => ({
      intent: 'respond',
      answer: `Sobre isso, você registrou: "${request.rememberedFacts[0]?.content}".`,
    }),
  };
  const agent = new InMemorySpecializedAgent(undefined, modelProvider);

  const result = await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-11T00:05:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-11T00:05:01.000Z',
    payload: {
      commandInput: {
        type: 'converse',
        input: { text: 'Qual horário eu prefiro para reuniões?' },
        temporary: {
          values: {
            rememberedFacts: [{ id: 'x', content: 'prefiro reuniões de manhã', recordedAt: '2026-08-11T00:00:00.000Z' }],
          },
        },
      },
    },
  });

  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  assert.deepEqual(result.output.finalResult, {
    message: 'Sobre isso, você registrou: "prefiro reuniões de manhã".',
  });
});

test('specialized agent invokes the Tool with the decided toolId/toolInput for a useTool decision', async () => {
  let invocationPayload: unknown;
  const modelProvider: ModelProvider = {
    interpret: async () => ({
      intent: 'useTool',
      toolId: 'fs.listDirectory',
      toolInput: { path: 'docs/specs' },
    }),
  };
  const agent = new InMemorySpecializedAgent(
    {
      invoke: (input) => {
        invocationPayload = input;
        return {
          status: 'completed',
          output: { operation: 'listDirectory', outcome: 'ok', path: 'docs/specs', message: 'Arquivos em "docs/specs": a.md.' },
        };
      },
    },
    modelProvider,
  );

  const result = await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-11T00:00:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-11T00:00:01.000Z',
    payload: { commandInput: { type: 'converse', input: { text: 'Quais arquivos existem em docs/specs?' } } },
  });

  assert.deepEqual(invocationPayload, {
    toolId: 'fs.listDirectory',
    executionId: 'converse:2026-08-11T00:00:00.000Z',
    responsibilityId: 'capability.execute.converse',
    requestedAt: '2026-08-11T00:00:01.000Z',
    payload: { path: 'docs/specs' },
  });
  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  assert.deepEqual(result.output.finalResult, { message: 'Arquivos em "docs/specs": a.md.' });
});

test('specialized agent propagates an unexpected Tool failure as a failed handoff for a useTool decision', async () => {
  const modelProvider: ModelProvider = {
    interpret: async () => ({ intent: 'useTool', toolId: 'fs.readFile', toolInput: { path: 'x.txt' } }),
  };
  const failure = new SpecializedToolInvocationFailureError('unexpected I/O failure');
  const agent = new InMemorySpecializedAgent({ invoke: () => ({ status: 'failed', error: failure }) }, modelProvider);

  const result = await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-11T00:00:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-11T00:00:01.000Z',
    payload: { commandInput: { type: 'converse', input: { text: 'Leia o arquivo x.txt' } } },
  });

  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') {
    assert.fail('Expected failed status.');
  }
  assert.equal(result.error, failure);
});

test('specialized agent turns an addTask decision into a task-created finalResult', async () => {
  const modelProvider: ModelProvider = {
    interpret: async () => ({ intent: 'addTask', content: 'comprar leite' }),
  };
  const agent = new InMemorySpecializedAgent(undefined, modelProvider);

  const result = await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-11T00:00:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-11T00:00:01.000Z',
    payload: { commandInput: { type: 'converse', input: { text: 'Adiciona uma tarefa: comprar leite' } } },
  });

  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  assert.deepEqual(result.output.finalResult, {
    memoryRecordKind: 'sebastian.memory.task.created',
    content: 'comprar leite',
  });
});

test('specialized agent turns a completeTask decision into a task-completed finalResult', async () => {
  const modelProvider: ModelProvider = {
    interpret: async () => ({ intent: 'completeTask', taskId: 'converse:2026-08-11T00:00:00.000Z' }),
  };
  const agent = new InMemorySpecializedAgent(undefined, modelProvider);

  const result = await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-11T00:02:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-11T00:02:01.000Z',
    payload: { commandInput: { type: 'converse', input: { text: "Marca 'comprar leite' como feita" } } },
  });

  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  assert.deepEqual(result.output.finalResult, {
    memoryRecordKind: 'sebastian.memory.task.completed',
    taskId: 'converse:2026-08-11T00:00:00.000Z',
  });
});

test('specialized agent forwards hydrated pendingTasks to the ModelProvider request', async () => {
  let interpretRequest: unknown;
  const modelProvider: ModelProvider = {
    interpret: async (request) => {
      interpretRequest = request;
      return { intent: 'respond', answer: 'unused' };
    },
  };
  const agent = new InMemorySpecializedAgent(undefined, modelProvider);
  const pendingTasks = [{ id: 't1', content: 'comprar leite', createdAt: '2026-08-11T00:00:00.000Z' }];

  await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-11T00:05:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-11T00:05:01.000Z',
    payload: {
      commandInput: {
        type: 'converse',
        input: { text: 'Quais são minhas tarefas?' },
        temporary: { values: { pendingTasks } },
      },
    },
  });

  assert.deepEqual(interpretRequest, {
    text: 'Quais são minhas tarefas?',
    rememberedFacts: [],
    pendingTasks,
    requestedAt: '2026-08-11T00:05:01.000Z',
  });
});

test('specialized agent rejects a converse handoff with a missing or blank text', async () => {
  const modelProvider: ModelProvider = { interpret: async () => ({ intent: 'respond', answer: 'unused' }) };
  const agent = new InMemorySpecializedAgent(undefined, modelProvider);

  await assert.rejects(
    () =>
      agent.handoff({
        responsibilityId: 'capability.execute.converse',
        executionId: 'converse:2026-08-11T00:00:00.000Z',
        commandType: CONVERSE_COMMAND_TYPE,
        requestedAt: '2026-08-11T00:00:01.000Z',
        payload: { commandInput: { type: 'converse', input: {} } },
      }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidSpecializedAgentHandoffInputError);
      return true;
    },
  );
});
