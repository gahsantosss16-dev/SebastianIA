import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitCloseOrchestrator } from '../../core/project/GitCloseOrchestrator.js';
import type { ProjectDescriptor } from '../../core/project/ProjectTypes.js';

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).toString();
}

function initRepoWithRemote(root: string): { readonly checkout: string; readonly remote: string } {
  const checkout = join(root, 'checkout');
  const remote = join(root, 'remote.git');
  mkdirSync(checkout);
  git(checkout, ['init', '-q', '-b', 'main']);
  git(checkout, ['config', 'user.email', 'test@example.com']);
  git(checkout, ['config', 'user.name', 'Test']);
  writeFileSync(join(checkout, 'README.md'), '# repo\n');
  git(checkout, ['add', '-A']);
  git(checkout, ['commit', '-q', '-m', 'initial']);
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', remote]);
  git(checkout, ['remote', 'add', 'origin', remote]);
  git(checkout, ['push', '-q', '-u', 'origin', 'main']);
  return { checkout, remote };
}

interface ProjectOptions {
  readonly closeEnabled?: boolean;
  readonly tagging?: 'auto' | 'disabled';
  readonly migrationPaths?: readonly string[];
  readonly validations?: readonly { readonly id: string; readonly executable: string; readonly args: readonly string[] }[];
  readonly remoteName?: string;
}

function buildProject(checkout: string, options: ProjectOptions = {}): ProjectDescriptor {
  return {
    id: 'demo-project',
    displayName: 'Demo Project',
    aliases: ['Demo'],
    resourceKind: 'github-repository',
    remoteRepository: { owner: 'test-owner', repository: 'remote', defaultBranch: 'main' },
    permissions: { access: 'read-only' },
    workspace: {
      root: checkout,
      environment: { id: 'test', platform: process.platform as 'win32', label: 'Teste' },
      policySources: [{ path: 'CLAUDE.md', required: true, topics: [] }],
      validations: options.validations ?? [],
      localWrite: { enabled: true },
      close: { enabled: options.closeEnabled ?? true, remoteName: options.remoteName ?? 'origin', tagging: options.tagging ?? 'disabled' },
      migrations: { paths: options.migrationPaths ?? [] },
    },
  };
}

const NOW = '2026-09-12T00:00:00.000Z';

test('fechamento normal: commit real, push real e HEAD local == HEAD do remote', () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-close-'));
  const { checkout, remote } = initRepoWithRemote(root);
  writeFileSync(join(checkout, 'feature.txt'), 'novo conteudo');
  const project = buildProject(checkout);
  const orchestrator = new GitCloseOrchestrator();

  const result = orchestrator.close({
    project,
    workspaceRoot: checkout,
    taskFilesChanged: ['feature.txt'],
    commitMessage: 'Sebastian: adiciona feature.txt',
    executionId: 'e1',
    requestedAt: NOW,
  });

  assert.equal(result.outcome, 'closed');
  assert.equal(result.pushed, true);
  assert.ok(result.commitHash);
  assert.equal(result.headMatchesRemote, true);
  assert.deepEqual(result.filesIncluded, ['feature.txt']);

  const localHead = git(checkout, ['rev-parse', 'HEAD']).trim();
  const remoteHead = git(remote, ['rev-parse', 'HEAD']).trim();
  assert.equal(localHead, remoteHead);
  assert.equal(localHead, result.commitHash);
});

test('arquivo estranho no working tree fica fora do commit e é reportado, mas o commit da tarefa acontece', () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-close-'));
  const { checkout } = initRepoWithRemote(root);
  writeFileSync(join(checkout, 'feature.txt'), 'novo conteudo');
  writeFileSync(join(checkout, 'nao-relacionado.txt'), 'arquivo estranho');
  const project = buildProject(checkout);
  const orchestrator = new GitCloseOrchestrator();

  const result = orchestrator.close({
    project,
    workspaceRoot: checkout,
    taskFilesChanged: ['feature.txt'],
    commitMessage: 'Sebastian: adiciona feature.txt',
    executionId: 'e1',
    requestedAt: NOW,
  });

  assert.equal(result.outcome, 'closed');
  assert.deepEqual(result.filesIncluded, ['feature.txt']);
  assert.deepEqual(result.filesExcluded, ['nao-relacionado.txt']);
  const committedFiles = git(checkout, ['show', '--name-only', '--format=', 'HEAD']).trim().split(/\r?\n/);
  assert.deepEqual(committedFiles, ['feature.txt']);
  const status = git(checkout, ['status', '--porcelain']);
  assert.match(status, /nao-relacionado\.txt/);
});

