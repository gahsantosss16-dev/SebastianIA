import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemorySpecializedAgent, CONVERSE_COMMAND_TYPE } from '../../core/agent/index.js';
import { ProjectRegistry } from '../../core/project/ProjectRegistry.js';
import { ProjectConversationContext } from '../../core/project/ProjectConversationContext.js';
import { ProjectTaskOrchestrator } from '../../core/project/ProjectTaskOrchestrator.js';
import { FileMemoryStore } from '../../core/memory/FileMemoryStore.js';
import type { ProjectDescriptor } from '../../core/project/ProjectTypes.js';
import type { ModelInterpretationDecision, ModelProvider } from '../../core/model/ModelProviderContract.js';
import type { ProjectTaskExecutionRequest, ProjectTaskExecutionResult, ProjectTaskExecutor } from '../../core/project/ProjectTaskExecutor.js';

/**
 * Regression coverage for the product-behavior fix: a message that both
 * selects a project AND carries a real conversational request/task in the
 * SAME turn must select the project and keep processing the rest of the
 * message, instead of stopping at "Projeto identificado" as if that alone
 * answered the user. Before this fix, `InMemorySpecializedAgent` always
 * returned `ProjectConversationContext`'s own reply whenever it was defined,
 * regardless of whether the message had anything left to answer.
 */
function fixture(options: { executor?: ProjectTaskExecutor } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-agent-pipeline-'));
  const entries = (JSON.parse(readFileSync(new URL('../fixtures/projects.test.json', import.meta.url), 'utf8')) as { projects: ProjectDescriptor[] }).projects.map((project) => {
    const checkout = join(root, project.id);
    mkdirSync(checkout);
    writeFileSync(join(checkout, 'CLAUDE.md'), `# ${project.id}`);
    writeFileSync(join(checkout, 'AGENTS.md'), `# ${project.id} agents`);
    return {
      ...project,
      workspace: {
        ...project.workspace!,
        root: checkout,
        environment: { id: 'test', platform: process.platform as 'win32', label: 'Teste' },
        policySources: [{ path: 'CLAUDE.md', required: true, topics: [] }, { path: 'AGENTS.md', required: true, topics: [] }],
      },
    };
  });
  const registry = new ProjectRegistry({ readOnly: true, entries });
  const store = new FileMemoryStore(join(root, 'memory.json'));
  const projectContext = new ProjectConversationContext(registry, store, 'test');
  const noopExecutor: ProjectTaskExecutor = {
    execute: async (): Promise<ProjectTaskExecutionResult> => ({ outcome: 'completed', summary: 'não deveria ter sido chamado neste teste' }),
  };
  const executor = options.executor ?? noopExecutor;
  const projectTaskOrchestrator = new ProjectTaskOrchestrator(registry, new FileMemoryStore(join(root, 'tasks.json')), executor, 'test');
  return { projectContext, projectTaskOrchestrator };
}

function converseInput(text: string, conversationId = 'c1') {
  return {
    responsibilityId: 'capability.execute.converse',
    executionId: 'converse:2026-09-12T00:00:00.000Z',
    commandType: CONVERSE_COMMAND_TYPE,
    requestedAt: '2026-09-12T00:00:01.000Z',
    payload: { commandInput: { type: 'converse', input: { text }, conversation: { conversationId } } },
  } as const;
}

test('a bare project selection with nothing else in the message never reaches the conversational model', async () => {
  const { projectContext, projectTaskOrchestrator } = fixture();
  let interpretCalled = false;
  const modelProvider: ModelProvider = {
    interpret: async (): Promise<ModelInterpretationDecision> => {
      interpretCalled = true;
      return { intent: 'respond', answer: 'não deveria responder aqui', recordable: true };
    },
  };
  const agent = new InMemorySpecializedAgent(
    { invoke: () => ({ status: 'completed', output: { message: 'unused' } }) },
    modelProvider, undefined, undefined, undefined, undefined, undefined,
    projectContext, projectTaskOrchestrator,
  );

  const result = await agent.handoff(converseInput('vamos trabalhar no Neuro Hub Pro'));

  assert.equal(result.status, 'completed');
  assert.equal(interpretCalled, false, 'a bare selection must not fall through to the conversational model');
  if (result.status === 'completed') {
    assert.match((result.output.finalResult as { message: string }).message, /Projeto: Neuro Hub Pro/);
  }
});

