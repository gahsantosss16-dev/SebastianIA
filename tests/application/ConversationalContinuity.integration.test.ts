import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSebastianApplication } from '../../application/SebastianApplication.js';
import type { CognitiveDecision, CognitiveDecisionRequest, CognitiveModelProvider } from '../../core/cognition/index.js';
import type { Logger } from '../../core/logger.js';

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function input(text: string, second: number) {
  return { type: 'converse', input: { text }, generatedAt: `2026-08-28T16:00:${String(second).padStart(2, '0')}.000Z` };
}

function decision(overrides: Partial<CognitiveDecision> = {}): CognitiveDecision {
  return {
    intent: 'conclude' as const,
    goal: 'atender ao objetivo',
    reasoningSummary: 'Decisão operacional curta.',
    nextAction: 'concludeCompleted' as const,
    requiresAuthorization: false,
    expectedEvidence: 'Resposta ou evidência suficiente.',
    completionState: 'completed' as const,
    confidence: 0.95,
    finalAnswer: 'Resposta direta.',
    ...overrides,
  };
}

/** A stand-in for Gemini that answers as a real model plausibly would: it always has access to `relevantMemory` and uses it only when it actually helps. */
function contextAwareProvider(answerFor: (request: CognitiveDecisionRequest) => string): CognitiveModelProvider {
  return {
    decide: async (request) => ({ outcome: 'decided', decision: decision({ finalAnswer: answerFor(request) }) }),
  };
}

function memoryText(request: CognitiveDecisionRequest): string {
  return request.relevantMemory.map((item) => item.content).join('\n');
}

test('an elliptical follow-up ("vc pode me ajudar?") continues the immediately preceding topic instead of restarting the conversation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-continuity-elliptical-'));
  try {
    const provider = contextAwareProvider((request) => {
      if (request.objective.includes('criar um site')) {
        return 'Para criar um site, você pode usar HTML, CSS e um provedor de hospedagem. Posso ajudar em algo mais?';
      }
      if (memoryText(request).includes('criar um site')) {
        return 'Claro, posso te ajudar a continuar com a criação do seu site - quer que eu detalhe hospedagem ou o design?';
      }
      return 'Olá! Sou o SebastianIA, seu assistente pessoal. Como posso ser útil para você hoje?';
    });
    const app = createSebastianApplication({
      logger, dataDir: root, authorizedCommands: [],
      specializedTool: { invoke: () => ({ status: 'completed' as const, output: { message: 'unused' } }) },
      cognitiveModelProvider: provider,
      cognitiveOperationalTools: [{ toolId: 'git.status', description: 'status', requiresAuthorization: false, requiredStringArguments: [] }],
    });

    const first = await app.executeCommand(input('como eu faço pra criar um site?', 1));
    assert.match(String(first.output.message), /HTML, CSS/);

    const second = await app.executeCommand(input('vc pode me ajudar?', 2));
    assert.match(String(second.output.message), /continuar com a criação do seu site/);
    assert.doesNotMatch(String(second.output.message), /Sou o SebastianIA, seu assistente pessoal/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a bare "como?" after an explanation resolves its referent from the immediately preceding answer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-continuity-como-'));
  try {
    const provider = contextAwareProvider((request) => {
      if (memoryText(request).includes('backup automático')) {
        return 'Para configurar o backup automático, agende uma tarefa diária que exporte o banco de dados.';
      }
      return 'Você deveria configurar um backup automático do banco de dados todo dia.';
    });
    const app = createSebastianApplication({
      logger, dataDir: root, authorizedCommands: [],
      specializedTool: { invoke: () => ({ status: 'completed' as const, output: { message: 'unused' } }) },
      cognitiveModelProvider: provider,
      cognitiveOperationalTools: [{ toolId: 'git.status', description: 'status', requiresAuthorization: false, requiredStringArguments: [] }],
    });

    const first = await app.executeCommand(input('o que eu deveria fazer para proteger meus dados?', 1));
    assert.match(String(first.output.message), /backup automático/);

    const second = await app.executeCommand(input('como?', 2));
    assert.match(String(second.output.message), /agende uma tarefa diária/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an explicit change of subject is respected and never hijacked by the previous topic', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-continuity-topic-change-'));
  try {
    const provider = contextAwareProvider((request) => {
      if (request.objective.includes('criar um site')) return 'Para criar um site, comece definindo o público-alvo.';
      if (request.objective.toLowerCase().includes('frança')) return 'A capital da França é Paris.';
      return 'Não entendi.';
    });
    const app = createSebastianApplication({
      logger, dataDir: root, authorizedCommands: [],
      specializedTool: { invoke: () => ({ status: 'completed' as const, output: { message: 'unused' } }) },
      cognitiveModelProvider: provider,
      cognitiveOperationalTools: [{ toolId: 'git.status', description: 'status', requiresAuthorization: false, requiredStringArguments: [] }],
    });

    await app.executeCommand(input('como eu faço pra criar um site?', 1));
    const second = await app.executeCommand(input('qual é a capital da França?', 2));

    assert.equal(second.output.message, 'A capital da França é Paris.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returning to the earlier topic later recovers it correctly once the reference is clear again', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-continuity-return-'));
  try {
    const provider = contextAwareProvider((request) => {
      if (request.objective.includes('criar um site')) return 'Para criar um site, comece definindo o público-alvo.';
      if (request.objective.toLowerCase().includes('frança')) return 'A capital da França é Paris.';
      if (request.objective.toLowerCase().includes('site') && memoryText(request).includes('criar um site')) {
        return 'Voltando ao seu site: depois do público-alvo, escolha um domínio e um provedor de hospedagem.';
      }
      return 'Não entendi.';
    });
    const app = createSebastianApplication({
      logger, dataDir: root, authorizedCommands: [],
      specializedTool: { invoke: () => ({ status: 'completed' as const, output: { message: 'unused' } }) },
      cognitiveModelProvider: provider,
      cognitiveOperationalTools: [{ toolId: 'git.status', description: 'status', requiresAuthorization: false, requiredStringArguments: [] }],
    });

    await app.executeCommand(input('como eu faço pra criar um site?', 1));
    await app.executeCommand(input('qual é a capital da França?', 2));
    const third = await app.executeCommand(input('voltando naquele assunto do site, o que vem depois do público-alvo?', 3));

    assert.match(String(third.output.message), /domínio e um provedor de hospedagem/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a brand-new conversation with no relevant history behaves normally and never invents context', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-continuity-fresh-'));
  try {
    let sawAnyMemory = false;
    const provider: CognitiveModelProvider = {
      decide: async (request) => {
        sawAnyMemory = sawAnyMemory || request.relevantMemory.length > 0;
        return { outcome: 'decided', decision: decision({ finalAnswer: 'Olá! Sou o SebastianIA, seu assistente pessoal. Como posso ser útil para você hoje?' }) };
      },
    };
    const app = createSebastianApplication({
      logger, dataDir: root, authorizedCommands: [],
      specializedTool: { invoke: () => ({ status: 'completed' as const, output: { message: 'unused' } }) },
      cognitiveModelProvider: provider,
      cognitiveOperationalTools: [{ toolId: 'git.status', description: 'status', requiresAuthorization: false, requiredStringArguments: [] }],
    });

    const result = await app.executeCommand(input('vc pode me ajudar?', 1));

    assert.equal(sawAnyMemory, false, 'a first-ever message has nothing to continue, so no memory should be fabricated');
    assert.match(String(result.output.message), /Sou o SebastianIA/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
