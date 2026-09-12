import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ProjectRegistry } from '../../core/project/ProjectRegistry.js';
import { ProjectTaskOrchestrator } from '../../core/project/ProjectTaskOrchestrator.js';
import { FileMemoryStore } from '../../core/memory/FileMemoryStore.js';
import type { ProjectDescriptor } from '../../core/project/ProjectTypes.js';
import type {
  ProjectTaskExecutionRequest,
  ProjectTaskExecutionResult,
  ProjectTaskExecutor,
} from '../../core/project/ProjectTaskExecutor.js';
import type { ActiveProject } from '../../core/project/ProjectConversationContext.js';
import type {
  CognitiveClassificationRequest,
  CognitiveClassificationResult,
  CognitiveDecisionRequest,
  CognitiveDecisionResult,
  CognitiveModelProvider,
} from '../../core/cognition/index.js';

/**
 * Etapa 4: a controllable `CognitiveModelProvider` that only ever implements
 * `classify` - `decide` is present only because the interface requires it,
 * and every test asserts it is never actually invoked by this orchestrator
 * (the contextual layer never uses the operational decision loop). Never
 * makes a real network/model call.
 */
class FakeCognitiveModelProvider implements CognitiveModelProvider {
  public readonly classifyCalls: CognitiveClassificationRequest[] = [];
  public nextResult: CognitiveClassificationResult = {
    outcome: 'classified',
    category: 'ambiguous',
    reasoningSummary: 'fake',
    confidence: 0.9,
  };
  public delayMs = 0;

  public async decide(_request: CognitiveDecisionRequest): Promise<CognitiveDecisionResult> {
    throw new Error('FakeCognitiveModelProvider.decide must never be called by ProjectTaskOrchestrator.');
  }

  public async classify(request: CognitiveClassificationRequest): Promise<CognitiveClassificationResult> {
    this.classifyCalls.push(request);
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return this.nextResult;
  }
}

const GENERIC_MESSAGES = [
  'Não consegui concluir essa consulta agora; tente novamente em instantes.',
  'A conexão caiu antes da resposta. Verifique sua conexão e tente novamente.',
];

class FakeExecutor implements ProjectTaskExecutor {
  public readonly calls: ProjectTaskExecutionRequest[] = [];
  public nextResult: ProjectTaskExecutionResult = { outcome: 'completed', summary: 'Resumo do executor.' };
  public writeOnAuthorizedCall = true;

  public async execute(request: ProjectTaskExecutionRequest): Promise<ProjectTaskExecutionResult> {
    this.calls.push(request);
    if (request.authorization === 'writeAuthorized' && this.writeOnAuthorizedCall) {
      writeFileSync(join(request.workspaceRoot, `changed-${this.calls.length}.txt`), `edit ${this.calls.length}`);
    }
    return this.nextResult;
  }
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).toString();
}

function initGitRepoWithRemote(checkout: string, remote: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: checkout });
  git(checkout, ['config', 'user.email', 'test@example.com']);
  git(checkout, ['config', 'user.name', 'Test']);
  git(checkout, ['add', '-A']);
  git(checkout, ['commit', '-q', '-m', 'initial']);
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', remote]);
  git(checkout, ['remote', 'add', 'origin', remote]);
  git(checkout, ['push', '-q', '-u', 'origin', 'main']);
}

function commitCount(dir: string): number {
  return execFileSync('git', ['log', '--oneline'], { cwd: dir }).toString().trim().split('\n').length;
}

interface FixtureOptions {
  readonly neuroLocalWrite?: boolean;
  readonly neuroValidations?: readonly { readonly id: string; readonly executable: string; readonly args: readonly string[] }[];
  readonly neuroClose?: { readonly enabled: boolean; readonly tagging?: 'auto' | 'disabled' };
  readonly neuroMigrationPaths?: readonly string[];
  readonly cognitiveModelProvider?: CognitiveModelProvider;
}

