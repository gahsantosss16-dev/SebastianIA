import type {
  SpecializedTool,
  SpecializedToolInvocationResult,
} from '../tool/SpecializedToolInvocationContract.js';
import { FILESYSTEM_REPLACE_TEXT_TOOL_ID } from '../tool/LocalFilesystemInspectionTool.js';
import { GIT_STATUS_TOOL_ID, GIT_DIFF_TOOL_ID } from '../tool/LocalGitInspectionTool.js';
import { InvalidDevelopmentTaskPlanError } from './DevelopmentTaskErrors.js';
import type {
  DevelopmentTaskPlan,
  DevelopmentTaskResult,
  DevelopmentTaskStatus,
  DevelopmentTaskStep,
  DevelopmentTaskStepReport,
} from './DevelopmentTaskContract.js';

/** Hard, non-negotiable ceiling on Tool calls per development task - never continued past this, never made an open/autonomous loop. */
export const MAX_DEVELOPMENT_TASK_STEPS = 10;

/** Every authorized-command toolId is expected to use this prefix, exactly as `LocalToolDispatcher` already routes on it. */
const VALIDATION_TOOL_ID_PREFIX = 'validation.';

/**
 * The only toolIds an orchestrated plan is ever allowed to invoke -
 * independent of, and in addition to, whatever the underlying
 * `SpecializedTool` itself accepts. A plan step naming anything else is
 * refused before any invocation, exactly like an unauthorized validation
 * command is refused by `LocalAuthorizedCommandTool` - defense in depth
 * against a future ModelProvider producing a plan that names a toolId it
 * should not be able to reach.
 */
const FIXED_ALLOWED_TOOL_IDS: ReadonlySet<string> = new Set([
  FILESYSTEM_REPLACE_TEXT_TOOL_ID,
  GIT_STATUS_TOOL_ID,
  GIT_DIFF_TOOL_ID,
]);

export interface DevelopmentTaskExecutionContext {
  readonly executionId: string;
  readonly responsibilityId: string;
  readonly requestedAt: string;
}

interface StepOutcome {
  readonly report: DevelopmentTaskStepReport;
  readonly filesChanged: readonly string[];
  /** `undefined` means "do not change the task's running status because of this step" (e.g. informational Git steps). */
  readonly statusEffect?: { readonly status: DevelopmentTaskStatus; readonly reason: string };
  /** When true, no further steps are attempted after this one. */
  readonly stopExecution: boolean;
}

/**
 * Executes a short, already-structured `DevelopmentTaskPlan` as a bounded,
 * linear sequence of existing Tool invocations - never a DAG, scheduler, or
 * open-ended loop. Each step is classified by its toolId into one of three
 * behaviors:
 *
 * - `fs.replaceText` is critical: any rejection (including the SPEC-043
 *   dirty-file protection, which runs atomically inside the Tool itself, so
 *   there is no separate pre-check step here) stops the task immediately as
 *   `blocked`, skipping every remaining step - including validations - since
 *   nothing was changed and no result to validate exists yet.
 * - `validation.*` is important but non-fatal to the plan's continuation: a
 *   failed or rejected validation marks the task `failed` but the plan keeps
 *   running so the final report can still show real Git status/diff, exactly
 *   as required for a failed validation to be inspectable.
 * - `git.status`/`git.diff` are purely informational: their outcome (including
 *   "not a Git repository") never changes the task's status.
 *
 * An unexpected Tool failure (`status: 'failed'`) or a step naming a toolId
 * outside the fixed allow-list stops the task immediately as `failed`.
 */
export class DevelopmentTaskOrchestrator {
  private readonly specializedTool: SpecializedTool;
  private readonly maxSteps: number;

  public constructor(specializedTool: SpecializedTool, maxSteps: number = MAX_DEVELOPMENT_TASK_STEPS) {
    if (!specializedTool || typeof specializedTool.invoke !== 'function') {
      throw new InvalidDevelopmentTaskPlanError('Development task orchestrator specialized tool must provide invoke.');
    }
    if (typeof maxSteps !== 'number' || !Number.isInteger(maxSteps) || maxSteps < 1) {
      throw new InvalidDevelopmentTaskPlanError('Development task orchestrator maxSteps must be a positive integer.');
    }
    this.specializedTool = specializedTool;
    this.maxSteps = maxSteps;
  }

