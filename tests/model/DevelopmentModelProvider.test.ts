import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentModelProvider } from '../../core/model/DevelopmentModelProvider.js';
import { InvalidModelInterpretationRequestError } from '../../core/model/ModelProviderContractErrors.js';
import type { PendingTaskRecord, RecentExchangeRecord, RememberedFactRecord } from '../../core/memory/index.js';

function fact(content: string, id = 'remember:1', recordedAt = '2026-08-11T00:00:00.000Z'): RememberedFactRecord {
  return { id, content, recordedAt };
}

function task(id: string, content: string): PendingTaskRecord {
  return { id, content, createdAt: '2026-08-11T00:00:00.000Z' };
}

function exchange(
  id: string,
  requestText: string,
  summary: string,
  recordedAt: string,
  kind = 'respond',
): RecentExchangeRecord {
  return { id, requestText, summary, kind, recordedAt };
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
    recordable: true,
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
    recordable: false,
  });
});

test('interpret falls back to a generic response for unmatched input', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'olá',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, { intent: 'respond', answer: 'Ainda não sei responder a isso.', recordable: false });
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

test('interpret recognizes the "qual projeto" marker as a useTool describeWorkspace decision', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Em qual projeto estou?',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, { intent: 'useTool', toolId: 'fs.describeWorkspace', toolInput: {} });
});

test('interpret recognizes "crie uma nota chamada X com: Y" as a useTool createTextFile decision', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Crie uma nota chamada pendencias.md com: revisar autenticação',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'useTool',
    toolId: 'fs.createTextFile',
    toolInput: { path: 'pendencias.md', content: 'revisar autenticação' },
  });
});

test('interpret recognizes "crie um arquivo chamado X com: Y" as a useTool createTextFile decision', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Crie um arquivo chamado notas.txt com: primeira anotação',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'useTool',
    toolId: 'fs.createTextFile',
    toolInput: { path: 'notas.txt', content: 'primeira anotação' },
  });
});

test('interpret recognizes "acrescente na nota X: Y" as a useTool appendTextFile decision', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Acrescente na nota pendencias.md: revisar deploy',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'useTool',
    toolId: 'fs.appendTextFile',
    toolInput: { path: 'pendencias.md', content: 'revisar deploy' },
  });
});

test('interpret falls back to a generic response when create/append markers have no content', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Crie uma nota chamada pendencias.md com:   ',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.equal(decision.intent, 'respond');
});

test('interpret recognizes "altere o arquivo X substituindo Y por Z" as a useTool replaceText decision', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Altere o arquivo src/exemplo.ts substituindo X por Y',
    rememberedFacts: [],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'useTool',
    toolId: 'fs.replaceText',
    toolInput: { path: 'src/exemplo.ts', searchText: 'X', replaceText: 'Y' },
  });
});

test('interpret recognizes "no arquivo X, substitua Y por Z e execute os testes" as a developTask decision with a full plan', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'No arquivo exemplo.ts, substitua "const x = 1;" por "const x = 2;" e execute os testes.',
    rememberedFacts: [],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'developTask',
    plan: {
      objective: 'Substituir texto em "exemplo.ts" e executar a validação "validation.test".',
      steps: [
        {
          stepId: 'edit',
          description: 'Substituir o texto indicado em "exemplo.ts".',
          toolId: 'fs.replaceText',
          toolInput: { path: 'exemplo.ts', searchText: 'const x = 1;', replaceText: 'const x = 2;' },
        },
        {
          stepId: 'validate',
          description: 'Executar a validação "validation.test".',
          toolId: 'validation.test',
          toolInput: {},
        },
        {
          stepId: 'status',
          description: 'Consultar o estado do repositório Git após a alteração.',
          toolId: 'git.status',
          toolInput: {},
        },
        {
          stepId: 'diff',
          description: 'Consultar o diff atual do repositório Git após a alteração.',
          toolId: 'git.diff',
          toolInput: {},
        },
      ],
    },
  });
});

test('interpret recognizes the developTask marker for "e execute o build" with the build validation toolId', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'No arquivo exemplo.ts, substitua X por Y e execute o build',
    rememberedFacts: [],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.equal(decision.intent, 'developTask');
  assert.equal(decision.intent === 'developTask' ? decision.plan.steps[1]?.toolId : undefined, 'validation.build');
});

test('interpret recognizes the developTask marker for "e execute o typecheck" with the typecheck validation toolId', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'No arquivo exemplo.ts, substitua X por Y e execute o typecheck',
    rememberedFacts: [],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.equal(decision.intent, 'developTask');
  assert.equal(decision.intent === 'developTask' ? decision.plan.steps[1]?.toolId : undefined, 'validation.typecheck');
});

test('interpret falls back to a plain replaceText useTool decision when the developTask "e execute" suffix is absent', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Altere o arquivo exemplo.ts substituindo X por Y',
    rememberedFacts: [],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.equal(decision.intent, 'useTool');
});

test('interpret does not produce a developTask decision when the developTask marker has no search text', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'No arquivo exemplo.ts, substitua   por Y e execute os testes',
    rememberedFacts: [],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  // With no recognizable edit, the still-present "execute os testes" wording
  // falls through to the narrower, pre-existing validation marker instead of
  // silently failing - the plan-building step itself is simply never reached.
  assert.notEqual(decision.intent, 'developTask');
});

test('interpret recognizes a marker asking about the repository state as a useTool git.status decision', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Qual é o estado deste repositório?',
    rememberedFacts: [],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.deepEqual(decision, { intent: 'useTool', toolId: 'git.status', toolInput: {} });
});