function fixture(options: FixtureOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-tasks-'));
  const specs = [
    { id: 'neuro-hub-pro', displayName: 'Neuro Hub Pro', aliases: ['Neuro'], localWrite: options.neuroLocalWrite ?? true },
    { id: 'lsb-service', displayName: 'LSB Service', aliases: ['LSB'], localWrite: false },
  ];
  const remotesByProjectId = new Map<string, string>();
  const entries: ProjectDescriptor[] = specs.map((spec) => {
    const checkout = join(root, spec.id);
    const remote = join(root, `${spec.id}-remote.git`);
    mkdirSync(checkout);
    writeFileSync(join(checkout, 'CLAUDE.md'), `# ${spec.id}`);
    writeFileSync(join(checkout, 'AGENTS.md'), `# ${spec.id} agents`);
    initGitRepoWithRemote(checkout, remote);
    remotesByProjectId.set(spec.id, remote);
    return {
      id: spec.id,
      displayName: spec.displayName,
      aliases: spec.aliases,
      resourceKind: 'github-repository',
      remoteRepository: { owner: 'test', repository: `${spec.id}-remote`, defaultBranch: 'main' },
      permissions: { access: 'read-only' },
      workspace: {
        root: checkout,
        environment: { id: 'test', platform: process.platform as 'win32', label: 'Teste' },
        policySources: [
          { path: 'CLAUDE.md', required: true, topics: [] },
          { path: 'AGENTS.md', required: true, topics: [] },
        ],
        validations: spec.id === 'neuro-hub-pro' ? options.neuroValidations ?? [] : [],
        localWrite: { enabled: spec.localWrite },
        ...(spec.id === 'neuro-hub-pro' && options.neuroClose ? { close: { enabled: options.neuroClose.enabled, tagging: options.neuroClose.tagging ?? 'disabled' } } : {}),
        ...(spec.id === 'neuro-hub-pro' && options.neuroMigrationPaths ? { migrations: { paths: options.neuroMigrationPaths } } : {}),
      },
    };
  });
  const registry = new ProjectRegistry({ readOnly: true, entries });
  const memoryFile = join(root, 'memory.json');
  const store = new FileMemoryStore(memoryFile);
  const executor = new FakeExecutor();
  const orchestrator = new ProjectTaskOrchestrator(registry, store, executor, 'test', undefined, options.cognitiveModelProvider);
  return { root, memoryFile, entries, registry, store, executor, orchestrator, remotesByProjectId };
}

function activeOf(entry: ProjectDescriptor, policyStatus: 'loaded' | 'unavailable' = 'loaded'): ActiveProject {
  return { id: entry.id, displayName: entry.displayName, environment: entry.workspace!.environment.label, policyStatus };
}

const NOW = '2026-09-12T00:00:00.000Z';

test('ANALISA never writes: executor gets readOnly and the checkout stays clean', async () => {
  const { entries, executor, orchestrator } = fixture();
  const neuro = entries[0]!;
  const reply = await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, analisa o estado do projeto', 'e1', NOW);
  assert.equal(executor.calls.length, 1);
  assert.equal(executor.calls[0]!.authorization, 'readOnly');
  assert.match(reply!.message, /somente leitura/i);
  assert.match(reply!.message, /nenhum arquivo foi alterado/i);
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: neuro.workspace!.root }).toString();
  assert.equal(status.trim(), '');
});

test('FAZ only writes in the project it was authorized for; a project without localWrite refuses', async () => {
  const { entries, executor, orchestrator } = fixture();
  const [neuro, lsb] = entries;
  const writeReply = await orchestrator.handle('c1', activeOf(neuro!), 'Sebastian, corrija o texto do botão', 'e1', NOW);
  assert.equal(executor.calls.length, 1);
  assert.equal(executor.calls[0]!.authorization, 'writeAuthorized');
  assert.equal(executor.calls[0]!.workspaceRoot, neuro!.workspace!.root);
  assert.match(writeReply!.message, /arquivo/i);

  const refusedReply = await orchestrator.handle('c2', activeOf(lsb!), 'Sebastian, corrija o texto do botão', 'e2', NOW);
  assert.equal(executor.calls.length, 1, 'executor must not be invoked for a project without localWrite enabled');
  assert.match(refusedReply!.message, /não está habilitada/i);
});

test('an inaccessible/removed checkout is refused, never substituted, and the executor is never invoked', async () => {
  const { entries, executor, root, store } = fixture();
  const neuro = entries[0]!;
  const brokenEntries = [
    { ...neuro, workspace: { ...neuro.workspace!, root: join(root, 'does-not-exist') } },
    entries[1]!,
  ];
  const brokenRegistry = new ProjectRegistry({ readOnly: true, entries: brokenEntries });
  const brokenOrchestrator = new ProjectTaskOrchestrator(brokenRegistry, store, executor, 'test');
  const reply = await brokenOrchestrator.handle('c3', activeOf(neuro), 'Sebastian, corrija o botão', 'e1', NOW);
  assert.equal(executor.calls.length, 0);
  assert.match(reply!.message, /ausente ou indisponível/i);
});

