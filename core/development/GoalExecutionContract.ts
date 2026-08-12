/**
 * Whether a goal may only observe (list/read/consult) or may also apply a
 * concrete, pre-identified local change. Never inferred from vague wording
 * such as "continua"/"resolve"/"pode seguir" - only from an explicit request
 * to fix/correct something, and even then only paired with concrete edit
 * parameters (see `GoalDefinition.fix`).
 */
export type GoalAuthorization = 'readOnly' | 'writeAuthorized';

/** A single, concrete, already-identified local edit a goal is allowed to apply - never inferred, always taken verbatim from what the user specified. */
export interface GoalFixAction {
  readonly path: string;
  readonly searchText: string;
  readonly replaceText: string;
}

/**
 * A goal is deliberately not a fixed plan (contrast with `DevelopmentTaskPlan`):
 * the sequence of actions the orchestrator takes is decided step by step, at
 * runtime, based on what each observation reveals - this is what lets the
 * cycle adapt when an early hypothesis turns out to be wrong.
 */
export interface GoalDefinition {
  readonly objective: string;
  readonly authorization: GoalAuthorization;
  /** The validation toolId (e.g. `validation.test`) this goal's investigation/verification revolves around. */
  readonly validationToolId: string;
  /** Present only when the user's own request already named a concrete edit - absent for purely investigative or vague "fix this" requests. */
  readonly fix?: GoalFixAction;
}

/** The cognitive role a step played - what a test/observer can point to when asserting "the cycle inspected before acting" or "verified before concluding". */
export type GoalExecutionStepPhase = 'inspect' | 'act' | 'verify' | 'evidence';

export interface GoalExecutionStepRecord {
  readonly stepId: string;
  readonly phase: GoalExecutionStepPhase;
  readonly toolId: string;
  readonly outcome: 'ok' | 'rejected' | 'failed';
  readonly summary: string;
}

/** One DECIDE point: what was observed and what that led the cycle to do next - kept internal/structured, never dumped raw to the user. */
export interface GoalExecutionDecisionRecord {
  readonly afterStepId: string;
  readonly observation: string;
  readonly decision: string;
}

export type GoalExecutionStatus = 'completed' | 'blocked' | 'failed' | 'incomplete';

export interface GoalExecutionResult {
  readonly objective: string;
  readonly authorization: GoalAuthorization;
  readonly status: GoalExecutionStatus;
  readonly steps: readonly GoalExecutionStepRecord[];
  readonly decisions: readonly GoalExecutionDecisionRecord[];
  readonly filesChanged: readonly string[];
  readonly reason?: string;
  readonly message: string;
}