  public execute(plan: DevelopmentTaskPlan, context: DevelopmentTaskExecutionContext): DevelopmentTaskResult {
    this.validatePlan(plan);
    this.validateContext(context);

    if (plan.steps.length > this.maxSteps) {
      return this.finalize(plan.objective, 'failed', [], [], 'stepLimitExceeded');
    }

    const reports: DevelopmentTaskStepReport[] = [];
    const filesChanged: string[] = [];
    let status: DevelopmentTaskStatus = 'completed';
    let reason: string | undefined;

    for (const step of plan.steps) {
      const outcome = this.executeStep(step, context);
      reports.push(outcome.report);
      filesChanged.push(...outcome.filesChanged);

      if (outcome.statusEffect) {
        status = outcome.statusEffect.status;
        reason = outcome.statusEffect.reason;
      }

      if (outcome.stopExecution) {
        break;
      }
    }

    return this.finalize(plan.objective, status, reports, filesChanged, reason);
  }

  private executeStep(step: DevelopmentTaskStep, context: DevelopmentTaskExecutionContext): StepOutcome {
    if (!this.isToolAllowed(step.toolId)) {
      return {
        report: {
          stepId: step.stepId,
          toolId: step.toolId,
          description: step.description,
          outcome: 'failed',
          summary: `Tool "${step.toolId}" não está autorizada para orquestração de tarefas.`,
        },
        filesChanged: [],
        statusEffect: { status: 'failed', reason: 'toolNotAuthorized' },
        stopExecution: true,
      };
    }

    const toolResult = this.specializedTool.invoke({
      toolId: step.toolId,
      executionId: context.executionId,
      responsibilityId: context.responsibilityId,
      requestedAt: context.requestedAt,
      payload: step.toolInput,
    });

    if (!this.isSuccessfulInvocation(toolResult)) {
      return {
        report: {
          stepId: step.stepId,
          toolId: step.toolId,
          description: step.description,
          outcome: 'failed',
          summary: `A etapa "${step.description}" falhou inesperadamente.`,
        },
        filesChanged: [],
        statusEffect: { status: 'failed', reason: 'unexpectedToolFailure' },
        stopExecution: true,
      };
    }

    const output = toolResult.output;

    if (step.toolId === FILESYSTEM_REPLACE_TEXT_TOOL_ID) {
      return this.classifyReplaceTextStep(step, output);
    }
    if (step.toolId.startsWith(VALIDATION_TOOL_ID_PREFIX)) {
      return this.classifyValidationStep(step, output);
    }
    return this.classifyGitStep(step, output);
  }

  private classifyReplaceTextStep(step: DevelopmentTaskStep, output: Readonly<Record<string, unknown>>): StepOutcome {
    const outcome = output.outcome;
    const path = typeof output.path === 'string' ? output.path : step.description;
    const message = typeof output.message === 'string' ? output.message : 'Edição recusada.';

    if (outcome === 'ok') {
      return {
        report: {
          stepId: step.stepId,
          toolId: step.toolId,
          description: step.description,
          outcome: 'ok',
          summary: `Arquivo "${path}" atualizado.`,
        },
        filesChanged: [path],
        stopExecution: false,
      };
    }

    const reasonCode = typeof output.reasonCode === 'string' ? output.reasonCode : 'editRejected';
    return {
      report: {
        stepId: step.stepId,
        toolId: step.toolId,
        description: step.description,
        outcome: 'rejected',
        summary: message,
      },
      filesChanged: [],
      statusEffect: { status: 'blocked', reason: reasonCode },
      stopExecution: true,
    };
  }