test('no active project or unknown project id: orchestrator never runs, executor never called', async () => {
  const { executor, orchestrator } = fixture();
  assert.equal(await orchestrator.handle('c1', null, 'Sebastian, corrija o botão', 'e1', NOW), undefined);
  const fakeActive: ActiveProject = { id: 'not-registered', displayName: 'X', environment: 'Teste', policyStatus: 'loaded' };
  assert.equal(await orchestrator.handle('c1', fakeActive, 'Sebastian, corrija o botão', 'e1', NOW), undefined);
  assert.equal(executor.calls.length, 0);
});

test('executor unavailability is reported clearly, never as a generic connection message', async () => {
  const { entries, executor, orchestrator } = fixture();
  const neuro = entries[0]!;
  executor.nextResult = { outcome: 'failed', summary: 'Executor indisponível: não foi possível iniciar o Claude Code CLI (ENOENT).' };
  const reply = await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão', 'e1', NOW);
  assert.match(reply!.message, /indisponível/i);
  for (const generic of GENERIC_MESSAGES) {
    assert.notEqual(reply!.message, generic);
  }
});

test('failure outcome text is specific per outcome kind, never the generic fallback text', async () => {
  const { entries, executor, orchestrator } = fixture();
  const neuro = entries[0]!;
  executor.nextResult = { outcome: 'timedOut', summary: 'Tempo limite de 300000ms atingido.' };
  const reply = await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão', 'e1', NOW);
  assert.match(reply!.message, /tempo limite/i);
  for (const generic of GENERIC_MESSAGES) {
    assert.notEqual(reply!.message, generic);
  }
});

test('conversation isolation: two conversations on different projects never share task state', async () => {
  const { entries, orchestrator } = fixture();
  const [neuro, lsbForRead] = entries;
  await orchestrator.handle('conv-neuro', activeOf(neuro!), 'Sebastian, corrija o botão', 'e1', NOW);
  await orchestrator.handle('conv-lsb', activeOf(lsbForRead!), 'Sebastian, analisa o estado', 'e2', NOW);
  const neuroTask = orchestrator.currentTask('conv-neuro');
  const lsbTask = orchestrator.currentTask('conv-lsb');
  assert.equal(neuroTask?.projectId, 'neuro-hub-pro');
  assert.equal(lsbTask?.projectId, 'lsb-service');
  assert.notEqual(neuroTask?.taskId, lsbTask?.taskId);
});

test('a follow-up message continues the same task/project without repeating the request, and never creates a commit', async () => {
  const { entries, orchestrator } = fixture();
  const neuro = entries[0]!;
  const first = await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão de login', 'e1', NOW);
  const firstTask = orchestrator.currentTask('c1')!;
  assert.equal(firstTask.status, 'awaitingHomologation');
  assert.match(first!.message, /aguardando sua homologação/i);

  const second = await orchestrator.handle('c1', activeOf(neuro), 'ficou muito pequeno, aumenta um pouco', 'e2', NOW);
  const secondTask = orchestrator.currentTask('c1')!;
  assert.equal(secondTask.taskId, firstTask.taskId, 'continuation must keep the same task identity');
  assert.equal(secondTask.projectId, 'neuro-hub-pro');
  assert.match(secondTask.requestText, /Ajuste solicitado agora pelo usuário: ficou muito pequeno, aumenta um pouco/);
  assert.match(second!.message, /arquivo/i);

  assert.equal(commitCount(neuro.workspace!.root), 1, 'the executor/orchestrator must never create a git commit');
});

test('a completed write task reports files changed, a diff excerpt and validation results', async () => {
  const validations = [
    { id: 'validation.ok', executable: process.execPath, args: ['-e', 'process.exit(0)'] },
  ];
  const { entries, orchestrator } = fixture({ neuroValidations: validations });
  const neuro = entries[0]!;
  const reply = await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão', 'e1', NOW);
  const task = orchestrator.currentTask('c1')!;
  assert.equal(task.filesChanged.length, 1);
  assert.equal(task.validations.length, 1);
  assert.equal(task.validations[0]!.succeeded, true);
  assert.match(reply!.message, /Diff:/);
  assert.match(reply!.message, /Validações:/);
});

