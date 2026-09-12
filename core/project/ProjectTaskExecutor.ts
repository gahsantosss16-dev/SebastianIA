import type { GoalAuthorization } from '../development/GoalExecutionContract.js';

/**
 * Everything a real executor needs to act on a project's already-validated
 * local checkout. `workspaceRoot` is always the realpath-canonicalized,
 * environment-matched root resolved by the orchestrator - an executor never
 * resolves or trusts a root of its own. There is deliberately no field that
 * could carry a git commit/push/tag instruction: this boundary has no shape
 * for that, so no executor implementing it can be asked to do it implicitly.
 */
export interface ProjectTaskExecutionRequest {
  readonly taskId: string;
  readonly projectId: string;
  readonly workspaceRoot: string;
  readonly authorization: GoalAuthorization;
  readonly instructions: string;
  readonly conversationId: string;
  readonly executionId: string;
  readonly signal?: AbortSignal;
}

export type ProjectTaskExecutionOutcome = 'completed' | 'failed' | 'timedOut' | 'cancelled';

export interface ProjectTaskExecutionResult {
  readonly outcome: ProjectTaskExecutionOutcome;
  readonly summary: string;
  readonly rawLog?: string;
}

/**
 * The adapter boundary Etapa 2 asks for: one executor implementation is
 * wired in today (`ClaudeCliProjectTaskExecutor`), but the orchestrator only
 * ever depends on this interface, so a different executor can be swapped in
 * later without touching orchestration/authorization/state logic.
 */
export interface ProjectTaskExecutor {
  execute(request: ProjectTaskExecutionRequest): Promise<ProjectTaskExecutionResult>;
}
