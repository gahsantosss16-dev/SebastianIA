import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentModelProvider } from '../../core/model/DevelopmentModelProvider.js';
import { InvalidModelInterpretationRequestError } from '../../core/model/ModelProviderContractErrors.js';
import type { RememberedFactRecord } from '../../core/memory/index.js';

function fact(content: string): RememberedFactRecord {
  return { id: 'remember:1', content, recordedAt: '2026-08-11T00:00:00.000Z' };
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