  private classifyValidationStep(step: DevelopmentTaskStep, output: Readonly<Record<string, unknown>>): StepOutcome {
    const outcome = output.outcome;

    if (outcome === 'ok') {
      const succeeded = output.succeeded === true;
      const exitCode = typeof output.exitCode === 'number' || output.exitCode === null ? output.exitCode : 'desconhecido';
      const summary = `Validação "${step.toolId}" ${succeeded ? 'concluída com sucesso' : 'falhou'} (exit code ${exitCode}).`;

      return {
        report: {
          stepId: step.stepId,
          toolId: step.toolId,
          description: step.description,
          outcome: succeeded ? 'ok' : 'failed',
          summary,
        },
        filesChanged: [],
        ...(succeeded ? {} : { statusEffect: { status: 'failed' as const, reason: 'validationFailed' } }),
        stopExecution: false,
      };
    }

    const reasonCode = typeof output.reasonCode === 'string' ? output.reasonCode : 'validationRejected';
    const message = typeof output.message === 'string' ? output.message : 'Validação recusada.';
    return {
      report: {
        stepId: step.stepId,
        toolId: step.toolId,
        description: step.description,
        outcome: 'failed',
        summary: message,
      },
      filesChanged: [],
      statusEffect: { status: 'failed', reason: reasonCode },
      stopExecution: false,
    };
  }

  private classifyGitStep(step: DevelopmentTaskStep, output: Readonly<Record<string, unknown>>): StepOutcome {
    const outcome = output.outcome;

    if (outcome !== 'ok') {
      return {
        report: {
          stepId: step.stepId,
          toolId: step.toolId,
          description: step.description,
          outcome: 'ok',
          summary: 'Este workspace não é um repositório Git.',
        },
        filesChanged: [],
        stopExecution: false,
      };
    }

    if (step.toolId === GIT_STATUS_TOOL_ID) {
      const clean = output.clean === true;
      const branch = typeof output.branch === 'string' ? output.branch : 'desconhecida';
      const changedFiles = Array.isArray(output.changedFiles) ? output.changedFiles.length : 0;
      const summary = clean
        ? `Branch "${branch}", sem alterações pendentes.`
        : `Branch "${branch}", ${changedFiles} arquivo(s) alterado(s).`;
      return {
        report: { stepId: step.stepId, toolId: step.toolId, description: step.description, outcome: 'ok', summary },
        filesChanged: [],
        stopExecution: false,
      };
    }

    const diff = typeof output.diff === 'string' ? output.diff : '';
    const hasChanges = diff.trim() !== '';
    const truncated = output.truncated === true;
    const summary = hasChanges
      ? `Há alterações não commitadas${truncated ? ' (diff truncado)' : ''}.`
      : 'Não há alterações no momento.';
    return {
      report: { stepId: step.stepId, toolId: step.toolId, description: step.description, outcome: 'ok', summary },
      filesChanged: [],
      stopExecution: false,
    };
  }

  private isSuccessfulInvocation(
    result: SpecializedToolInvocationResult,
  ): result is { readonly status: 'completed'; readonly output: Readonly<Record<string, unknown>> } {
    return (
      !!result &&
      typeof result === 'object' &&
      result.status === 'completed' &&
      !!result.output &&
      typeof result.output === 'object' &&
      !Array.isArray(result.output)
    );
  }

  private isToolAllowed(toolId: string): boolean {
    return FIXED_ALLOWED_TOOL_IDS.has(toolId) || toolId.startsWith(VALIDATION_TOOL_ID_PREFIX);
  }

  private finalize(
    objective: string,
    status: DevelopmentTaskStatus,
    steps: readonly DevelopmentTaskStepReport[],
    filesChanged: readonly string[],
    reason?: string,
  ): DevelopmentTaskResult {
    const uniqueFilesChanged = Array.from(new Set(filesChanged));
    const message = this.composeMessage(objective, status, uniqueFilesChanged, reason);

    return {
      objective,
      status,
      steps: Object.freeze([...steps]),
      filesChanged: Object.freeze(uniqueFilesChanged),
      ...(reason === undefined ? {} : { reason }),
      message,
    };
  }