test('quando nada do que mudou pertence à tarefa, o fechamento é recusado sem tocar em Git', () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-close-'));
  const { checkout } = initRepoWithRemote(root);
  writeFileSync(join(checkout, 'outro-arquivo.txt'), 'nada a ver com a tarefa');
  const project = buildProject(checkout);
  const orchestrator = new GitCloseOrchestrator();

  const result = orchestrator.close({
    project,
    workspaceRoot: checkout,
    taskFilesChanged: ['feature.txt'],
    commitMessage: 'Sebastian: adiciona feature.txt',
    executionId: 'e1',
    requestedAt: NOW,
  });

  assert.equal(result.outcome, 'refused');
  assert.match(result.message, /nada em comum|não há alterações pendentes/i);
  const commitCountAfter = git(checkout, ['log', '--oneline']).trim().split('\n').length;
  assert.equal(commitCountAfter, 1, 'nenhum commit novo deve ter sido criado');
});

test('validação obrigatória falhando impede o commit', () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-close-'));
  const { checkout } = initRepoWithRemote(root);
  writeFileSync(join(checkout, 'feature.txt'), 'novo conteudo');
  const failingValidation = { id: 'validation.fails', executable: process.execPath, args: ['-e', 'process.exit(1)'] };
  const project = buildProject(checkout, { validations: [failingValidation] });
  const orchestrator = new GitCloseOrchestrator();

  const result = orchestrator.close({
    project,
    workspaceRoot: checkout,
    taskFilesChanged: ['feature.txt'],
    commitMessage: 'Sebastian: adiciona feature.txt',
    executionId: 'e1',
    requestedAt: NOW,
  });

  assert.equal(result.outcome, 'refused');
  assert.match(result.message, /validation\.fails/);
  assert.equal(git(checkout, ['log', '--oneline']).trim().split('\n').length, 1);
});

test('migration presente interrompe o fechamento inteiro, sem commit/push/tag', () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-close-'));
  const { checkout } = initRepoWithRemote(root);
  mkdirSync(join(checkout, 'supabase', 'migrations'), { recursive: true });
  writeFileSync(join(checkout, 'supabase', 'migrations', '0001_init.sql'), 'create table x();');
  const project = buildProject(checkout, { migrationPaths: ['supabase/migrations/'] });
  const orchestrator = new GitCloseOrchestrator();

  const result = orchestrator.close({
    project,
    workspaceRoot: checkout,
    taskFilesChanged: ['supabase/migrations/0001_init.sql'],
    commitMessage: 'Sebastian: adiciona migration',
    executionId: 'e1',
    requestedAt: NOW,
  });

  assert.equal(result.outcome, 'refused');
  assert.deepEqual(result.migrationFiles, ['supabase/migrations/0001_init.sql']);
  assert.match(result.message, /migration/i);
  assert.equal(result.pushed, false);
  assert.equal(git(checkout, ['log', '--oneline']).trim().split('\n').length, 1);
});

