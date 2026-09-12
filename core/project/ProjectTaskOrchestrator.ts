import { randomUUID } from 'node:crypto';
import type { FileMemoryStore } from '../memory/FileMemoryStore.js';
import type { ProjectRegistry } from './ProjectRegistry.js';
import type { ProjectDescriptor } from './ProjectTypes.js';
import type { ActiveProject, ProjectReply } from './ProjectConversationContext.js';
import { resolveValidatedWorkspaceRoot } from './ProjectWorkspacePolicy.js';
import { classifyProjectTaskIntent } from './ProjectTaskIntent.js';
import type { ProjectTaskExecutor, ProjectTaskExecutionResult } from './ProjectTaskExecutor.js';
import type { GoalAuthorization } from '../development/GoalExecutionContract.js';
import { runGitCommand } from '../tool/LocalGitCommandRunner.js';
import { LocalAuthorizedCommandTool, type AuthorizedCommandDefinition } from '../tool/LocalAuthorizedCommandTool.js';

const TASKS = 'project-tasks';
const MAX_DIFF_CHARS = 4_000;

export type ProjectTaskStatus = 'analyzing' | 'writing' | 'awaitingHomologation' | 'completed' | 'failed';

export interface ProjectTaskValidationOutcome {
  readonly toolId: string;
  readonly succeeded: boolean;
  readonly message: string;
}

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
}

const OPEN_STATUSES: readonly ProjectTaskStatus[] = ['analyzing', 'writing', 'awaitingHomologation'];

/**
 * The real-execution counterpart to `ProjectConversationContext`: where that
 * class only ever identifies a project and loads its rules, this class
 * decides ANALISA/FAZ/FECHA TUDO for a message and, for ANALISA/FAZ, drives
 * a `ProjectTaskExecutor` against the project's already-validated root, then
 * reports real `git status`/`diff` and the project's own registered
 * validations - never a command invented from user text (reuses
 * `LocalAuthorizedCommandTool`, the same closed-registry validation runner
 * the rest of the codebase already uses). It never calls `git commit`,
 * `push` or `tag` itself, and has no request shape that could ask an
 * executor to.
 */
export class ProjectTaskOrchestrator {
  public constructor(
    private readonly registry: ProjectRegistry,
    private readonly store: FileMemoryStore,
    private readonly executor: ProjectTaskExecutor,
    private readonly environmentId: string,
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
    const continuing = existing !== undefined && existing.projectId === project.id && OPEN_STATUSES.includes(existing.status);

    let authorization: GoalAuthorization;
    let instructions: string;
    let taskId: string;
    let createdAt: string;

    if (continuing) {
      const openTask = existing!;
      authorization = openTask.authorization;
      instructions = `Tarefa anterior: ${openTask.requestText}\nResultado anterior: ${openTask.summary}\nAjuste solicitado agora pelo usuário: ${text}`;
      taskId = openTask.taskId;
      createdAt = openTask.createdAt;
    } else {
      const intent = classifyProjectTaskIntent(text);
      if (intent === undefined) return undefined;
      if (intent === 'closeAll') {
        return {
          project: activeProject,
          message:
            'O fechamento (commit, push, tag ou deploy) ainda não é automatizado nesta etapa. Etapa 2 cobre apenas análise e execução local de alterações, com homologação sua antes de qualquer coisa ir além do checkout local.',
        };
      }
      authorization = intent === 'write' ? 'writeAuthorized' : 'readOnly';
      if (authorization === 'writeAuthorized' && project.workspace?.localWrite?.enabled !== true) {
        return {
          project: activeProject,
          message: `Escrita não está habilitada para o projeto ${project.displayName} nesta configuração. Posso analisar (somente leitura), mas não posso aplicar alterações aqui.`,
        };
      }
      instructions = text;
      taskId = randomUUID();
      createdAt = requestedAt;
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

    const status = runGitCommand(root, ['status', '--porcelain']);
    const filesChanged = status.ranAsGitRepo ? this.parseChangedFiles(status.stdout) : [];
    const diff = filesChanged.length > 0 ? this.gitDiff(root) : '';
    const validations = filesChanged.length > 0 ? this.runValidations(project, root, executionId, requestedAt) : [];

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

  private parseChangedFiles(porcelainOutput: string): readonly string[] {
    return porcelainOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
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

  private runValidations(
    project: ProjectDescriptor,
    root: string,
    executionId: string,
    requestedAt: string,
  ): readonly ProjectTaskValidationOutcome[] {
    const definitions = project.workspace?.validations ?? [];
    if (definitions.length === 0) return [];
    const commandDefinitions: readonly AuthorizedCommandDefinition[] = definitions.map((definition) => ({
      toolId: definition.id,
      executable: definition.executable,
      args: definition.args,
      ...(definition.timeoutMs === undefined ? {} : { timeoutMs: definition.timeoutMs }),
    }));
    const tool = new LocalAuthorizedCommandTool(root, commandDefinitions);
    return commandDefinitions.map((definition) => {
      const invocation = tool.invoke({
        toolId: definition.toolId,
        executionId,
        responsibilityId: 'project-task-executor',
        requestedAt,
        payload: {},
      });
      if (invocation.status !== 'completed') {
        return { toolId: definition.toolId, succeeded: false, message: 'Falha ao executar a validação.' };
      }
      const output = invocation.output as { readonly succeeded?: boolean; readonly message?: string };
      return { toolId: definition.toolId, succeeded: output.succeeded === true, message: output.message ?? 'Sem detalhes.' };
    });
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