  private composeMessage(
    objective: string,
    status: DevelopmentTaskStatus,
    filesChanged: readonly string[],
    reason: string | undefined,
  ): string {
    if (status === 'completed') {
      const filesSummary = filesChanged.length === 0 ? 'nenhum arquivo alterado' : `arquivos alterados: ${filesChanged.join(', ')}`;
      return `Tarefa concluída: ${objective} (${filesSummary}).`;
    }

    if (status === 'blocked') {
      return `Tarefa interrompida (bloqueada) antes de qualquer alteração: ${this.friendlyReason(reason)}`;
    }

    return `Tarefa falhou: ${this.friendlyReason(reason)}`;
  }

  private friendlyReason(reason: string | undefined): string {
    switch (reason) {
      case 'fileAlreadyModified':
        return 'o arquivo alvo já possui alterações não commitadas.';
      case 'stepLimitExceeded':
        return `o plano ultrapassa o limite de ${this.maxSteps} etapas.`;
      case 'toolNotAuthorized':
        return 'uma etapa do plano usa uma ferramenta não autorizada.';
      case 'unexpectedToolFailure':
        return 'uma etapa falhou de forma inesperada.';
      case 'validationFailed':
        return 'a validação executada não passou.';
      case 'validationRejected':
        return 'a validação solicitada não está autorizada.';
      case 'timedOut':
        return 'a validação excedeu o tempo limite.';
      default:
        return reason ? `motivo: ${reason}.` : 'motivo não especificado.';
    }
  }

  private validatePlan(plan: DevelopmentTaskPlan): void {
    const isObject = plan && typeof plan === 'object' && !Array.isArray(plan);
    if (!isObject) {
      throw new InvalidDevelopmentTaskPlanError('Development task plan must be an object.');
    }
    if (typeof plan.objective !== 'string' || plan.objective.trim() === '') {
      throw new InvalidDevelopmentTaskPlanError('Development task plan objective must be a non-empty string.');
    }
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
      throw new InvalidDevelopmentTaskPlanError('Development task plan steps must be a non-empty array.');
    }
    for (const step of plan.steps) {
      this.validateStep(step);
    }
  }

  private validateStep(step: DevelopmentTaskStep): void {
    const isObject = step && typeof step === 'object' && !Array.isArray(step);
    if (!isObject) {
      throw new InvalidDevelopmentTaskPlanError('Development task step must be an object.');
    }
    if (typeof step.stepId !== 'string' || step.stepId.trim() === '') {
      throw new InvalidDevelopmentTaskPlanError('Development task step stepId must be a non-empty string.');
    }
    if (typeof step.description !== 'string' || step.description.trim() === '') {
      throw new InvalidDevelopmentTaskPlanError('Development task step description must be a non-empty string.');
    }
    if (typeof step.toolId !== 'string' || step.toolId.trim() === '') {
      throw new InvalidDevelopmentTaskPlanError('Development task step toolId must be a non-empty string.');
    }
    if (!step.toolInput || typeof step.toolInput !== 'object' || Array.isArray(step.toolInput)) {
      throw new InvalidDevelopmentTaskPlanError('Development task step toolInput must be an object.');
    }
  }

  private validateContext(context: DevelopmentTaskExecutionContext): void {
    const isObject = context && typeof context === 'object' && !Array.isArray(context);
    if (!isObject) {
      throw new InvalidDevelopmentTaskPlanError('Development task execution context must be an object.');
    }
    if (typeof context.executionId !== 'string' || context.executionId.trim() === '') {
      throw new InvalidDevelopmentTaskPlanError('Development task execution context executionId must be a non-empty string.');
    }
    if (typeof context.responsibilityId !== 'string' || context.responsibilityId.trim() === '') {
      throw new InvalidDevelopmentTaskPlanError('Development task execution context responsibilityId must be a non-empty string.');
    }
    if (typeof context.requestedAt !== 'string' || context.requestedAt.trim() === '') {
      throw new InvalidDevelopmentTaskPlanError('Development task execution context requestedAt must be a non-empty string.');
    }
  }
}
