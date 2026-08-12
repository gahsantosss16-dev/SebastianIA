import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONVERSE_COMMAND_TYPE,
  InMemorySpecializedAgent,
  InvalidSpecializedAgentHandoffInputError,
} from '../../core/agent/index.js';
import { SpecializedToolInvocationFailureError } from '../../core/tool/index.js';
import type { ModelInterpretationDecision, ModelProvider } from '../../core/model/ModelProviderContract.js';
import type { DevelopmentTaskPlan, DevelopmentTaskResult } from '../../core/development/index.js';

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
    recentExchanges: [],
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

test('specialized agent invokes the Tool for a workspace write decision and relays its message', async () => {
  let invocationPayload: unknown;
  const modelProvider: ModelProvider = {
    interpret: async () => ({
      intent: 'useTool',
      toolId: 'fs.createTextFile',
      toolInput: { path: 'pendencias.md', content: 'revisar autenticação' },
    }),
  };
  const agent = new InMemorySpecializedAgent(
    {
      invoke: (input) => {
        invocationPayload = input;
        return {
          status: 'completed',
          output: { operation: 'createTextFile', outcome: 'ok', path: 'pendencias.md', message: 'Nota "pendencias.md" criada.' },
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
    payload: { commandInput: { type: 'converse', input: { text: 'Crie uma nota chamada pendencias.md com: revisar autenticação' } } },
  });

  assert.deepEqual(invocationPayload, {
    toolId: 'fs.createTextFile',
    executionId: 'converse:2026-08-11T00:00:00.000Z',
    responsibilityId: 'capability.execute.converse',
    requestedAt: '2026-08-11T00:00:01.000Z',
    payload: { path: 'pendencias.md', content: 'revisar autenticação' },
  });
  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  assert.deepEqual(result.output.finalResult, { message: 'Nota "pendencias.md" criada.' });
});

test('specialized agent invokes the Tool for a git-inspection decision and relays its message', async () => {
  let invocationPayload: unknown;
  const modelProvider: ModelProvider = {
    interpret: async () => ({ intent: 'useTool', toolId: 'git.status', toolInput: {} }),
  };
  const agent = new InMemorySpecializedAgent(
    {
      invoke: (input) => {
        invocationPayload = input;
        return {
          status: 'completed',
          output: { operation: 'status', outcome: 'ok', branch: 'main', clean: true, message: 'Branch "main", sem alterações pendentes.' },
        };
      },
    },
    modelProvider,
  );

  const result = await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-12T00:00:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-12T00:00:01.000Z',
    payload: { commandInput: { type: 'converse', input: { text: 'Qual é o estado deste repositório?' } } },
  });

  assert.deepEqual(invocationPayload, {
    toolId: 'git.status',
    executionId: 'converse:2026-08-12T00:00:00.000Z',
    responsibilityId: 'capability.execute.converse',
    requestedAt: '2026-08-12T00:00:01.000Z',
    payload: {},
  });
  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  assert.deepEqual(result.output.finalResult, { message: 'Branch "main", sem alterações pendentes.' });
});

test('specialized agent runs a developTask decision through its default orchestrator, invoking the Tool for every plan step', async () => {
  const plan: DevelopmentTaskPlan = {
    objective: 'Substituir texto em "exemplo.ts" e executar a validação "validation.test".',
    steps: [
      {
        stepId: 'edit',
        description: 'Substituir o texto indicado em "exemplo.ts".',
        toolId: 'fs.replaceText',
        toolInput: { path: 'exemplo.ts', searchText: 'const x = 1;', replaceText: 'const x = 2;' },
      },
      { stepId: 'validate', description: 'Executar a validação "validation.test".', toolId: 'validation.test', toolInput: {} },
      { stepId: 'status', description: 'Consultar o estado do repositório Git após a alteração.', toolId: 'git.status', toolInput: {} },
      { stepId: 'diff', description: 'Consultar o diff atual do repositório Git após a alteração.', toolId: 'git.diff', toolInput: {} },
    ],
  };
  const modelProvider: ModelProvider = {
    interpret: async () => ({ intent: 'developTask', plan }),
  };
  const invokedToolIds: string[] = [];
  const outputsByToolId: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
    'fs.replaceText': { operation: 'replaceText', outcome: 'ok', path: 'exemplo.ts', message: 'Arquivo "exemplo.ts" atualizado.' },
    'validation.test': { operation: 'validation', outcome: 'ok', toolId: 'validation.test', succeeded: true, exitCode: 0, message: 'ok' },
    'git.status': { operation: 'status', outcome: 'ok', branch: 'main', clean: false, changedFiles: [{ status: 'M', path: 'exemplo.ts' }], message: 'ok' },
    'git.diff': { operation: 'diff', outcome: 'ok', diff: '- const x = 1;\n+ const x = 2;\n', truncated: false, message: 'ok' },
  };

  const agent = new InMemorySpecializedAgent({
    invoke: (input) => {
      invokedToolIds.push(input.toolId);
      return { status: 'completed', output: outputsByToolId[input.toolId] ?? {} };
    },
  }, modelProvider);

  const result = await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-12T00:00:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-12T00:00:01.000Z',
    payload: {
      commandInput: {
        type: 'converse',
        input: { text: 'No arquivo exemplo.ts, substitua "const x = 1;" por "const x = 2;" e execute os testes.' },
      },
    },
  });

  assert.deepEqual(invokedToolIds, ['fs.replaceText', 'validation.test', 'git.status', 'git.diff']);
  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  const finalResult = result.output.finalResult as { readonly message: string; readonly developmentTask: DevelopmentTaskResult };
  assert.equal(typeof finalResult.message, 'string');
  assert.equal(finalResult.developmentTask.status, 'completed');
  assert.deepEqual(finalResult.developmentTask.filesChanged, ['exemplo.ts']);
});