test('reopening with a new orchestrator instance over the same store preserves the task', async () => {
  const { entries, orchestrator, registry, store, executor } = fixture();
  const neuro = entries[0]!;
  await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão', 'e1', NOW);
  const before = orchestrator.currentTask('c1')!;

  const reopened = new ProjectTaskOrchestrator(registry, store, executor, 'test');
  const after = reopened.currentTask('c1');
  assert.equal(after?.taskId, before.taskId);
  assert.equal(after?.status, before.status);
  assert.equal(after?.projectId, before.projectId);
});

test('FECHA TUDO sem tarefa aguardando homologação é recusado, sem tocar em Git', async () => {
  const { entries, orchestrator } = fixture({ neuroClose: { enabled: true } });
  const neuro = entries[0]!;
  const reply = await orchestrator.handle('c1', activeOf(neuro), 'fecha tudo', 'e1', NOW);
  assert.match(reply!.message, /não há tarefa aguardando homologação/i);
  assert.equal(commitCount(neuro.workspace!.root), 1);
});

test('FECHA TUDO ("fecha tudo") nunca é engolido pela continuação de uma tarefa awaitingHomologation', async () => {
  const { entries, orchestrator } = fixture({ neuroClose: { enabled: true } });
  const neuro = entries[0]!;
  await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão de login', 'e1', NOW);
  const afterFaz = orchestrator.currentTask('c1')!;
  assert.equal(afterFaz.status, 'awaitingHomologation');

  const closeReply = await orchestrator.handle('c1', activeOf(neuro), 'fecha tudo', 'e2', NOW);
  assert.doesNotMatch(closeReply!.message, /Ajuste solicitado agora pelo usuário/, 'não pode ser tratado como uma edição de continuação');
  const afterClose = orchestrator.currentTask('c1')!;
  assert.equal(afterClose.status, 'closed');
  assert.ok(afterClose.commitHash);
});

test('variações de frase autorizam o fechamento: "pode fechar" e "homologado, fecha"', async () => {
  for (const phrase of ['pode fechar', 'homologado, fecha']) {
    const { entries, orchestrator } = fixture({ neuroClose: { enabled: true } });
    const neuro = entries[0]!;
    await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão de login', 'e1', NOW);
    const closeReply = await orchestrator.handle('c1', activeOf(neuro), phrase, 'e2', NOW);
    const task = orchestrator.currentTask('c1')!;
    assert.equal(task.status, 'closed', `frase "${phrase}" deveria autorizar o fechamento`);
    assert.match(closeReply!.message, /Push: confirmado/);
  }
});

test('feedback isolado ("homologado" sozinho, sem menção a fechar) registra homologação mas nunca autoriza fechamento (Etapa 4)', async () => {
  const { entries, orchestrator } = fixture({ neuroClose: { enabled: true } });
  const neuro = entries[0]!;
  const before = await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão de login', 'e1', NOW);
  const beforeTask = orchestrator.currentTask('c1')!;
  const reply = await orchestrator.handle('c1', activeOf(neuro), 'isso está homologado e funcionando bem', 'e2', NOW);
  const task = orchestrator.currentTask('c1')!;
  assert.equal(task.status, 'awaitingHomologation', 'feedback isolado, sem menção a fechar, nunca dispara commit/push/tag');
  assert.equal(task.commitHash, undefined);
  assert.ok(task.homologatedAt, 'o feedback de aprovação deve ficar registrado');
  assert.equal(task.taskId, beforeTask.taskId, 'permanece a mesma tarefa, nunca vira uma edição nova');
  assert.match(reply!.message, /registrei/i);
  void before;
});

test('fechamento correto após homologação: FAZ real -> awaitingHomologation -> "fecha tudo" real gera commit e push reais', async () => {
  const { entries, orchestrator, remotesByProjectId } = fixture({ neuroClose: { enabled: true, tagging: 'auto' } });
  const neuro = entries[0]!;
  const remote = remotesByProjectId.get('neuro-hub-pro')!;

  const fazReply = await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão de login', 'e1', NOW);
  assert.match(fazReply!.message, /aguardando sua homologação/i);

  const closeReply = await orchestrator.handle('c1', activeOf(neuro), 'fecha tudo', 'e2', NOW);
  const task = orchestrator.currentTask('c1')!;
  assert.equal(task.status, 'closed');
  assert.match(closeReply!.message, /Push: confirmado/);
  assert.match(closeReply!.message, /Tag: neuro-hub-pro-homologado-.*publicada/);

  const localHead = git(neuro.workspace!.root, ['rev-parse', 'HEAD']).trim();
  const remoteHead = git(remote, ['rev-parse', 'HEAD']).trim();
  assert.equal(localHead, remoteHead);
  assert.equal(localHead, task.commitHash);
});

