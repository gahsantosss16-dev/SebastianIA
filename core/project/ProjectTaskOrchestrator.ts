import { randomUUID } from 'node:crypto';
import type { FileMemoryStore } from '../memory/FileMemoryStore.js';
import type { ProjectRegistry } from './ProjectRegistry.js';
import type { ProjectDescriptor } from './ProjectTypes.js';
import type { ActiveProject, ProjectReply } from './ProjectConversationContext.js';
import { resolveValidatedWorkspaceRoot } from './ProjectWorkspacePolicy.js';
import { classifyProjectTaskIntent, detectHomologationFeedback, isShortCloseConfirmation } from './ProjectTaskIntent.js';
import { resolveContextualIntent } from './ProjectTaskContextualIntent.js';
import type { ProjectTaskExecutor, ProjectTaskExecutionResult } from './ProjectTaskExecutor.js';
import type { GoalAuthorization } from '../development/GoalExecutionContract.js';
import type { CognitiveModelProvider } from '../cognition/index.js';
import { runGitCommand } from '../tool/LocalGitCommandRunner.js';
import { runProjectValidations, type ProjectValidationOutcome } from './ProjectValidationRunner.js';
import { GitCloseOrchestrator, type GitCloseResult } from './GitCloseOrchestrator.js';

/**
 * Free-standing messages returned by the contextual layer - kept as named
 * constants so tests can assert on them without hardcoding Portuguese prose
 * inline, and so the wording only lives in one place.
 */
const HOMOLOGATION_ACKNOWLEDGED_MESSAGE =
  'Entendido! Registrei que você aprovou o resultado. Quando quiser, é só pedir para eu fechar.';
const AMBIGUOUS_INTENT_MESSAGE =
  'Não tenho certeza se você quer que eu analise isso ou já aplique uma correção relacionada à tarefa. Pode confirmar?';
const CURRENT_STATE_NOT_HOMOLOGATED_MESSAGE =
  'O estado atual da tarefa ainda não foi homologado (houve uma alteração desde a última aprovação). Confirme que ficou bom antes de pedir para fechar, ou aprove e feche na mesma mensagem (ex.: "ficou bom, pode fechar").';
/** Below this many words, a message with no explicit verb is treated as elliptical (depends on the prior task's context) rather than a self-contained new request - see `looksElliptical`. */
const ELLIPTICAL_MESSAGE_MAX_WORDS = 8;

/**
 * Heuristic distinguishing "então corrige"/"e no celular?" (depends on the
 * prior task to mean anything) from "corrige o typo no README" (a
 * self-contained request that should never silently inherit an unrelated
 * task's context just because one happens to exist). Word count only - no
 * model call, no extra latency, and a false negative here just means a
 * self-contained-looking message does not get prior-task context it may
 * still not have needed.
 */
function looksElliptical(text: string): boolean {
  return text.trim().split(/\s+/).filter((word) => word !== '').length <= ELLIPTICAL_MESSAGE_MAX_WORDS;
}

const TASKS = 'project-tasks';
const MAX_DIFF_CHARS = 4_000;

export type ProjectTaskStatus =
  | 'analyzing'
  | 'writing'
  | 'awaitingHomologation'
  | 'completed'
  | 'failed'
  | 'committedPendingPush'
  | 'closed';

export type ProjectTaskValidationOutcome = ProjectValidationOutcome;

export interface ProjectTaskRecord {
  readonly conversationId: string;
  readonly taskId: string;
  readonly projectId: string;
  readonly requestText: string;
  readonly authorization: GoalAuthorization;
  readonly status: ProjectTaskStatus;
  readonly filesChanged: readonly string[];
  readonly validations: readonly ProjectTaskValidationOutcome[];
  readonly summary: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Set once a FECHA TUDO attempt creates a real commit (Etapa 3). */
  readonly commitHash?: string;
  /** Set once FECHA TUDO successfully creates and publishes a tag (Etapa 3). */
  readonly tagName?: string;
  /**
   * Etapa 4: set when natural positive feedback ("ficou bom") was recognized
   * while this task was `awaitingHomologation`. Purely informational/UX - it
   * never gates FECHA TUDO by itself (Etapa 3's close already never required
   * a prior homologation message) and it is never carried over into a new
   * record after a further edit, which is exactly what invalidates it
   * without any extra logic: every persisted record after a real edit is
   * built from scratch, never spread from the previous one.
   */
  readonly homologatedAt?: string;
}