test('specialized agent reports a blocked developTask when the edit step is refused for an already-modified file', async () => {
  const plan: DevelopmentTaskPlan = {
    objective: 'Substituir texto em "exemplo.ts".',
    steps: [
      { stepId: 'edit', description: 'Substituir o texto indicado em "exemplo.ts".', toolId: 'fs.replaceText', toolInput: { path: 'exemplo.ts', searchText: 'X', replaceText: 'Y' } },
      { stepId: 'validate', description: 'Executar a validação "validation.test".', toolId: 'validation.test', toolInput: {} },
    ],
  };
  const modelProvider: ModelProvider = { interpret: async () => ({ intent: 'developTask', plan }) };
  const invokedToolIds: string[] = [];

  const agent = new InMemorySpecializedAgent({
    invoke: (input) => {
      invokedToolIds.push(input.toolId);
      return {
        status: 'completed',
        output: {
          operation: 'replaceText',
          outcome: 'rejected',
          path: 'exemplo.ts',
          reasonCode: 'fileAlreadyModified',
          message: '"exemplo.ts" já possui alterações não commitadas; não vou editá-lo automaticamente.',
        },
      };
    },
  }, modelProvider);

  const result = await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-12T00:00:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-12T00:00:01.000Z',
    payload: { commandInput: { type: 'converse', input: { text: 'No arquivo exemplo.ts, substitua X por Y e execute os testes' } } },
  });

  assert.deepEqual(invokedToolIds, ['fs.replaceText']);
  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  const finalResult = result.output.finalResult as { readonly developmentTask: DevelopmentTaskResult };
  assert.equal(finalResult.developmentTask.status, 'blocked');
  assert.equal(finalResult.developmentTask.reason, 'fileAlreadyModified');
});

test('specialized agent delegates developTask execution to an explicitly injected orchestrator instead of building its own', async () => {
  const plan: DevelopmentTaskPlan = { objective: 'x', steps: [{ stepId: 's', description: 'd', toolId: 'git.status', toolInput: {} }] };
  const modelProvider: ModelProvider = { interpret: async () => ({ intent: 'developTask', plan }) };
  let receivedPlan: DevelopmentTaskPlan | undefined;
  const stubResult: DevelopmentTaskResult = {
    objective: 'x',
    status: 'completed',
    steps: [],
    filesChanged: [],
    message: 'stub result',
  };

  const agent = new InMemorySpecializedAgent(
    { invoke: () => assert.fail('The injected orchestrator, not the raw Tool, should have been used.') },
    modelProvider,
    {
      execute: (receivedPlanArg) => {
        receivedPlan = receivedPlanArg;
        return stubResult;
      },
    },
  );

  const result = await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-12T00:00:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-12T00:00:01.000Z',
    payload: { commandInput: { type: 'converse', input: { text: 'qualquer texto' } } },
  });

  assert.deepEqual(receivedPlan, plan);
  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  assert.deepEqual(result.output.finalResult, { message: 'stub result', developmentTask: stubResult });
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
    recentExchanges: [],
    requestedAt: '2026-08-11T00:05:01.000Z',
  });
});

test('specialized agent attaches a conversationTurn to memoryExtras (never to finalResult) for a respond decision (SPEC-045)', async () => {
  const modelProvider: ModelProvider = {
    interpret: async () => ({ intent: 'respond', answer: 'Sobre isso, você registrou: "prefiro café".' }),
  };
  const agent = new InMemorySpecializedAgent(undefined, modelProvider);

  const result = await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-12T00:00:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-12T00:00:01.000Z',
    payload: { commandInput: { type: 'converse', input: { text: 'O que você sabe?' } } },
  });

  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  assert.deepEqual(result.output.finalResult, { message: 'Sobre isso, você registrou: "prefiro café".' });
  assert.deepEqual(result.output.memoryExtras, {
    conversationTurn: {
      requestText: 'O que você sabe?',
      summary: 'Sobre isso, você registrou: "prefiro café".',
      kind: 'respond',
    },
  });
});