test('push falhando: commit local é criado, status vira committedPendingPush, e uma nova tentativa só reenvia o push', () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-close-'));
  const { checkout } = initRepoWithRemote(root);
  writeFileSync(join(checkout, 'feature.txt'), 'novo conteudo');
  const project = buildProject(checkout);
  // Aponta o remote para um destino inexistente (mesmo nome, caminho quebrado) depois do checkout já
  // configurado, simulando falha de push sem disparar a checagem de "remote errado" (mesmo slug "remote").
  git(checkout, ['remote', 'set-url', 'origin', join(root, 'caminho-quebrado', 'remote.git')]);
  const orchestrator = new GitCloseOrchestrator();

  const result = orchestrator.close({
    project,
    workspaceRoot: checkout,
    taskFilesChanged: ['feature.txt'],
    commitMessage: 'Sebastian: adiciona feature.txt',
    executionId: 'e1',
    requestedAt: NOW,
  });

  assert.equal(result.outcome, 'committedPendingPush');
  assert.equal(result.pushed, false);
  assert.ok(result.commitHash);
  const localHead = git(checkout, ['rev-parse', 'HEAD']).trim();
  assert.equal(localHead, result.commitHash);

  // Corrige o remote e tenta de novo, agora só com o push pendente (sem recomitar).
  const { remote } = { remote: join(root, 'remote.git') };
  git(checkout, ['remote', 'set-url', 'origin', remote]);
  const retry = orchestrator.close({
    project,
    workspaceRoot: checkout,
    taskFilesChanged: ['feature.txt'],
    commitMessage: 'Sebastian: adiciona feature.txt',
    existingCommitHash: result.commitHash,
    executionId: 'e2',
    requestedAt: NOW,
  });
  assert.equal(retry.outcome, 'closed');
  assert.equal(retry.pushed, true);
  assert.equal(retry.commitHash, result.commitHash);
  assert.equal(git(checkout, ['log', '--oneline']).trim().split('\n').length, 2, 'ainda deve haver apenas um novo commit, não dois');
});

test('tag já existente nunca é sobrescrita', () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-close-'));
  const { checkout, remote } = initRepoWithRemote(root);
  const collidingTag = 'demo-project-homologado-' + new Date().toISOString().slice(0, 10);
  git(checkout, ['tag', '-a', collidingTag, '-m', 'tag pre-existente']);
  git(checkout, ['push', '-q', 'origin', collidingTag]);
  writeFileSync(join(checkout, 'feature.txt'), 'novo conteudo');
  const project = buildProject(checkout, { tagging: 'auto' });
  const orchestrator = new GitCloseOrchestrator();

  const result = orchestrator.close({
    project,
    workspaceRoot: checkout,
    taskFilesChanged: ['feature.txt'],
    commitMessage: 'Sebastian: adiciona feature.txt',
    executionId: 'e1',
    requestedAt: NOW,
  });

  assert.equal(result.outcome, 'closed');
  assert.match(result.message, /já existe/i);
  assert.equal(result.tagName, undefined, 'a tag pré-existente não deve ser reportada como criada por esta chamada');
  const tagCommit = git(checkout, ['rev-list', '-n', '1', collidingTag]).trim();
  assert.notEqual(tagCommit, result.commitHash, 'a tag pré-existente deve continuar apontando para o commit antigo, nunca sobrescrita');
  void remote;
});

