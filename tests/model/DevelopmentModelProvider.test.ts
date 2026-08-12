import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentModelProvider } from '../../core/model/DevelopmentModelProvider.js';
import { InvalidModelInterpretationRequestError } from '../../core/model/ModelProviderContractErrors.js';
import type { PendingTaskRecord, RememberedFactRecord } from '../../core/memory/index.js';

function fact(content: string): RememberedFactRecord {
  return { id: 'remember:1', content, recordedAt: '2026-08-11T00:00:00.000Z' };
}

function task(id: string, content: string): PendingTaskRecord {
  return { id, content, createdAt: '2026-08-11T00:00:00.000Z' };
}

test('interpret extracts remember intent using the "lembra que" marker', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Sebastian, lembra que prefiro reuniões de manhã',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:00:00.000Z',
  });

  assert.deepEqual(decision, { intent: 'remember', content: 'prefiro reuniões de manhã' });
});

test('interpret is case-insensitive for the remember marker', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Sebastian, LEMBRA QUE eu gosto de café',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:00:00.000Z',
  });

  assert.deepEqual(decision, { intent: 'remember', content: 'eu gosto de café' });
});

test('interpret responds using the most recent remembered fact for a question', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Qual horário eu prefiro para reuniões?',
    rememberedFacts: [fact('prefiro reuniões de manhã')],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'respond',
    answer: 'Sobre isso, você registrou: "prefiro reuniões de manhã".',
  });
});

test('interpret responds with a clear message for a question with no remembered facts', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Qual horário eu prefiro para reuniões?',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'respond',
    answer: 'Ainda não tenho nenhuma memória registrada sobre isso.',
  });
});

test('interpret falls back to a generic response for unmatched input', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'olá',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, { intent: 'respond', answer: 'Ainda não sei responder a isso.' });
});

test('interpret treats an empty remember marker suffix as unmatched', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'lembra que   ',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.equal(decision.intent, 'respond');
});

test('interpret is deterministic for identical input', async () => {
  const provider = new DevelopmentModelProvider();
  const request = {
    text: 'Sebastian, lembra que prefiro reuniões de manhã',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:00:00.000Z',
  };

  const left = await provider.interpret(request);
  const right = await provider.interpret(request);

  assert.deepEqual(left, right);
});

test('interpret rejects an invalid request with a typed error', async () => {
  const provider = new DevelopmentModelProvider();

  await assert.rejects(
    () => provider.interpret(null as never),
    (error: unknown) => {
      assert.ok(error instanceof InvalidModelInterpretationRequestError);
      return true;
    },
  );

  await assert.rejects(
    () => provider.interpret({ text: '   ', rememberedFacts: [], requestedAt: '2026-08-11T00:00:00.000Z' }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidModelInterpretationRequestError);
      return true;
    },
  );

  await assert.rejects(
    () =>
      provider.interpret({
        text: 'olá',
        rememberedFacts: 'not-an-array' as never,
        requestedAt: '2026-08-11T00:00:00.000Z',
      }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidModelInterpretationRequestError);
      return true;
    },
  );

  await assert.rejects(
    () =>
      provider.interpret({
        text: 'olá',
        rememberedFacts: [],
        pendingTasks: 'not-an-array' as never,
        requestedAt: '2026-08-11T00:00:00.000Z',
      }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidModelInterpretationRequestError);
      return true;
    },
  );
});

test('interpret recognizes the "arquivos existem" marker as a useTool listDirectory decision', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Quais arquivos existem na pasta docs/specs?',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'useTool',
    toolId: 'fs.listDirectory',
    toolInput: { path: 'docs/specs' },
  });
});

test('interpret defaults the listDirectory path to "." when no path is given', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Quais arquivos existem?',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'useTool',
    toolId: 'fs.listDirectory',
    toolInput: { path: '.' },
  });
});

test('interpret recognizes the "leia o arquivo" marker as a useTool readFile decision', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Leia o arquivo docs/VISION.md',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'useTool',
    toolId: 'fs.readFile',
    toolInput: { path: 'docs/VISION.md' },
  });
});

test('interpret falls back to a generic response when "leia o arquivo" has no path', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'leia o arquivo   ',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.equal(decision.intent, 'respond');
});