test('specialized agent does not attach a conversationTurn for remember, addTask or completeTask decisions - their content is already captured as a fact/task', async () => {
  const scenarios: readonly ModelInterpretationDecision[] = [
    { intent: 'remember', content: 'prefiro café' },
    { intent: 'addTask', content: 'comprar leite' },
    { intent: 'completeTask', taskId: 'converse:2026-08-11T00:00:00.000Z' },
  ];

  for (const decision of scenarios) {
    const modelProvider: ModelProvider = { interpret: async () => decision };
    const agent = new InMemorySpecializedAgent(undefined, modelProvider);

    const result = await agent.handoff({
      responsibilityId: 'capability.execute.converse',
      executionId: 'converse:2026-08-12T00:00:00.000Z',
      commandType: CONVERSE_COMMAND_TYPE,
      requestedAt: '2026-08-12T00:00:01.000Z',
      payload: { commandInput: { type: 'converse', input: { text: 'texto original do pedido' } } },
    });

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal('memoryExtras' in result.output, false, `expected no memoryExtras for intent "${decision.intent}"`);
  }
});

test('specialized agent attaches a conversationTurn built from the Tool message for a useTool decision', async () => {
  const modelProvider: ModelProvider = {
    interpret: async () => ({ intent: 'useTool', toolId: 'fs.listDirectory', toolInput: { path: '.' } }),
  };
  const agent = new InMemorySpecializedAgent(
    { invoke: () => ({ status: 'completed', output: { message: 'Arquivos em ".": a.md.' } }) },
    modelProvider,
  );

  const result = await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-12T00:00:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-12T00:00:01.000Z',
    payload: { commandInput: { type: 'converse', input: { text: 'Quais arquivos existem?' } } },
  });

  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  assert.deepEqual(result.output.finalResult, { message: 'Arquivos em ".": a.md.' });
  assert.deepEqual(result.output.memoryExtras, {
    conversationTurn: { requestText: 'Quais arquivos existem?', summary: 'Arquivos em ".": a.md.', kind: 'useTool' },
  });
});

test('specialized agent never attaches a conversationTurn to a failed handoff (unexpected Tool failure)', async () => {
  const modelProvider: ModelProvider = {
    interpret: async () => ({ intent: 'useTool', toolId: 'fs.readFile', toolInput: { path: 'x.txt' } }),
  };
  const failure = new SpecializedToolInvocationFailureError('unexpected I/O failure');
  const agent = new InMemorySpecializedAgent({ invoke: () => ({ status: 'failed', error: failure }) }, modelProvider);

  const result = await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-12T00:00:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-12T00:00:01.000Z',
    payload: { commandInput: { type: 'converse', input: { text: 'Leia o arquivo x.txt' } } },
  });

  assert.equal(result.status, 'failed');
});

test('specialized agent does not attach a conversationTurn when the ModelProvider marks its respond decision as non-recordable (SPEC-045 homologação fix)', async () => {
  const modelProvider: ModelProvider = {
    interpret: async () => ({
      intent: 'respond',
      answer: 'Ainda não tenho um contexto anterior para continuar.',
      recordable: false,
    }),
  };
  const agent = new InMemorySpecializedAgent(undefined, modelProvider);

  const result = await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-12T00:00:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-12T00:00:01.000Z',
    payload: { commandInput: { type: 'converse', input: { text: 'Então continua' } } },
  });

  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  assert.deepEqual(result.output.finalResult, { message: 'Ainda não tenho um contexto anterior para continuar.' });
  assert.equal('memoryExtras' in result.output, false);
});

test('specialized agent attaches a conversationTurn for a respond decision when recordable is omitted (defaults to true)', async () => {
  const modelProvider: ModelProvider = {
    interpret: async () => ({ intent: 'respond', answer: 'resposta normal' }),
  };
  const agent = new InMemorySpecializedAgent(undefined, modelProvider);

  const result = await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-12T00:00:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-12T00:00:01.000Z',
    payload: { commandInput: { type: 'converse', input: { text: 'pergunta qualquer' } } },
  });

  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') {
    assert.fail('Expected completed status.');
  }
  assert.equal('memoryExtras' in result.output, true);
});

test('specialized agent forwards hydrated recentExchanges to the ModelProvider request', async () => {
  let interpretRequest: unknown;
  const modelProvider: ModelProvider = {
    interpret: async (request) => {
      interpretRequest = request;
      return { intent: 'respond', answer: 'unused' };
    },
  };
  const agent = new InMemorySpecializedAgent(undefined, modelProvider);
  const recentExchanges = [{ id: 'e1', requestText: 'oi', summary: 'olá!', kind: 'respond', recordedAt: '2026-08-12T00:00:00.000Z' }];

  await agent.handoff({
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-08-12T00:05:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-08-12T00:05:01.000Z',
    payload: {
      commandInput: {
        type: 'converse',
        input: { text: 'Então continua' },
        temporary: { values: { recentExchanges } },
      },
    },
  });

  assert.deepEqual(interpretRequest, {
    text: 'Então continua',
    rememberedFacts: [],
    pendingTasks: [],
    recentExchanges,
    requestedAt: '2026-08-12T00:05:01.000Z',
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