/**
 * Statuses on which a follow-up message with no explicit new intent is
 * folded into the SAME task as a continuation edit (see `handle()`).
 * `committedPendingPush` is deliberately excluded: a message after a
 * partially-failed close is never silently reinterpreted as "keep editing" -
 * only an explicit close intent (handled before this set is even consulted)
 * or a fresh, explicitly classified task touches it.
 */
const OPEN_STATUSES: readonly ProjectTaskStatus[] = ['analyzing', 'writing', 'awaitingHomologation'];
const CLOSE_ELIGIBLE_STATUSES: readonly ProjectTaskStatus[] = ['awaitingHomologation', 'committedPendingPush'];

/**
 * The real-execution counterpart to `ProjectConversationContext`: where that
 * class only ever identifies a project and loads its rules, this class
 * decides ANALISA/FAZ/FECHA TUDO for a message. For ANALISA/FAZ it drives a
 * `ProjectTaskExecutor` against the project's already-validated root, then
 * reports real `git status`/`diff` and the project's own registered
 * validations. `ProjectTaskExecutor` (the Claude CLI, restricted, never
 * given Bash) never calls `git commit`/`push`/`tag` and has no request shape
 * that could ask it to (Etapa 2's boundary, unchanged) - FECHA TUDO
 * (Etapa 3) reaches Git through a completely separate, narrow path instead:
 * `GitCloseOrchestrator`, a closed whitelist of Git subcommands this class
 * calls directly, deterministically, only after its own intent
 * classification recognizes an explicit close request and only against a
 * task already sitting in `awaitingHomologation`/`committedPendingPush`.
 */
export class ProjectTaskOrchestrator {
  public constructor(
    private readonly registry: ProjectRegistry,
    private readonly store: FileMemoryStore,
    private readonly executor: ProjectTaskExecutor,
    private readonly environmentId: string,
    private readonly gitCloseOrchestrator: GitCloseOrchestrator = new GitCloseOrchestrator(),
    /**
     * Etapa 4, optional and retrocompatible: powers the contextual
     * classification layer only. Every deterministic behavior (Etapas 1-3)
     * is identical whether or not this is provided - its absence simply
     * means ambiguous/cross-status messages fall back to a confirmation
     * question instead of a model-assisted guess.
     */
    private readonly cognitiveModelProvider?: CognitiveModelProvider,
  ) {}

  public currentTask(conversationId: string): ProjectTaskRecord | undefined {
    return this.store.listRecords(TASKS).find((record) => record.conversationId === conversationId) as
      | ProjectTaskRecord
      | undefined;
  }