// --- Etapa 4: conversa natural, intenção contextual e continuidade de tarefa ---

test('(1) "vê o que está acontecendo" é reconhecido como ANALISA, determinístico, sem chamar o classificador semântico', async () => {
  const fake = new FakeCognitiveModelProvider();
  const { entries, executor, orchestrator } = fixture({ cognitiveModelProvider: fake });
  const neuro = entries[0]!;
  const reply = await orchestrator.handle('c1', activeOf(neuro), 'Esse gráfico do BDEFS está cortando a classificação no celular, vê o que está acontecendo.', 'e1', NOW);
  assert.equal(executor.calls.length, 1);
  assert.equal(executor.calls[0]!.authorization, 'readOnly');
  assert.equal(fake.classifyCalls.length, 0, 'um verbo determinístico não deve gastar chamada semântica');
  assert.match(reply!.message, /somente leitura/i);
});

test('(2) após um diagnóstico concluído, "então corrige" abre FAZ usando o diagnóstico anterior como contexto', async () => {
  const { entries, executor, orchestrator } = fixture();
  const neuro = entries[0]!;
  await orchestrator.handle('c1', activeOf(neuro), 'vê o que está acontecendo nesse gráfico do BDEFS', 'e1', NOW);
  const analyzed = orchestrator.currentTask('c1')!;
  assert.equal(analyzed.status, 'completed', 'uma ANALISA bem-sucedida termina completed, não fica em OPEN_STATUSES');

  const reply = await orchestrator.handle('c1', activeOf(neuro), 'então corrige', 'e2', NOW);
  assert.equal(executor.calls.length, 2);
  assert.equal(executor.calls[1]!.authorization, 'writeAuthorized');
  assert.match(executor.calls[1]!.instructions, /Tarefa anterior:.*BDEFS/s);
  assert.match(executor.calls[1]!.instructions, /Ajuste solicitado agora pelo usuário: então corrige/);
  const task = orchestrator.currentTask('c1')!;
  assert.notEqual(task.taskId, analyzed.taskId, 'é uma tarefa nova, não uma continuação por status');
  assert.match(reply!.message, /arquivo/i);
});

test('(3) "e no celular?" sem verbo-gatilho usa o classificador contextual e mantém o assunto, sem inventar uma tarefa nova desconectada', async () => {
  const fake = new FakeCognitiveModelProvider();
  fake.nextResult = { outcome: 'classified', category: 'write', reasoningSummary: 'continuação do mesmo bug', confidence: 0.85 };
  const { entries, executor, orchestrator } = fixture({ cognitiveModelProvider: fake });
  const neuro = entries[0]!;
  await orchestrator.handle('c1', activeOf(neuro), 'vê o que está acontecendo nesse gráfico do BDEFS', 'e1', NOW);

  const reply = await orchestrator.handle('c1', activeOf(neuro), 'e no celular?', 'e2', NOW);
  assert.equal(fake.classifyCalls.length, 1);
  assert.equal(fake.classifyCalls[0]!.text, 'e no celular?');
  assert.match(fake.classifyCalls[0]!.taskRequestSummary ?? '', /BDEFS/);
  assert.equal(executor.calls.length, 2);
  assert.equal(executor.calls[1]!.authorization, 'writeAuthorized');
  assert.match(executor.calls[1]!.instructions, /Tarefa anterior:.*BDEFS/s);
  void reply;
});

test('(4) "corrige isso também" continua o assunto certo (determinístico + contexto anterior)', async () => {
  const { entries, executor, orchestrator } = fixture();
  const neuro = entries[0]!;
  await orchestrator.handle('c1', activeOf(neuro), 'vê o que está acontecendo nesse gráfico do BDEFS', 'e1', NOW);
  await orchestrator.handle('c1', activeOf(neuro), 'corrige isso também', 'e2', NOW);
  assert.equal(executor.calls.length, 2);
  assert.match(executor.calls[1]!.instructions, /BDEFS/);
});

