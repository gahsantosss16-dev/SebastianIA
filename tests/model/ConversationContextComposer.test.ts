import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationContextComposer } from '../../core/model/ConversationContextComposer.js';
import { InvalidModelInterpretationRequestError } from '../../core/model/ModelProviderContractErrors.js';
import type { RecentExchangeRecord, RememberedFactRecord } from '../../core/memory/index.js';

function fact(id: string, content: string, recordedAt: string): RememberedFactRecord {
  return { id, content, recordedAt };
}

function exchange(id: string, requestText: string, summary: string, recordedAt: string, kind = 'respond'): RecentExchangeRecord {
  return { id, requestText, summary, kind, recordedAt };
}

test('classifies a plain statement with no special reference as "plain"', () => {
  const composer = new ConversationContextComposer();

  const composed = composer.compose({ text: 'olá', rememberedFacts: [], recentExchanges: [] });

  assert.equal(composed.intent, 'plain');
});

test('classifies text containing "?" as a question', () => {
  const composer = new ConversationContextComposer();

  const composed = composer.compose({ text: 'Qual horário eu prefiro?', rememberedFacts: [], recentExchanges: [] });

  assert.equal(composed.intent, 'question');
});

test('classifies text starting with an interrogative word even without "?" as a question', () => {
  const composer = new ConversationContextComposer();

  const composed = composer.compose({ text: 'Onde fica o arquivo principal', rememberedFacts: [], recentExchanges: [] });

  assert.equal(composed.intent, 'question');
});

test('classifies a short generic continuation phrase ("então continua") as continuationReference', () => {
  const composer = new ConversationContextComposer();

  const composed = composer.compose({ text: 'Então continua', rememberedFacts: [], recentExchanges: [] });

  assert.equal(composed.intent, 'continuationReference');
});

test('classifies "e agora?", "como ficou aquilo?" and "onde paramos?" as continuationReference', () => {
  const composer = new ConversationContextComposer();

  for (const text of ['E agora?', 'Como ficou aquilo?', 'Onde paramos?']) {
    const composed = composer.compose({ text, rememberedFacts: [], recentExchanges: [] });
    assert.equal(composed.intent, 'continuationReference', `expected "${text}" to be continuationReference`);
  }
});

test('classifies "vamos continuar meu projeto de ontem" as resumptionReference, not continuationReference', () => {
  const composer = new ConversationContextComposer();

  const composed = composer.compose({
    text: 'Sebastian, vamos continuar meu projeto de ontem',
    rememberedFacts: [],
    recentExchanges: [],
  });

  assert.equal(composed.intent, 'resumptionReference');
});

test('classifies "continuar" naming a task (not a project) as resumptionReference too', () => {
  const composer = new ConversationContextComposer();

  const composed = composer.compose({ text: 'Vamos continuar aquela tarefa', rememberedFacts: [], recentExchanges: [] });

  assert.equal(composed.intent, 'resumptionReference');
});

test('selects the fact with the highest keyword overlap, not simply the most recent one', () => {
  const composer = new ConversationContextComposer();
  const facts = [
    fact('f1', 'gosto de café pela manhã', '2026-08-10T00:00:00.000Z'),
    fact('f2', 'o projeto Sebastian IA está na fase de memória inteligente', '2026-08-11T00:00:00.000Z'),
    fact('f3', 'prefiro reuniões à tarde', '2026-08-12T00:00:00.000Z'),
  ];

  const composed = composer.compose({
    text: 'Me fale sobre o projeto Sebastian IA',
    rememberedFacts: facts,
    recentExchanges: [],
  });

  assert.equal(composed.relevantMemories.length, 1);
  assert.equal(composed.relevantMemories[0]?.id, 'f2');
  assert.equal(composed.relevantMemories[0]?.source, 'fact');
});

test('caps relevant memory selection at 3 entries even when more overlap', () => {
  const composer = new ConversationContextComposer();
  const facts = [
    fact('f1', 'projeto alfa está em andamento', '2026-08-10T00:00:00.000Z'),
    fact('f2', 'projeto beta está em andamento', '2026-08-11T00:00:00.000Z'),
    fact('f3', 'projeto gama está em andamento', '2026-08-12T00:00:00.000Z'),
    fact('f4', 'projeto delta está em andamento', '2026-08-13T00:00:00.000Z'),
  ];

  const composed = composer.compose({ text: 'como está o projeto?', rememberedFacts: facts, recentExchanges: [] });

  assert.equal(composed.relevantMemories.length, 3);
});

