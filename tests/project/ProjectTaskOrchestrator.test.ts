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
  const orchestrator = new ProjectTaskOrchestrator(registry, store, executor, 'test');
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

test('uma frase ambígua isolada ("homologado" sozinho, sem menção a fechar) não autoriza fechamento', async () => {
  const { entries, orchestrator } = fixture({ neuroClose: { enabled: true } });
  const neuro = entries[0]!;
  await orchestrator.handle('c1', activeOf(neuro), 'Sebastian, corrija o botão de login', 'e1', NOW);
  const reply = await orchestrator.handle('c1', activeOf(neuro), 'isso está homologado e funcionando bem', 'e2', NOW);
  const task = orchestrator.currentTask('c1')!;
  assert.equal(task.status, 'awaitingHomologation', 'sem menção explícita a fechar, a tarefa deve continuar aguardando homologação');
  assert.match(task.requestText, /Ajuste solicitado agora pelo usuário/, 'deve ter sido tratado como continuação, não como fechamento');
  void reply;
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
