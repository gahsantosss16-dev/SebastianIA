import { resolve } from 'node:path';
import { runGitCommand } from '../tool/LocalGitCommandRunner.js';
import { runProjectValidations, type ProjectValidationOutcome } from './ProjectValidationRunner.js';
import type { ProjectDescriptor } from './ProjectTypes.js';

export interface GitCloseRequest {
  readonly project: ProjectDescriptor;
  readonly workspaceRoot: string;
  readonly taskFilesChanged: readonly string[];
  readonly commitMessage: string;
  /** Present only when a prior close attempt already committed but failed to push - see `outcome: 'committedPendingPush'`. */
  readonly existingCommitHash?: string;
  readonly executionId: string;
  readonly requestedAt: string;
}

export type GitCloseOutcome = 'closed' | 'committedPendingPush' | 'refused' | 'failed';

export interface GitCloseResult {
  readonly outcome: GitCloseOutcome;
  readonly message: string;
  readonly filesIncluded: readonly string[];
  readonly filesExcluded: readonly string[];
  readonly migrationFiles: readonly string[];
  readonly validations: readonly ProjectValidationOutcome[];
  readonly commitHash?: string;
  readonly pushed: boolean;
  readonly tagName?: string;
  readonly tagPushed: boolean;
  readonly headMatchesRemote: boolean;
}

function refused(message: string, partial: Partial<GitCloseResult> = {}): GitCloseResult {
  return {
    outcome: 'refused',
    message,
    filesIncluded: [],
    filesExcluded: [],
    migrationFiles: [],
    validations: [],
    pushed: false,
    tagPushed: false,
    headMatchesRemote: false,
    ...partial,
  };
}

function failed(message: string, partial: Partial<GitCloseResult> = {}): GitCloseResult {
  return { ...refused(message, partial), outcome: 'failed' };
}