  public async handle(
    conversationId: string,
    activeProject: ActiveProject | null,
    text: string,
    executionId: string,
    requestedAt: string,
    signal?: AbortSignal,
  ): Promise<ProjectReply | undefined> {
    if (!activeProject) return undefined;
    const project = this.registry.getById(activeProject.id);
    if (!project) return undefined;

    const existing = this.currentTask(conversationId);
    const sameProjectExisting = existing?.projectId === project.id ? existing : undefined;

    // Etapa 4: natural positive feedback is recognized independently of (and
    // alongside) a close intent in the same message - "ficou bom, fecha"
    // both records homologation AND triggers the close below, in one turn.
    // Never authorizes anything by itself - see `ProjectTaskRecord.homologatedAt`.
    let existingAfterHomologation = sameProjectExisting;
    let homologatedJustNow = false;
    if (detectHomologationFeedback(text) && sameProjectExisting?.status === 'awaitingHomologation') {
      existingAfterHomologation = { ...sameProjectExisting, homologatedAt: requestedAt, updatedAt: requestedAt };
      this.persist(existingAfterHomologation);
      homologatedJustNow = true;
    }

    // Etapa 4 fix: a bare "fecha" must reflect approval of the CURRENT
    // state, never merely "some close-eligible status exists". A task
    // `committedPendingPush` already had its close explicitly authorized
    // earlier (the commit exists; this is only a push retry), so it stays
    // eligible on status alone. A task still `awaitingHomologation`,
    // though, is only eligible for the bare/short confirmation once
    // `homologatedAt` reflects THIS state - never a homologation left over
    // from a version that was since edited away (persisting a new edit
    // never carries the old `homologatedAt` forward - see the write path
    // below - so this can never go stale on its own).
    const hasCloseEligibleTask =
      existingAfterHomologation !== undefined &&
      (existingAfterHomologation.status === 'committedPendingPush' ||
        (existingAfterHomologation.status === 'awaitingHomologation' && existingAfterHomologation.homologatedAt !== undefined));

    // Intent is classified on every message BEFORE any continuation decision.
    // Without this, a task left `awaitingHomologation` would swallow the very
    // next message as "keep editing" and FECHA TUDO would never be reachable
    // through natural conversation - see GitCloseOrchestrator/handleClose.
    // `hasCloseEligibleTask` is what lets a bare "fecha"/"encerra" ever mean
    // Git at all - see SHORT_CLOSE_CONFIRMATION_PATTERN in ProjectTaskIntent.ts.
    // Explicit, self-contained phrases ("fecha tudo", "pode fechar") are
    // unaffected - they are their own authorization for whatever state
    // exists right now, exactly like Etapa 3 already tested.
    const deterministicIntent = classifyProjectTaskIntent(text, { hasCloseEligibleTask });
    if (deterministicIntent === 'closeAll') {
      return this.handleClose(project, activeProject, existingAfterHomologation, executionId, requestedAt);
    }

    // The message structurally looks like a bare close confirmation but was
    // not honored above only because the current state lacks homologation -
    // refuse explicitly. Never fall through silently into "continuing" below,
    // which would misread "fecha" as yet another edit instruction sent to
    // the executor.
    if (
      existingAfterHomologation?.status === 'awaitingHomologation' &&
      existingAfterHomologation.homologatedAt === undefined &&
      isShortCloseConfirmation(text)
    ) {
      return { project: activeProject, message: CURRENT_STATE_NOT_HOMOLOGATED_MESSAGE };
    }

    // A homologation-only message ("ficou bom" with no close intent
    // alongside) just acknowledges and stops here - the FAZ →
    // awaitingHomologation → FECHA TUDO separation from Etapa 3 is preserved.
    if (homologatedJustNow) {
      return { project: activeProject, message: HOMOLOGATION_ACKNOWLEDGED_MESSAGE };
    }

    const continuing = existingAfterHomologation !== undefined && OPEN_STATUSES.includes(existingAfterHomologation.status);

    let authorization: GoalAuthorization;
    let instructions: string;
    let taskId: string;
    let createdAt: string;

    if (continuing) {
      const openTask = existingAfterHomologation!;
      authorization = openTask.authorization;
      instructions = `Tarefa anterior: ${openTask.requestText}\nResultado anterior: ${openTask.summary}\nAjuste solicitado agora pelo usuário: ${text}`;
      taskId = openTask.taskId;
      createdAt = openTask.createdAt;
    } else {
      let effectiveIntent = deterministicIntent;
      // A short, elliptical message ("então corrige", "e no celular?") with a
      // related task from this project - even one no longer "open" by status
      // (e.g. a finished ANALISA) - offers that task's context to the new
      // one. A long, self-contained request never inherits unrelated history.
      const offerPriorTaskContext = sameProjectExisting !== undefined && looksElliptical(text);

      if (effectiveIntent === undefined && offerPriorTaskContext) {
        const resolved = await resolveContextualIntent(this.cognitiveModelProvider, {
          text,
          projectDisplayName: project.displayName,
          relatedTask: {
            status: sameProjectExisting!.status,
            requestText: sameProjectExisting!.requestText,
            summary: sameProjectExisting!.summary,
          },
          hasCloseEligibleTask,
          requestedAt,
          ...(signal === undefined ? {} : { signal }),
        });

        if (resolved === 'closeAll') {
          return this.handleClose(project, activeProject, existingAfterHomologation, executionId, requestedAt);
        }
        if (resolved === 'homologate') {
          if (sameProjectExisting!.status === 'awaitingHomologation') {
            this.persist({ ...sameProjectExisting!, homologatedAt: requestedAt, updatedAt: requestedAt });
            return { project: activeProject, message: HOMOLOGATION_ACKNOWLEDGED_MESSAGE };
          }
          return undefined;
        }
        if (resolved === 'ambiguous') {
          return { project: activeProject, message: AMBIGUOUS_INTENT_MESSAGE };
        }
        if (resolved === 'ordinary') {
          return undefined;
        }
        effectiveIntent = resolved;
      }

      if (effectiveIntent === undefined) return undefined;
      authorization = effectiveIntent === 'write' ? 'writeAuthorized' : 'readOnly';
      if (authorization === 'writeAuthorized' && project.workspace?.localWrite?.enabled !== true) {
        return {
          project: activeProject,
          message: `Escrita não está habilitada para o projeto ${project.displayName} nesta configuração. Posso analisar (somente leitura), mas não posso aplicar alterações aqui.`,
        };
      }
      instructions = offerPriorTaskContext
        ? `Tarefa anterior: ${sameProjectExisting!.requestText}\nResultado anterior: ${sameProjectExisting!.summary}\nAjuste solicitado agora pelo usuário: ${text}`
        : text;
      taskId = randomUUID();
      createdAt = requestedAt;
      if (existingAfterHomologation?.status === 'committedPendingPush') {
        instructions = `${instructions}\n\n(Aviso interno: havia um commit local (${existingAfterHomologation.commitHash ?? '?'}) ainda pendente de push de uma tarefa anterior; o rastreamento conversacional dessa tarefa foi substituído por esta nova, mas o commit pendente continua existindo localmente.)`;
      }
    }

    let root: string;
    try {
      root = resolveValidatedWorkspaceRoot(project, this.environmentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Checkout do projeto indisponível.';
      this.persist({
        conversationId, taskId, projectId: project.id, requestText: instructions, authorization,
        status: 'failed', filesChanged: [], validations: [], summary: message, createdAt, updatedAt: requestedAt,
      });
      return { project: activeProject, message };
    }

    this.persist({
      conversationId, taskId, projectId: project.id, requestText: instructions, authorization,
      status: authorization === 'writeAuthorized' ? 'writing' : 'analyzing',
      filesChanged: [], validations: [], summary: '', createdAt, updatedAt: requestedAt,
    });

    const result = await this.executor.execute({
      taskId, projectId: project.id, workspaceRoot: root, authorization, instructions, conversationId, executionId,
      ...(signal === undefined ? {} : { signal }),
    });

    if (result.outcome !== 'completed') {
      const message = this.describeExecutorFailure(result);
      this.persist({
        conversationId, taskId, projectId: project.id, requestText: instructions, authorization,
        status: 'failed', filesChanged: [], validations: [], summary: message, createdAt, updatedAt: requestedAt,
      });
      return { project: activeProject, message };
    }

    // `--untracked-files=all`: a FAZ task that creates a file inside a brand-new
    // directory must have that file, not just the directory, land in
    // `filesChanged` - GitCloseOrchestrator later intersects this list
    // file-by-file against a fresh status of its own.
    const status = runGitCommand(root, ['status', '--porcelain', '--untracked-files=all']);
    const filesChanged = status.ranAsGitRepo ? this.parseChangedFiles(status.stdout) : [];
    const diff = filesChanged.length > 0 ? this.gitDiff(root) : '';
    const validations = filesChanged.length > 0 ? runProjectValidations(project, root, executionId, requestedAt) : [];

    const finalStatus: ProjectTaskStatus =
      authorization === 'writeAuthorized' && filesChanged.length > 0 ? 'awaitingHomologation' : 'completed';
    this.persist({
      conversationId, taskId, projectId: project.id, requestText: instructions, authorization,
      status: finalStatus, filesChanged, validations, summary: result.summary, createdAt, updatedAt: requestedAt,
    });

    const message = this.composeReply(
      project.displayName, authorization, result.summary, filesChanged, diff, validations, finalStatus, status.ranAsGitRepo,
    );
    return { project: activeProject, message };
  }

  /**
   * `git status --porcelain`'s status columns are fixed-width and the first
   * one can legitimately be a space (e.g. an intent-to-add file shows as
   * " A path", not "A  path") - trimming the raw line before slicing off
   * the 3-column prefix would eat that leading space and shift every
   * character of the path left by one. Only the extracted path itself is
   * trimmed, never the raw line.
   */
  private parseChangedFiles(porcelainOutput: string): readonly string[] {
    return porcelainOutput
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => line.slice(3).trim());
  }