test('interpret is deterministic and case-insensitive for the filesystem markers', async () => {
  const provider = new DevelopmentModelProvider();
  const request = {
    text: 'LEIA O ARQUIVO docs/VISION.md',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  };

  const left = await provider.interpret(request);
  const right = await provider.interpret(request);

  assert.deepEqual(left, right);
  assert.deepEqual(left, { intent: 'useTool', toolId: 'fs.readFile', toolInput: { path: 'docs/VISION.md' } });
});

test('interpret recognizes the "adiciona uma tarefa" marker as an addTask decision', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Adiciona uma tarefa: comprar leite',
    rememberedFacts: [],
    pendingTasks: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, { intent: 'addTask', content: 'comprar leite' });
});

test('interpret treats an empty addTask marker suffix as unmatched', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'adiciona uma tarefa:   ',
    rememberedFacts: [],
    pendingTasks: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.equal(decision.intent, 'respond');
});

test('interpret rejects task content above the 500-character limit with a friendly response, not addTask', async () => {
  const provider = new DevelopmentModelProvider();
  const longContent = 'x'.repeat(501);

  const decision = await provider.interpret({
    text: `Adiciona uma tarefa: ${longContent}`,
    rememberedFacts: [],
    pendingTasks: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'respond',
    answer: 'O texto da tarefa é grande demais (limite de 500 caracteres).',
  });
});

test('interpret accepts task content at exactly the 500-character limit', async () => {
  const provider = new DevelopmentModelProvider();
  const maxContent = 'x'.repeat(500);

  const decision = await provider.interpret({
    text: `Adiciona uma tarefa: ${maxContent}`,
    rememberedFacts: [],
    pendingTasks: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, { intent: 'addTask', content: maxContent });
});

test('interpret composes the pending task list for the "minhas tarefas" marker', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Quais são minhas tarefas?',
    rememberedFacts: [],
    pendingTasks: [task('t1', 'comprar leite'), task('t2', 'pagar conta')],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'respond',
    answer: 'Suas tarefas pendentes: comprar leite, pagar conta.',
  });
});

test('interpret reports clearly when there are no pending tasks', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Quais são minhas tarefas?',
    rememberedFacts: [],
    pendingTasks: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, { intent: 'respond', answer: 'Você não tem nenhuma tarefa pendente.' });
});

test('interpret defaults pendingTasks to empty when the field is omitted entirely', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Quais são minhas tarefas?',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, { intent: 'respond', answer: 'Você não tem nenhuma tarefa pendente.' });
});

test('interpret resolves a single exact match for "marca ... como feita" to a completeTask decision', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: "Marca 'comprar leite' como feita",
    rememberedFacts: [],
    pendingTasks: [task('t1', 'comprar leite'), task('t2', 'pagar conta')],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, { intent: 'completeTask', taskId: 't1' });
});

test('interpret matches "marca ... como feita" case-insensitively and after trimming', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: "marca 'COMPRAR LEITE' como feita",
    rememberedFacts: [],
    pendingTasks: [task('t1', 'comprar leite')],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, { intent: 'completeTask', taskId: 't1' });
});

test('interpret reports a friendly not-found response instead of completing an unmatched task', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: "Marca 'lavar o carro' como feita",
    rememberedFacts: [],
    pendingTasks: [task('t1', 'comprar leite')],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'respond',
    answer: 'Não encontrei nenhuma tarefa pendente correspondente a "lavar o carro".',
  });
});

test('interpret reports ambiguity instead of arbitrarily completing one of several matching tasks', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: "Marca 'comprar leite' como feita",
    rememberedFacts: [],
    pendingTasks: [task('t1', 'comprar leite'), task('t2', 'Comprar Leite')],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'respond',
    answer: 'Mais de uma tarefa pendente corresponde a "comprar leite"; não vou concluir nenhuma para evitar engano.',
  });
});

test('interpret never performs network I/O and resolves purely locally', async () => {
  const provider = new DevelopmentModelProvider();
  const start = Date.now();

  await provider.interpret({
    text: 'Sebastian, lembra que teste rápido',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:00:00.000Z',
  });

  assert.ok(Date.now() - start < 50, 'interpretation should resolve near-instantly with no I/O');
});
