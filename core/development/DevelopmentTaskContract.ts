/**
 * A single planned step of a development task: exactly one Tool invocation,
 * never a nested plan, branch, or scheduler entry. `toolId`/`toolInput` are
 * always produced deterministically by the ModelProvider (never taken from
 * raw user text), so the orchestrator can treat every step the same way it
 * already treats a single `useTool` decision.
 */
export interface DevelopmentTaskStep {
  readonly stepId: string;
  readonly description: string;
  readonly toolId: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
}

/**
 * A short, structured plan for a single development task - not a general
 * workflow definition. A real ModelProvider is expected to produce this same
 * shape in the future, behind the same `developTask` decision.
 */
export interface DevelopmentTaskPlan {
  readonly objective: string;
  readonly steps: readonly DevelopmentTaskStep[];
}

/** Bounded, already-summarized outcome of a single executed (or skipped) step - never the Tool's raw, potentially large message. */
export interface DevelopmentTaskStepReport {
  readonly stepId: string;
  readonly toolId: string;
  readonly description: string;
  readonly outcome: 'ok' | 'rejected' | 'failed' | 'skipped';
  readonly summary: string;
}

export type DevelopmentTaskStatus = 'completed' | 'failed' | 'blocked';

/**
 * Final, bounded report of a development task - the same object is used both
 * as the user-facing response and as what gets persisted to Memory, so it
 * deliberately never carries full file contents, raw stdout/stderr, or a raw
 * diff (each step's `summary` is a short, structurally-derived sentence, not
 * the underlying Tool's own message field).
 */
export interface DevelopmentTaskResult {
  readonly objective: string;
  readonly status: DevelopmentTaskStatus;
  readonly steps: readonly DevelopmentTaskStepReport[];
  readonly filesChanged: readonly string[];
  readonly reason?: string;
  readonly message: string;
}