  /**
   * `git diff` alone never shows the content of a brand-new, untracked file
   * (there is nothing in the index to diff against) - exactly the case a
   * FAZ task that creates a file would hit. `git add --intent-to-add`
   * (never a commit, never touched blob content beyond an empty marker)
   * is git's own standard fix: it makes new files appear as additions in
   * the diff without staging their real content for a commit.
   */
  private gitDiff(root: string): string {
    runGitCommand(root, ['add', '--intent-to-add', '--all']);
    const outcome = runGitCommand(root, ['diff']);
    if (!outcome.ranAsGitRepo) return '';
    return outcome.stdout.length > MAX_DIFF_CHARS
      ? `${outcome.stdout.slice(0, MAX_DIFF_CHARS)}\n… (diff truncado)`
      : outcome.stdout;
  }

  /**
   * FECHA TUDO entry point. Only ever reachable when the message's intent is
   * explicitly `closeAll` (see `handle()`); never triggered implicitly by a
   * continuation. Refuses immediately, without touching Git, unless there is
   * a task for this exact project/conversation already in
   * `awaitingHomologation` or `committedPendingPush` - this is the FAZ →
   * awaitingHomologation → FECHA TUDO separation the task requires.
   */
  private handleClose(
    project: ProjectDescriptor,
    activeProject: ActiveProject,
    existing: ProjectTaskRecord | undefined,
    executionId: string,
    requestedAt: string,
  ): ProjectReply {
    const eligible = existing !== undefined && existing.projectId === project.id && CLOSE_ELIGIBLE_STATUSES.includes(existing.status);
    if (!eligible) {
      return {
        project: activeProject,
        message:
          'Não há tarefa aguardando homologação neste projeto, nesta conversa, para fechar. Peça uma alteração (ex.: "corrige X"), confirme o resultado e só então peça o fechamento (ex.: "fecha tudo").',
      };
    }
    const task = existing!;

    let root: string;
    try {
      root = resolveValidatedWorkspaceRoot(project, this.environmentId);
    } catch (error) {
      return { project: activeProject, message: error instanceof Error ? error.message : 'Checkout do projeto indisponível.' };
    }

    const result = this.gitCloseOrchestrator.close({
      project,
      workspaceRoot: root,
      taskFilesChanged: task.filesChanged,
      commitMessage: this.buildCommitMessage(task),
      ...(task.status === 'committedPendingPush' && task.commitHash !== undefined ? { existingCommitHash: task.commitHash } : {}),
      executionId,
      requestedAt,
    });

    const nextStatus: ProjectTaskStatus =
      result.outcome === 'closed' ? 'closed' : result.outcome === 'committedPendingPush' ? 'committedPendingPush' : task.status;

    this.persist({
      ...task,
      status: nextStatus,
      updatedAt: requestedAt,
      ...(result.commitHash === undefined ? {} : { commitHash: result.commitHash }),
      ...(result.tagName === undefined ? {} : { tagName: result.tagName }),
    });

    return { project: activeProject, message: this.composeCloseReply(project.displayName, result) };
  }