test('(6) "ficou bom, pode fechar" homologa e fecha na mesma mensagem', async () => {
  const { entries, orchestrator } = fixture({ neuroClose: { enabled: true } });
  const neuro = entries[0]!;
  await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão de login', 'e1', NOW);
  const reply = await orchestrator.handle('c1', activeOf(neuro), 'ficou bom, pode fechar', 'e2', NOW);
  const task = orchestrator.currentTask('c1')!;
  assert.equal(task.status, 'closed');
  assert.ok(task.homologatedAt, 'a homologação também deve ter sido registrada');
  assert.match(reply!.message, /Push: confirmado/);
});

test('(8) uma correção pedida depois de "ficou bom" invalida a homologação anterior; fechar exige nova homologação/rodada', async () => {
  const { entries, orchestrator } = fixture({ neuroClose: { enabled: true } });
  const neuro = entries[0]!;
  await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão de login', 'e1', NOW);
  await orchestrator.handle('c1', activeOf(neuro), 'ficou bom', 'e2', NOW);
  const homologated = orchestrator.currentTask('c1')!;
  assert.ok(homologated.homologatedAt);

  await orchestrator.handle('c1', activeOf(neuro), 'pera, aumenta um pouco o espaçamento', 'e3', NOW);
  const afterChange = orchestrator.currentTask('c1')!;
  assert.equal(afterChange.status, 'awaitingHomologation');
  assert.equal(afterChange.homologatedAt, undefined, 'a homologação anterior não pode sobreviver a uma nova alteração');

  const closeReply = await orchestrator.handle('c1', activeOf(neuro), 'fecha tudo', 'e4', NOW);
  assert.equal(orchestrator.currentTask('c1')!.status, 'closed');
  void closeReply;
});

test('(9) "fecha" sem nenhuma tarefa aberta não toca em Git', async () => {
  const { entries, orchestrator } = fixture({ neuroClose: { enabled: true } });
  const neuro = entries[0]!;
  // Sem tarefa nenhuma, "fecha" nem chega a ser reconhecido como intenção de
  // fechamento (a confirmação curta só conta com hasCloseEligibleTask) - a
  // mensagem cai para o resto do pipeline conversacional comum.
  const reply = await orchestrator.handle('c1', activeOf(neuro), 'fecha', 'e1', NOW);
  assert.equal(reply, undefined);
  assert.equal(commitCount(neuro.workspace!.root), 1);
});

test('(9b) "fecha" sozinho, sem o estado atual ter sido homologado, é RECUSADO explicitamente (nunca vira edição, nunca fecha)', async () => {
  const { entries, executor, orchestrator } = fixture({ neuroClose: { enabled: true } });
  const neuro = entries[0]!;
  await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão de login', 'e1', NOW);
  const callsBefore = executor.calls.length;
  const reply = await orchestrator.handle('c1', activeOf(neuro), 'fecha', 'e2', NOW);
  assert.equal(orchestrator.currentTask('c1')!.status, 'awaitingHomologation', 'sem homologação do estado atual, "fecha" nunca fecha');
  assert.equal(executor.calls.length, callsBefore, '"fecha" recusado nunca deve virar mais uma instrução de edição');
  assert.match(reply!.message, /ainda não foi homologado/i);
  assert.equal(commitCount(neuro.workspace!.root), 1);
});

test('(9c) "fecha" funciona normalmente depois que o estado atual foi de fato homologado ("ficou bom" antes)', async () => {
  const { entries, orchestrator } = fixture({ neuroClose: { enabled: true } });
  const neuro = entries[0]!;
  await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão de login', 'e1', NOW);
  await orchestrator.handle('c1', activeOf(neuro), 'ficou bom', 'e2', NOW);
  const reply = await orchestrator.handle('c1', activeOf(neuro), 'fecha', 'e3', NOW);
  assert.equal(orchestrator.currentTask('c1')!.status, 'closed');
  assert.match(reply!.message, /Push: confirmado/);
});