test('returns no relevant memories when the query has no significant tokens in common with anything stored', () => {
  const composer = new ConversationContextComposer();
  const facts = [fact('f1', 'gosto de café', '2026-08-10T00:00:00.000Z')];

  const composed = composer.compose({ text: 'Onde fica o Brasil', rememberedFacts: facts, recentExchanges: [] });

  assert.deepEqual(composed.relevantMemories, []);
});

test('selects a relevant exchange alongside relevant facts, ranked by overlap score', () => {
  const composer = new ConversationContextComposer();
  const facts = [fact('f1', 'gosto de café', '2026-08-10T00:00:00.000Z')];
  const exchanges = [
    exchange('e1', 'como está o clima hoje', 'ensolarado', '2026-08-11T00:00:00.000Z'),
    exchange('e2', 'qual o status do projeto Sebastian IA', 'SPEC-044 homologada, próxima fase é memória', '2026-08-12T00:00:00.000Z'),
  ];

  const composed = composer.compose({
    text: 'Me atualize sobre o projeto Sebastian IA',
    rememberedFacts: facts,
    recentExchanges: exchanges,
  });

  assert.equal(composed.relevantMemories[0]?.id, 'e2');
  assert.equal(composed.relevantMemories[0]?.source, 'exchange');
});

test('exposes mostRecentFact and mostRecentExchange independent of relevance, ranked purely by recordedAt', () => {
  const composer = new ConversationContextComposer();
  const facts = [
    fact('f1', 'gosto de café', '2026-08-10T00:00:00.000Z'),
    fact('f2', 'prefiro reuniões à tarde', '2026-08-12T00:00:00.000Z'),
  ];
  const exchanges = [
    exchange('e1', 'oi', 'olá!', '2026-08-11T00:00:00.000Z'),
    exchange('e2', 'tchau', 'até mais!', '2026-08-13T00:00:00.000Z'),
  ];

  const composed = composer.compose({ text: 'assunto totalmente não relacionado', rememberedFacts: facts, recentExchanges: exchanges });

  assert.equal(composed.mostRecentFact?.id, 'f2');
  assert.equal(composed.mostRecentExchange?.id, 'e2');
});

test('omits mostRecentFact/mostRecentExchange when nothing is available', () => {
  const composer = new ConversationContextComposer();

  const composed = composer.compose({ text: 'olá', rememberedFacts: [], recentExchanges: [] });

  assert.equal(composed.mostRecentFact, undefined);
  assert.equal(composed.mostRecentExchange, undefined);
});

test('is deterministic for identical input', () => {
  const composer = new ConversationContextComposer();
  const input = {
    text: 'Sebastian, vamos continuar meu projeto de ontem',
    rememberedFacts: [fact('f1', 'o projeto usa TypeScript', '2026-08-10T00:00:00.000Z')],
    recentExchanges: [] as readonly RecentExchangeRecord[],
  };

  const left = composer.compose(input);
  const right = composer.compose(input);

  assert.deepEqual(left, right);
});

test('rejects an invalid input with a typed error', () => {
  const composer = new ConversationContextComposer();

  assert.throws(
    () => composer.compose(null as never),
    (error: unknown) => {
      assert.ok(error instanceof InvalidModelInterpretationRequestError);
      return true;
    },
  );

  assert.throws(
    () => composer.compose({ text: '   ', rememberedFacts: [], recentExchanges: [] }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidModelInterpretationRequestError);
      return true;
    },
  );

  assert.throws(
    () => composer.compose({ text: 'x', rememberedFacts: 'nope' as never, recentExchanges: [] }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidModelInterpretationRequestError);
      return true;
    },
  );

  assert.throws(
    () => composer.compose({ text: 'x', rememberedFacts: [], recentExchanges: 'nope' as never }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidModelInterpretationRequestError);
      return true;
    },
  );
});