  private buildCommitMessage(task: ProjectTaskRecord): string {
    const continuationMatch = /Ajuste solicitado agora pelo usuário:\s*([\s\S]+)$/.exec(task.requestText);
    const source = (continuationMatch?.[1] ?? task.requestText).replace(/\s+/g, ' ').trim();
    const truncated = source.length > 72 ? `${source.slice(0, 69)}...` : source;
    return `Sebastian: ${truncated || 'alteração homologada'}`;
  }

  private composeCloseReply(projectName: string, result: GitCloseResult): string {
    const lines: string[] = [`Projeto: ${projectName}.`, result.message];

    if (result.filesIncluded.length > 0) {
      lines.push(`Arquivos incluídos no fechamento (${result.filesIncluded.length}):`, ...result.filesIncluded.map((file) => `  - ${file}`));
    }
    if (result.filesExcluded.length > 0) {
      lines.push(
        `Arquivos fora do fechamento, por não pertencerem a esta tarefa (${result.filesExcluded.length}):`,
        ...result.filesExcluded.map((file) => `  - ${file}`),
      );
    }
    if (result.migrationFiles.length > 0) {
      lines.push(`Migrations detectadas (${result.migrationFiles.length}):`, ...result.migrationFiles.map((file) => `  - ${file}`));
    }
    if (result.validations.length > 0) {
      lines.push(
        'Validações antes do commit:',
        ...result.validations.map((entry) => `  - ${entry.toolId}: ${entry.succeeded ? 'sucesso' : 'falhou'} - ${entry.message}`),
      );
    }
    if (result.commitHash) {
      lines.push(`Commit: ${result.commitHash}`);
    }
    lines.push(`Push: ${result.pushed ? 'confirmado' : 'não confirmado'}.`);
    if (result.tagName) {
      lines.push(`Tag: ${result.tagName}${result.tagPushed ? ' (publicada)' : ' (criada, publicação pendente)'}.`);
    }
    if (result.commitHash) {
      lines.push(`HEAD local corresponde ao remote: ${result.headMatchesRemote ? 'sim' : 'não confirmado'}.`);
    }
    return lines.join('\n');
  }