test('GitCloseOrchestrator nunca passa --force/-f a nenhum comando de git, e não expõe reset/clean/rebase/checkout/branch como subcomandos', () => {
  // Verifica a forma como um argumento real apareceria (string entre aspas
  // dentro de um array passado a runGitCommand), não a prosa da documentação.
  const source = readFileSync(new URL('../../core/project/GitCloseOrchestrator.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /['"]--force['"]/);
  assert.doesNotMatch(source, /['"]-f['"]/);
  assert.doesNotMatch(source, /runGitCommand\([^)]*['"]reset['"]/s);
  assert.doesNotMatch(source, /runGitCommand\([^)]*['"]clean['"]/s);
  assert.doesNotMatch(source, /runGitCommand\([^)]*['"]rebase['"]/s);
  assert.doesNotMatch(source, /runGitCommand\([^)]*['"]checkout['"]/s);
  assert.doesNotMatch(source, /runGitCommand\([^)]*['"]branch['"]/s);
  assert.doesNotMatch(source, /runGitCommand\([^)]*['"]tag['"],\s*['"]-d['"]/s);
});

test('proteção contra force push: um push real que exigiria --force (histórico remoto divergente) simplesmente falha, nunca é forçado', () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-close-'));
  const { checkout, remote } = initRepoWithRemote(root);
  // Diverge o remote em relação ao checkout local, criando um commit direto nele.
  const otherClone = join(root, 'other-clone');
  execFileSync('git', ['clone', '-q', remote, otherClone]);
  git(otherClone, ['config', 'user.email', 'other@example.com']);
  git(otherClone, ['config', 'user.name', 'Other']);
  writeFileSync(join(otherClone, 'from-elsewhere.txt'), 'mudanca concorrente');
  git(otherClone, ['add', '-A']);
  git(otherClone, ['commit', '-q', '-m', 'mudanca concorrente']);
  git(otherClone, ['push', '-q', 'origin', 'main']);

  writeFileSync(join(checkout, 'feature.txt'), 'novo conteudo');
  const project = buildProject(checkout);
  const orchestrator = new GitCloseOrchestrator();
  const remoteHeadBefore = git(remote, ['rev-parse', 'HEAD']).trim();

  const result = orchestrator.close({
    project,
    workspaceRoot: checkout,
    taskFilesChanged: ['feature.txt'],
    commitMessage: 'Sebastian: adiciona feature.txt',
    executionId: 'e1',
    requestedAt: NOW,
  });

  assert.equal(result.outcome, 'committedPendingPush', 'sem --force, um push non-fast-forward deve falhar, não ser forçado');
  assert.equal(result.pushed, false);
  const remoteHeadAfter = git(remote, ['rev-parse', 'HEAD']).trim();
  assert.equal(remoteHeadAfter, remoteHeadBefore, 'o histórico remoto não pode ter sido sobrescrito');
});

test('raiz do workspace divergindo da raiz real do repositório Git é recusada antes de qualquer alteração', () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-close-'));
  const { checkout } = initRepoWithRemote(root);
  writeFileSync(join(checkout, 'feature.txt'), 'novo conteudo');
  mkdirSync(join(checkout, 'subpasta'));
  const project = buildProject(checkout);
  const orchestrator = new GitCloseOrchestrator();

  const result = orchestrator.close({
    project,
    workspaceRoot: join(checkout, 'subpasta'),
    taskFilesChanged: ['feature.txt'],
    commitMessage: 'Sebastian: adiciona feature.txt',
    executionId: 'e1',
    requestedAt: NOW,
  });

  assert.equal(result.outcome, 'refused');
  assert.match(result.message, /diverge/i);
  assert.equal(git(checkout, ['log', '--oneline']).trim().split('\n').length, 1);
});

test('remote configurado não correspondendo ao projeto é recusado', () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-close-'));
  const { checkout } = initRepoWithRemote(root);
  writeFileSync(join(checkout, 'feature.txt'), 'novo conteudo');
  const project = buildProject(checkout);
  git(checkout, ['remote', 'set-url', 'origin', join(root, 'outro-repositorio.git')]);
  const orchestrator = new GitCloseOrchestrator();

  const result = orchestrator.close({
    project,
    workspaceRoot: checkout,
    taskFilesChanged: ['feature.txt'],
    commitMessage: 'Sebastian: adiciona feature.txt',
    executionId: 'e1',
    requestedAt: NOW,
  });

  assert.equal(result.outcome, 'refused');
  assert.match(result.message, /não corresponde ao repositório configurado/i);
});

test('close.enabled ausente/false recusa o fechamento sem tocar em Git', () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-close-'));
  const { checkout } = initRepoWithRemote(root);
  writeFileSync(join(checkout, 'feature.txt'), 'novo conteudo');
  const project = buildProject(checkout, { closeEnabled: false });
  const orchestrator = new GitCloseOrchestrator();

  const result = orchestrator.close({
    project,
    workspaceRoot: checkout,
    taskFilesChanged: ['feature.txt'],
    commitMessage: 'Sebastian: adiciona feature.txt',
    executionId: 'e1',
    requestedAt: NOW,
  });

  assert.equal(result.outcome, 'refused');
  assert.match(result.message, /não está habilitado/i);
  assert.equal(git(checkout, ['status', '--porcelain']).trim(), '?? feature.txt');
});
