import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveContextualIntent } from '../../core/project/ProjectTaskContextualIntent.js';
import type {
  CognitiveClassificationRequest,
  CognitiveClassificationResult,
  CognitiveDecisionRequest,
  CognitiveDecisionResult,
  CognitiveModelProvider,
} from '../../core/cognition/index.js';

class FakeProvider implements CognitiveModelProvider {
  public readonly calls: CognitiveClassificationRequest[] = [];
  public nextResult: CognitiveClassificationResult = { outcome: 'classified', category: 'ambiguous', reasoningSummary: 'x', confidence: 0.9 };
  public delayMs = 0;

  public async decide(_r: CognitiveDecisionRequest): Promise<CognitiveDecisionResult> {
    throw new Error('must not be called');
  }

  public async classify(request: CognitiveClassificationRequest): Promise<CognitiveClassificationResult> {
    this.calls.push(request);
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return this.nextResult;
  }
}

const BASE_CONTEXT = {
  text: 'e no celular?',
  projectDisplayName: 'Neuro Hub Pro',
  relatedTask: { status: 'completed', requestText: 'diagnostica o grafico do BDEFS', summary: 'O corte acontece por overflow no card.' },
  hasCloseEligibleTask: false,
  requestedAt: '2026-09-12T00:00:00.000Z',
};

test('sem tarefa relacionada, nunca vale a pena chamar o provider - resolve para ordinary sem gastar nada', async () => {
  const provider = new FakeProvider();
  const { relatedTask: _relatedTask, ...withoutRelatedTask } = BASE_CONTEXT;
  const result = await resolveContextualIntent(provider, withoutRelatedTask);
  assert.equal(result, 'ordinary');
  assert.equal(provider.calls.length, 0);
});

test('sem provider configurado, nunca eleva permissão - resolve para ambiguous', async () => {
  const result = await resolveContextualIntent(undefined, BASE_CONTEXT);
  assert.equal(result, 'ambiguous');
});

test('provider sem método classify implementado, nunca eleva permissão', async () => {
  const provider: CognitiveModelProvider = { async decide() { throw new Error('must not be called'); } };
  const result = await resolveContextualIntent(provider, BASE_CONTEXT);
  assert.equal(result, 'ambiguous');
});

test('classificação limpa repassa a categoria', async () => {
  const provider = new FakeProvider();
  provider.nextResult = { outcome: 'classified', category: 'write', reasoningSummary: 'x', confidence: 0.9 };
  assert.equal(await resolveContextualIntent(provider, BASE_CONTEXT), 'write');
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0]!.taskStatus, 'completed');
});

test('closeAll classificado é rejeitado (vira ambiguous) quando não há tarefa elegível para fechar', async () => {
  const provider = new FakeProvider();
  provider.nextResult = { outcome: 'classified', category: 'closeAll', reasoningSummary: 'x', confidence: 0.9 };
  const result = await resolveContextualIntent(provider, { ...BASE_CONTEXT, hasCloseEligibleTask: false });
  assert.equal(result, 'ambiguous');
});

test('closeAll classificado é aceito quando o chamador já confirma tarefa elegível', async () => {
  const provider = new FakeProvider();
  provider.nextResult = { outcome: 'classified', category: 'closeAll', reasoningSummary: 'x', confidence: 0.9 };
  const result = await resolveContextualIntent(provider, { ...BASE_CONTEXT, hasCloseEligibleTask: true });
  assert.equal(result, 'closeAll');
});

test('outcome unavailable do provider nunca eleva permissão', async () => {
  const provider = new FakeProvider();
  provider.nextResult = { outcome: 'unavailable', reason: 'fora do ar' };
  assert.equal(await resolveContextualIntent(provider, BASE_CONTEXT), 'ambiguous');
});

test('outcome timeout relatado pelo próprio provider nunca eleva permissão', async () => {
  const provider = new FakeProvider();
  provider.nextResult = { outcome: 'timeout' };
  assert.equal(await resolveContextualIntent(provider, BASE_CONTEXT), 'ambiguous');
});

test('outcome invalidResponse nunca eleva permissão', async () => {
  const provider = new FakeProvider();
  provider.nextResult = { outcome: 'invalidResponse', reason: 'schema' };
  assert.equal(await resolveContextualIntent(provider, BASE_CONTEXT), 'ambiguous');
});

test('provider que rejeita a Promise (erro inesperado) nunca eleva permissão', async () => {
  const provider: CognitiveModelProvider = {
    async decide() { throw new Error('must not be called'); },
    async classify() { throw new Error('falha de rede simulada'); },
  };
  assert.equal(await resolveContextualIntent(provider, BASE_CONTEXT), 'ambiguous');
});

test('provider que nunca resolve é limitado pelo teto de tempo próprio (defesa em profundidade), nunca eleva permissão', async () => {
  const provider = new FakeProvider();
  provider.delayMs = 5_000;
  const start = Date.now();
  const result = await resolveContextualIntent(provider, BASE_CONTEXT, 50);
  const elapsedMs = Date.now() - start;
  assert.equal(result, 'ambiguous');
  assert.ok(elapsedMs < 1_000, `deveria ter sido limitado por volta de 50ms, levou ${elapsedMs}ms`);
});