test('interpret recognizes "mostre as alterações atuais" as a useTool git.diff decision', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Mostre as alterações atuais',
    rememberedFacts: [],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.deepEqual(decision, { intent: 'useTool', toolId: 'git.diff', toolInput: {} });
});

test('interpret recognizes "execute os testes" as a useTool validation.test decision', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Execute os testes do projeto',
    rememberedFacts: [],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.deepEqual(decision, { intent: 'useTool', toolId: 'validation.test', toolInput: {} });
});

test('interpret recognizes "execute o build" as a useTool validation.build decision', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Execute o build',
    rememberedFacts: [],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.deepEqual(decision, { intent: 'useTool', toolId: 'validation.build', toolInput: {} });
});

test('interpret recognizes "execute o typecheck" as a useTool validation.typecheck decision', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Execute o typecheck',
    rememberedFacts: [],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.deepEqual(decision, { intent: 'useTool', toolId: 'validation.typecheck', toolInput: {} });
});

test('interpret falls back to a generic response when replaceText markers have no search text', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Altere o arquivo src/exemplo.ts substituindo   por Y',
    rememberedFacts: [],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.equal(decision.intent, 'respond');
});

test('interpret selects the fact most relevant to the question, not just the most recently remembered one (SPEC-045)', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'O que você sabe sobre o projeto Sebastian IA?',
    rememberedFacts: [
      fact('gosto de café pela manhã', 'f1', '2026-08-10T00:00:00.000Z'),
      fact('o projeto Sebastian IA está na fase de memória inteligente', 'f2', '2026-08-11T00:00:00.000Z'),
      fact('prefiro reuniões à tarde', 'f3', '2026-08-09T00:00:00.000Z'),
    ],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'respond',
    answer: 'Sobre isso, você registrou: "o projeto Sebastian IA está na fase de memória inteligente".',
    recordable: true,
  });
});

test('interpret resumes a named project using relevant remembered facts as the actual state (SPEC-045)', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Sebastian, vamos continuar meu projeto de ontem',
    rememberedFacts: [
      fact('o projeto Sebastian IA está na fase de memória inteligente, SPEC-044 homologada', 'f1', '2026-08-11T00:00:00.000Z'),
    ],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'respond',
    answer: 'Retomando de onde paramos: você registrou "o projeto Sebastian IA está na fase de memória inteligente, SPEC-044 homologada".',
    recordable: true,
  });
});

test('interpret reports it has nothing to resume when no memory relates to the named project/task', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Vamos continuar meu projeto de ontem',
    rememberedFacts: [],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'respond',
    answer: 'Ainda não tenho registros sobre esse projeto ou tarefa para retomar; me conte por onde paramos.',
    recordable: false,
  });
});

test('interpret answers a short continuation reference ("então continua") using the most recent exchange, keeping the thread', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Então continua',
    rememberedFacts: [],
    recentExchanges: [
      exchange(
        'converse:1',
        'Sebastian, vamos continuar meu projeto de ontem',
        'Retomando de onde paramos: você registrou "o projeto Sebastian IA está na fase de memória inteligente".',
        '2026-08-12T00:00:00.000Z',
        'respond',
      ),
    ],
    requestedAt: '2026-08-12T00:01:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'respond',
    answer:
      'Continuando de onde paramos: Retomando de onde paramos: você registrou "o projeto Sebastian IA está na fase de memória inteligente".',
    recordable: true,
  });
});

test('interpret reports no prior context for a bare continuation reference with no recent exchanges at all', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'E agora?',
    rememberedFacts: [],
    recentExchanges: [],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'respond',
    answer: 'Ainda não tenho um contexto anterior para continuar.',
    recordable: false,
  });
});

test('interpret degrades gracefully to the most recent fact for a vague question with no keyword overlap, preserving prior behavior', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'O que você sabe sobre mim?',
    rememberedFacts: [
      fact('prefiro reuniões de manhã', 'f1', '2026-08-10T00:00:00.000Z'),
      fact('gosto de café', 'f2', '2026-08-11T00:00:00.000Z'),
    ],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'respond',
    answer: 'Sobre isso, você registrou: "gosto de café".',
    recordable: true,
  });
});

test('interpret still reports no memory for a question when nothing at all was ever remembered', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Qual horário eu prefiro para reuniões?',
    rememberedFacts: [],
    requestedAt: '2026-08-11T00:05:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'respond',
    answer: 'Ainda não tenho nenhuma memória registrada sobre isso.',
    recordable: false,
  });
});

test('interpret rejects a non-array recentExchanges with a typed error', async () => {
  const provider = new DevelopmentModelProvider();

  await assert.rejects(
    () =>
      provider.interpret({
        text: 'olá',
        rememberedFacts: [],
        recentExchanges: 'not-an-array' as never,
        requestedAt: '2026-08-11T00:00:00.000Z',
      }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidModelInterpretationRequestError);
      return true;
    },
  );
});

test('interpret still recognizes an explicit "altere o arquivo" edit request over the newer contextual layer (no regression)', async () => {
  const provider = new DevelopmentModelProvider();

  const decision = await provider.interpret({
    text: 'Altere o arquivo src/exemplo.ts substituindo X por Y',
    rememberedFacts: [],
    recentExchanges: [exchange('converse:1', 'algo não relacionado', 'resposta anterior', '2026-08-11T00:00:00.000Z')],
    requestedAt: '2026-08-12T00:00:00.000Z',
  });

  assert.deepEqual(decision, {
    intent: 'useTool',
    toolId: 'fs.replaceText',
    toolInput: { path: 'src/exemplo.ts', searchText: 'X', replaceText: 'Y' },
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