test('(bug reportado) fluxo completo: homologa -> edita (invalida) -> "fecha" é RECUSADO -> re-homologa -> "fecha" agora funciona', async () => {
  const { entries, executor, orchestrator } = fixture({ neuroClose: { enabled: true } });
  const neuro = entries[0]!;

  // 1. "ficou bom" -> registra homologação da versão atual.
  await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão de login', 'e1', NOW);
  await orchestrator.handle('c1', activeOf(neuro), 'ficou bom', 'e2', NOW);
  assert.ok(orchestrator.currentTask('c1')!.homologatedAt);

  // 2. "pera, muda mais uma coisa" -> FAZ, novo estado, homologação anterior invalidada.
  const editCallsBefore = executor.calls.length;
  await orchestrator.handle('c1', activeOf(neuro), 'pera, muda mais uma coisa', 'e3', NOW);
  const afterEdit = orchestrator.currentTask('c1')!;
  assert.equal(afterEdit.status, 'awaitingHomologation');
  assert.equal(afterEdit.homologatedAt, undefined, 'a homologação anterior nunca pode sobreviver a uma nova edição');
  assert.equal(executor.calls.length, editCallsBefore + 1);

  // 3. "fecha" -> DEVE RECUSAR o fechamento: o estado atual ainda não foi homologado.
  const closeCallsBefore = executor.calls.length;
  const refused = await orchestrator.handle('c1', activeOf(neuro), 'fecha', 'e4', NOW);
  assert.equal(orchestrator.currentTask('c1')!.status, 'awaitingHomologation');
  assert.equal(orchestrator.currentTask('c1')!.commitHash, undefined, 'nenhum commit pode ter sido criado');
  assert.equal(executor.calls.length, closeCallsBefore, 'a recusa nunca deve acionar o executor');
  assert.match(refused!.message, /ainda não foi homologado/i);
  assert.equal(commitCount(neuro.workspace!.root), 1, 'nenhum commit real deve existir ainda');

  // 4. "agora sim, ficou bom" -> registra nova homologação, agora do estado atual.
  const reHomologated = await orchestrator.handle('c1', activeOf(neuro), 'agora sim, ficou bom', 'e5', NOW);
  assert.ok(orchestrator.currentTask('c1')!.homologatedAt);
  assert.match(reHomologated!.message, /registrei/i);

  // 5. "fecha" -> agora sim executa FECHA TUDO.
  const closed = await orchestrator.handle('c1', activeOf(neuro), 'fecha', 'e6', NOW);
  assert.equal(orchestrator.currentTask('c1')!.status, 'closed');
  assert.match(closed!.message, /Push: confirmado/);
  assert.equal(commitCount(neuro.workspace!.root), 2, 'exatamente um commit real, criado só na etapa 5');
});

test('(10) "fecha o modal" nunca é interpretado como FECHA TUDO Git, mesmo com tarefa aguardando homologação', async () => {
  const { entries, executor, orchestrator } = fixture({ neuroClose: { enabled: true } });
  const neuro = entries[0]!;
  await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão de login', 'e1', NOW);
  const callsBefore = executor.calls.length;
  await orchestrator.handle('c1', activeOf(neuro), 'fecha o modal que fica aberto', 'e2', NOW);
  const task = orchestrator.currentTask('c1')!;
  assert.notEqual(task.status, 'closed', '"fecha o modal" nunca deve disparar o fechamento Git');
  assert.equal(task.commitHash, undefined);
  assert.equal(executor.calls.length, callsBefore + 1, 'deve ter sido tratado como mais uma instrução de edição, não Git');
  assert.equal(commitCount(neuro.workspace!.root), 1);
});

test('(11) trocar de projeto na mesma conversa nunca herda o contexto/tarefa do projeto anterior', async () => {
  const fake = new FakeCognitiveModelProvider();
  const { entries, orchestrator } = fixture({ cognitiveModelProvider: fake });
  const [neuro, lsb] = entries;
  await orchestrator.handle('c1', activeOf(neuro!), 'vê o que está acontecendo nesse gráfico do BDEFS', 'e1', NOW);
  assert.equal(orchestrator.currentTask('c1')!.projectId, 'neuro-hub-pro');

  // Uma mensagem curta e elíptica no LSB nunca deve ver o resumo do Neuro.
  const reply = await orchestrator.handle('c1', activeOf(lsb!), 'e essa outra parte?', 'e2', NOW);
  assert.equal(reply, undefined, 'sem tarefa relacionada no LSB, cai para conversa comum, nunca herda o assunto do Neuro');
  assert.equal(fake.classifyCalls.length, 0, 'nunca vale a pena classificar sem nenhuma tarefa relacionada ao projeto ativo');
});

test('(12) uma referência ambígua classificada como tal nunca provoca escrita', async () => {
  const fake = new FakeCognitiveModelProvider();
  fake.nextResult = { outcome: 'classified', category: 'ambiguous', reasoningSummary: 'não está claro', confidence: 0.4 };
  const { entries, executor, orchestrator } = fixture({ cognitiveModelProvider: fake });
  const neuro = entries[0]!;
  await orchestrator.handle('c1', activeOf(neuro), 'vê o que está acontecendo nesse gráfico do BDEFS', 'e1', NOW);
  const callsBefore = executor.calls.length;
  const reply = await orchestrator.handle('c1', activeOf(neuro), 'e essa outra parte?', 'e2', NOW);
  assert.equal(executor.calls.length, callsBefore, 'ambíguo nunca aciona o executor');
  assert.match(reply!.message, /confirmar/i);
});