function samePath(a: string, b: string): boolean {
  const normalize = (value: string): string => resolve(value).replace(/[\\/]+$/, '');
  const left = normalize(a);
  const right = normalize(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function repositorySlug(remoteUrl: string): string {
  const withoutTrailingSlash = remoteUrl.trim().replace(/[\\/]+$/, '');
  const lastSegment = withoutTrailingSlash.split(/[\\/]/).pop() ?? '';
  return lastSegment.replace(/\.git$/i, '').toLowerCase();
}

/**
 * The whitelist Git closure boundary Etapa 3 adds. Every subcommand this
 * class can run is a dedicated method below, called with an explicit
 * argument array via `runGitCommand` (shell:false, never shell text) -
 * there is no generic "run this git command" escape hatch, so `reset`,
 * `clean`, `checkout -- <path>`, `rebase`, `branch`, `push --force` and
 * `tag -d` are not refused at runtime, they simply do not exist as
 * capabilities here. Never given to the code executor (`ProjectTaskExecutor`)
 * and never grants shell access - the model never sees this class at all,
 * only `ProjectTaskOrchestrator` calls it, deterministically, after its own
 * ANALISA/FAZ intent classification recognizes an explicit close request.
 */
export class GitCloseOrchestrator {
  public close(request: GitCloseRequest): GitCloseResult {
    const { project, workspaceRoot: root } = request;
    const workspace = project.workspace;
    if (!workspace) return failed('Projeto sem checkout configurado.');
    const closePolicy = workspace.close;
    if (!closePolicy?.enabled) {
      return refused(`Fechamento (commit/push/tag) não está habilitado para o projeto ${project.displayName} nesta configuração.`);
    }

    const toplevel = runGitCommand(root, ['rev-parse', '--show-toplevel']);
    if (!toplevel.ranAsGitRepo) {
      return refused('A raiz configurada não é um repositório Git válido; nenhuma alteração de Git foi feita.');
    }
    if (!samePath(toplevel.stdout.trim(), root)) {
      return refused(
        `A raiz do repositório Git (${toplevel.stdout.trim()}) diverge da raiz autorizada do projeto (${root}). Fechamento abortado antes de tocar em Git.`,
      );
    }

    const remoteName = closePolicy.remoteName ?? 'origin';
    const allowedBranch = closePolicy.allowedBranch ?? project.remoteRepository.defaultBranch;

    const branch = runGitCommand(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (!branch.ranAsGitRepo || branch.stdout.trim() !== allowedBranch) {
      return refused(
        `Branch atual (${branch.stdout.trim() || 'desconhecida'}) diverge da branch autorizada (${allowedBranch}) para este projeto. Fechamento abortado.`,
      );
    }

    const remoteUrl = runGitCommand(root, ['remote', 'get-url', remoteName]);
    if (!remoteUrl.ranAsGitRepo) {
      return refused(`Remote "${remoteName}" não está configurado neste checkout. Fechamento abortado.`);
    }
    if (repositorySlug(remoteUrl.stdout) !== project.remoteRepository.repository.toLowerCase()) {
      return refused(
        `Remote "${remoteName}" (${remoteUrl.stdout.trim()}) não corresponde ao repositório configurado (${project.remoteRepository.repository}). Fechamento abortado para evitar publicar no destino errado.`,
      );
    }

    if (request.existingCommitHash) {
      return this.resumeFromCommit(request, root, remoteName, allowedBranch, closePolicy.tagging ?? 'disabled');
    }

    // `--untracked-files=all` is required: without it, git collapses a
    // brand-new, entirely untracked directory into a single `?? dir/` line
    // instead of listing the files inside it, which would break the
    // file-by-file intersection against `taskFilesChanged` below.
    const status = runGitCommand(root, ['status', '--porcelain', '--untracked-files=all']);
    if (!status.ranAsGitRepo) {
      return refused('Não foi possível ler o estado do Git neste checkout. Fechamento abortado.');
    }
    const currentlyChanged = parseChangedFiles(status.stdout);
    const knownTaskFiles = new Set(request.taskFilesChanged);
    const filesIncluded = currentlyChanged.filter((file) => knownTaskFiles.has(file));
    const filesExcluded = currentlyChanged.filter((file) => !knownTaskFiles.has(file));

    if (filesIncluded.length === 0) {
      return refused(
        'Não há alterações pendentes desta tarefa para fechar (nada em comum entre o que a tarefa alterou e o estado atual do Git). Nada foi commitado.',
        { filesExcluded },
      );
    }

    const migrationPrefixes = workspace.migrations?.paths ?? [];
    const migrationFiles = filesIncluded.filter((file) => migrationPrefixes.some((prefix) => file.startsWith(prefix)));
    if (migrationFiles.length > 0) {
      return refused(
        `A tarefa alterou arquivo(s) de migration (${migrationFiles.join(', ')}). Este projeto não tem um executor administrativo autorizado para aplicar migrations automaticamente - o fechamento foi interrompido antes de qualquer commit/push/tag. Aplique/revise a migration manualmente e depois peça o fechamento novamente.`,
        { filesIncluded, filesExcluded, migrationFiles },
      );
    }

    const validations = runProjectValidations(project, root, request.executionId, request.requestedAt);
    const failedValidation = validations.find((entry) => !entry.succeeded);
    if (failedValidation) {
      return refused(
        `Validação "${failedValidation.toolId}" falhou: ${failedValidation.message}. Commit não foi criado.`,
        { filesIncluded, filesExcluded, validations },
      );
    }

    const add = runGitCommand(root, ['add', '--', ...filesIncluded]);
    if (!add.ranAsGitRepo) {
      return failed('Falha ao preparar (git add) os arquivos da tarefa. Nenhum commit foi criado.', { filesIncluded, filesExcluded, validations });
    }

    const staged = runGitCommand(root, ['diff', '--cached', '--name-only']);
    const stagedFiles = staged.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
    const stagedSet = new Set(stagedFiles);
    const includedSet = new Set(filesIncluded);
    const stagingMatchesExactly =
      stagedFiles.length === filesIncluded.length && filesIncluded.every((file) => stagedSet.has(file)) && stagedFiles.every((file) => includedSet.has(file));
    if (!stagingMatchesExactly) {
      // Deliberately does not attempt to un-stage anything here: `reset` is
      // outside this class's whitelist entirely (see the class docstring),
      // even in its non-destructive `reset HEAD -- <path>` form. The commit
      // is simply never created; the index is left exactly as `git add` put
      // it, for the operator to inspect with a plain `git status`.
      return failed(
        `O staging do Git não corresponde exatamente aos arquivos da tarefa após "git add" (staged: ${stagedFiles.join(', ') || 'nenhum'}). Por segurança, o commit não foi criado. Revise o índice do Git manualmente ("git status") antes de tentar novamente.`,
        { filesIncluded, filesExcluded, validations },
      );
    }

    const commit = runGitCommand(root, ['commit', '-m', request.commitMessage]);
    if (!commit.ranAsGitRepo) {
      return failed('Falha ao criar o commit. Nenhuma alteração foi enviada ao remote.', { filesIncluded, filesExcluded, validations });
    }
    const headAfterCommit = runGitCommand(root, ['rev-parse', 'HEAD']);
    const commitHash = headAfterCommit.stdout.trim();

    return this.pushAndTag(root, remoteName, allowedBranch, commitHash, closePolicy.tagging ?? 'disabled', project, {
      filesIncluded,
      filesExcluded,
      migrationFiles: [],
      validations,
    });
  }

  private resumeFromCommit(
    request: GitCloseRequest,
    root: string,
    remoteName: string,
    allowedBranch: string,
    tagging: 'auto' | 'disabled',
  ): GitCloseResult {
    const head = runGitCommand(root, ['rev-parse', 'HEAD']);
    const currentHead = head.stdout.trim();
    if (!head.ranAsGitRepo || currentHead !== request.existingCommitHash) {
      return refused(
        `O HEAD local (${currentHead || 'desconhecido'}) não corresponde mais ao commit pendente de push (${request.existingCommitHash}). O checkout mudou desde a última tentativa; revise manualmente antes de tentar novamente.`,
      );
    }
    return this.pushAndTag(root, remoteName, allowedBranch, currentHead, tagging, request.project, {
      filesIncluded: request.taskFilesChanged,
      filesExcluded: [],
      migrationFiles: [],
      validations: [],
    });
  }

  private pushAndTag(
    root: string,
    remoteName: string,
    allowedBranch: string,
    commitHash: string,
    tagging: 'auto' | 'disabled',
    project: ProjectDescriptor,
    base: Pick<GitCloseResult, 'filesIncluded' | 'filesExcluded' | 'migrationFiles' | 'validations'>,
  ): GitCloseResult {
    const push = runGitCommand(root, ['push', remoteName, `HEAD:${allowedBranch}`]);
    if (!push.ranAsGitRepo) {
      return {
        outcome: 'committedPendingPush',
        message: `Commit local criado (${commitHash}), mas o push para ${remoteName}/${allowedBranch} falhou: ${push.stderr.trim() || 'motivo desconhecido'}. Nada foi perdido - peça o fechamento novamente para tentar apenas o push.`,
        ...base,
        commitHash,
        pushed: false,
        tagPushed: false,
        headMatchesRemote: false,
      };
    }

    const remoteHead = runGitCommand(root, ['ls-remote', remoteName, `refs/heads/${allowedBranch}`]);
    const remoteCommit = remoteHead.stdout.split(/\s+/)[0]?.trim();
    const headMatchesRemote = remoteHead.ranAsGitRepo && remoteCommit === commitHash;

    let tagName: string | undefined;
    let tagPushed = false;
    let tagNote = '';
    if (tagging === 'auto') {
      const date = new Date().toISOString().slice(0, 10);
      const candidate = `${project.id}-homologado-${date}`;
      const existingTag = runGitCommand(root, ['tag', '-l', candidate]);
      if (existingTag.ranAsGitRepo && existingTag.stdout.trim() === candidate) {
        tagNote = ` A tag "${candidate}" já existe e não foi sobrescrita.`;
      } else {
        const createTag = runGitCommand(root, ['tag', '-a', candidate, '-m', `Fechamento automático: ${project.displayName}`, commitHash]);
        if (createTag.ranAsGitRepo) {
          const pushTag = runGitCommand(root, ['push', remoteName, candidate]);
          tagName = candidate;
          tagPushed = pushTag.ranAsGitRepo;
          tagNote = pushTag.ranAsGitRepo ? ` Tag "${candidate}" criada e publicada.` : ` Tag "${candidate}" criada localmente, mas o push da tag falhou.`;
        } else {
          tagNote = ` Falha ao criar a tag "${candidate}".`;
        }
      }
    }

    return {
      outcome: 'closed',
      message: `Fechamento concluído: commit ${commitHash} enviado para ${remoteName}/${allowedBranch}.${tagNote}`,
      ...base,
      commitHash,
      pushed: true,
      tagPushed,
      headMatchesRemote,
      ...(tagName === undefined ? {} : { tagName }),
    };
  }
}

/**
 * Same fixed-width-column caveat as `ProjectTaskOrchestrator`'s copy of this
 * function: the first status column can legitimately be a space (e.g. an
 * intent-to-add file - see `ProjectTaskOrchestrator.gitDiff` - shows as
 * " A path"), so the raw line is never trimmed before slicing off the
 * 3-column prefix, only the extracted path is.
 */
function parseChangedFiles(porcelainOutput: string): readonly string[] {
  return porcelainOutput
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.slice(3).trim());
}