test('a project selection combined with a real question in the same message selects the project AND answers the question in the same turn', async () => {
  const { projectContext, projectTaskOrchestrator } = fixture();
  let interpretedText: string | undefined;
  const modelProvider: ModelProvider = {
    interpret: async (request): Promise<ModelInterpretationDecision> => {
      interpretedText = request.text;
      return { intent: 'respond', answer: 'Posso analisar, alterar e fechar tarefas no projeto selecionado.', recordable: true };
    },
  };
  const agent = new InMemorySpecializedAgent(
    { invoke: () => ({ status: 'completed', output: { message: 'unused' } }) },
    modelProvider, undefined, undefined, undefined, undefined, undefined,
    projectContext, projectTaskOrchestrator,
  );

  const realFailingMessage =
    'Sebastian, vamos trabalhar no Neuro Hub Pro.\n' +
    'Quero que você veja como o projeto está hoje e me diga o que você consegue fazer por mim diretamente nele agora, na prática.\n' +
    'Não quero explicação de arquitetura, código interno, testes ou como você funciona por trás.\n' +
    'Quero funcionalidades: coisas que eu posso pedir aqui na conversa e você consegue realmente executar no Neuro para mim.';

  const result = await agent.handoff(converseInput(realFailingMessage));

  assert.equal(result.status, 'completed');
  assert.equal(interpretedText, realFailingMessage, 'the conversational model must have been consulted with the real message');
  assert.equal(projectContext.active('c1')?.id, 'neuro-hub-pro', 'the project must still have been selected as a side effect');
  if (result.status === 'completed') {
    const message = (result.output.finalResult as { message: string }).message;
    assert.doesNotMatch(message, /Não consegui concluir essa consulta agora/);
    assert.doesNotMatch(message, /ainda não está conectada/);
    assert.match(message, /Posso analisar, alterar e fechar tarefas/, 'the final answer must come from the conversational pipeline, not the project boilerplate');
  }
});

test('when the remainder after selection is itself a real ANALISA/FAZ request, the task orchestrator wins and the conversational model is never consulted', async () => {
  let executed = false;
  const executor: ProjectTaskExecutor = {
    execute: async (request: ProjectTaskExecutionRequest): Promise<ProjectTaskExecutionResult> => {
      executed = true;
      return { outcome: 'completed', summary: `analisei: ${request.instructions.slice(0, 20)}` };
    },
  };
  const { projectContext, projectTaskOrchestrator } = fixture({ executor });
  let interpretCalled = false;
  const modelProvider: ModelProvider = {
    interpret: async (): Promise<ModelInterpretationDecision> => {
      interpretCalled = true;
      return { intent: 'respond', answer: 'não deveria responder aqui', recordable: true };
    },
  };
  const agent = new InMemorySpecializedAgent(
    { invoke: () => ({ status: 'completed', output: { message: 'unused' } }) },
    modelProvider, undefined, undefined, undefined, undefined, undefined,
    projectContext, projectTaskOrchestrator,
  );

  const result = await agent.handoff(converseInput('Vamos pro LSB e verifica aquela lógica das OS.'));

  assert.equal(result.status, 'completed');
  assert.equal(executed, true, 'the task executor must have run the ANALISA request');
  assert.equal(interpretCalled, false, 'a recognized ANALISA/FAZ request must never also fall through to the conversational model');
  assert.equal(projectContext.active('c1')?.id, 'lsb-service');
});