test('(13) falha do classificador semântico (unavailable) nunca eleva permissão', async () => {
  const fake = new FakeCognitiveModelProvider();
  fake.nextResult = { outcome: 'unavailable', reason: 'fora do ar' };
  const { entries, executor, orchestrator } = fixture({ cognitiveModelProvider: fake });
  const neuro = entries[0]!;
  await orchestrator.handle('c1', activeOf(neuro), 'vê o que está acontecendo nesse gráfico do BDEFS', 'e1', NOW);
  const callsBefore = executor.calls.length;
  const reply = await orchestrator.handle('c1', activeOf(neuro), 'e essa outra parte?', 'e2', NOW);
  assert.equal(executor.calls.length, callsBefore, 'falha do classificador nunca eleva para FAZ/FECHA');
  assert.match(reply!.message, /confirmar/i);
});

test('(14) timeout do classificador semântico nunca eleva permissão', async () => {
  const fake = new FakeCognitiveModelProvider();
  fake.nextResult = { outcome: 'timeout' };
  const { entries, executor, orchestrator } = fixture({ cognitiveModelProvider: fake });
  const neuro = entries[0]!;
  await orchestrator.handle('c1', activeOf(neuro), 'vê o que está acontecendo nesse gráfico do BDEFS', 'e1', NOW);
  const callsBefore = executor.calls.length;
  const reply = await orchestrator.handle('c1', activeOf(neuro), 'e essa outra parte?', 'e2', NOW);
  assert.equal(executor.calls.length, callsBefore, 'timeout do classificador nunca eleva para FAZ/FECHA');
  assert.match(reply!.message, /confirmar/i);
});

test('(15) uma frase determinística explícita nunca gasta uma chamada semântica, mesmo com provider configurado', async () => {
  const fake = new FakeCognitiveModelProvider();
  const { entries, executor, orchestrator } = fixture({ neuroClose: { enabled: true }, cognitiveModelProvider: fake });
  const neuro = entries[0]!;
  await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão de login', 'e1', NOW);
  await orchestrator.handle('c1', activeOf(neuro), 'ficou bom, pode fechar', 'e2', NOW);
  assert.equal(executor.calls.length, 1);
  assert.equal(orchestrator.currentTask('c1')!.status, 'closed');
  assert.equal(fake.classifyCalls.length, 0, 'todo o fluxo acima é resolvido deterministicamente, sem custo de modelo');
});

test('FECHA TUDO detecta migration entre os arquivos da tarefa e interrompe antes de qualquer commit', async () => {
  const { entries, registry, root } = fixture({ neuroClose: { enabled: true }, neuroMigrationPaths: ['migrations/'] });
  const neuro = entries[0]!;
  // Executor dedicado, que escreve diretamente dentro de migrations/ (o FakeExecutor padrão não simula isso).
  const migrationOrchestrator = new ProjectTaskOrchestrator(
    registry,
    new FileMemoryStore(join(root, 'memory-migration.json')),
    {
      async execute(request) {
        mkdirSync(join(request.workspaceRoot, 'migrations'), { recursive: true });
        writeFileSync(join(request.workspaceRoot, 'migrations', '0001_new_table.sql'), 'create table x();');
        return { outcome: 'completed', summary: 'Migration criada.' };
      },
    },
    'test',
  );
  await migrationOrchestrator.handle('c1', activeOf(neuro), 'Sebastian, cria uma tabela nova', 'e1', NOW);
  const afterFaz = migrationOrchestrator.currentTask('c1')!;
  assert.equal(afterFaz.status, 'awaitingHomologation');

  const closeReply = await migrationOrchestrator.handle('c1', activeOf(neuro), 'fecha tudo', 'e2', NOW);
  assert.match(closeReply!.message, /migration/i);
  const afterClose = migrationOrchestrator.currentTask('c1')!;
  assert.equal(afterClose.status, 'awaitingHomologation', 'migration detectada deve manter a tarefa aberta, sem avançar para closed');
  assert.equal(commitCount(neuro.workspace!.root), 1);
});