  private describeExecutorFailure(result: ProjectTaskExecutionResult): string {
    switch (result.outcome) {
      case 'timedOut':
        return `A execução foi encerrada por tempo limite. ${result.summary}`;
      case 'cancelled':
        return `A execução foi cancelada. ${result.summary}`;
      default:
        return `A execução da tarefa falhou. ${result.summary}`;
    }
  }

  private composeReply(
    projectName: string,
    authorization: GoalAuthorization,
    summary: string,
    filesChanged: readonly string[],
    diff: string,
    validations: readonly ProjectTaskValidationOutcome[],
    status: ProjectTaskStatus,
    gitAvailable: boolean,
  ): string {
    const lines: string[] = [`Projeto: ${projectName}.`, summary];

    if (authorization === 'readOnly') {
      lines.push(
        filesChanged.length === 0
          ? 'Modo somente leitura: nenhum arquivo foi alterado.'
          : `Aviso: modo somente leitura detectou alterações inesperadas em ${filesChanged.length} arquivo(s). Isso não deveria acontecer; revise manualmente.`,
      );
      return lines.join('\n');
    }

    if (!gitAvailable) {
      lines.push('Não foi possível confirmar alterações via git neste checkout (git indisponível ou não é um repositório).');
      return lines.join('\n');
    }

    if (filesChanged.length === 0) {
      lines.push('Nenhum arquivo foi alterado.');
      return lines.join('\n');
    }

    lines.push(`Arquivos alterados (${filesChanged.length}):`, ...filesChanged.map((file) => `  - ${file}`));
    if (diff) {
      lines.push('Diff:', diff);
    }
    if (validations.length > 0) {
      lines.push(
        'Validações:',
        ...validations.map((entry) => `  - ${entry.toolId}: ${entry.succeeded ? 'sucesso' : 'falhou'} - ${entry.message}`),
      );
    }
    if (status === 'awaitingHomologation') {
      lines.push('Aguardando sua homologação. Nada foi commitado, enviado ao repositório remoto ou implantado.');
    }
    return lines.join('\n');
  }

  private persist(record: ProjectTaskRecord): void {
    this.store.writeRecord(TASKS, record.conversationId, record as unknown as Readonly<Record<string, unknown>>);
  }
}
