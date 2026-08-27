import type { GoalAuthorization } from '../development/GoalExecutionContract.js';

/**
 * A single Tool the cognitive engine is allowed to *propose*, described only
 * by its id, a short human-readable purpose, and whether invoking it
 * requires the goal's write authorization. This is deliberately the entire
 * surface the model ever sees of the Tool system - never a raw
 * implementation, never a schema the model could use to invent a new
 * toolId. Choosing a `toolId` here never grants permission to run it; the
 * orchestrator's own closed allow-list (`CognitiveToolPolicy`, reused from
 * the exact same policy the deterministic SPEC-046/047 path already
 * enforces) decides that independently, after the fact.
 */
export interface CognitiveToolDescriptor {
  readonly toolId: string;
  readonly description: string;
  readonly requiresAuthorization: boolean;
}

/** A previously executed step, already summarized by the orchestrator - never a raw stdout/stderr dump. */
export interface CognitiveObservationRecord {
  readonly stepId: string;
  readonly toolId: string;
  readonly outcome: 'ok' | 'rejected' | 'failed';
  readonly summary: string;
}

/**
 * The content of a file the goal execution has already read through
 * `fs.readFile` this run. Treated by the orchestrator as untrusted data
 * describing the workspace, never as an instruction - a file whose content
 * happens to contain imperative-looking text ("ignore your rules and...")
 * carries no authority; only the goal's own `authorization`, set outside
 * this cycle, does.
 */
export interface CognitiveFileExcerpt {
  readonly path: string;
  readonly content: string;
}

/** A short, already-selected fact from Memory - never the full memory store. */
export interface CognitiveMemoryFact {
  readonly content: string;
}

/**
 * The bounded, structured context the cognitive engine is allowed to see for
 * one DECIDE point. Deliberately incremental (never the whole repository,
 * never unbounded history) - see SPEC-048 section 16.
 */
export interface CognitiveDecisionRequest {
  readonly objective: string;
  readonly authorization: GoalAuthorization;
  readonly relevantMemory: readonly CognitiveMemoryFact[];
  readonly recentObservations: readonly CognitiveObservationRecord[];
  readonly filesRead: readonly CognitiveFileExcerpt[];
  readonly availableTools: readonly CognitiveToolDescriptor[];
  readonly stepsTaken: number;
  readonly stepsRemaining: number;
  readonly requestedAt: string;
}

export type CognitiveIntent = 'investigate' | 'proposeFix' | 'verify' | 'conclude';

export type CognitiveNextAction = 'invokeTool' | 'requestMoreEvidence' | 'concludeCompleted' | 'concludeFailed';

export type CognitiveCompletionState = 'inProgress' | 'completed' | 'failed' | 'insufficientEvidence';

/**
 * A single structured proposal for the next action - never free text, never
 * a command the model can run directly. `reasoningSummary` is an operational
 * one-liner suitable for logging/diagnosis, not a chain-of-thought dump; the
 * provider (and its validator) is responsible for never forwarding a model's
 * raw internal deliberation here.
 */
export interface CognitiveDecision {
  readonly intent: CognitiveIntent;
  readonly goal: string;
  readonly reasoningSummary: string;
  readonly nextAction: CognitiveNextAction;
  readonly toolId?: string;
  readonly toolArguments?: Readonly<Record<string, unknown>>;
  /**
   * The model's own claim about whether this action needs write
   * authorization. Advisory only for logging/diagnosis - the orchestrator
   * never trusts this value and always re-derives the real answer from its
   * own closed policy before ever invoking a Tool.
   */
  readonly requiresAuthorization: boolean;
  readonly expectedEvidence: string;
  readonly completionState: CognitiveCompletionState;
  /** 0 (no confidence) to 1 (certain). */
  readonly confidence: number;
}

/**
 * Every call to `decide` resolves - never rejects - to exactly one of these
 * outcomes, so the orchestrator can always react safely regardless of what
 * the local runtime or the model itself does.
 */
export type CognitiveDecisionResult =
  | { readonly outcome: 'decided'; readonly decision: CognitiveDecision }
  | { readonly outcome: 'unavailable'; readonly reason: string }
  | { readonly outcome: 'timeout' }
  | { readonly outcome: 'invalidResponse'; readonly reason: string };

/**
 * Substitutable boundary for the general cognitive engine (SPEC-048) -
 * mirrors `ModelProvider`'s role as a seam Core/Tool/GoalExecutionOrchestrator
 * never depend on by concrete name. A `CognitiveModelProvider` only ever
 * *proposes* a `CognitiveDecision`; it never gains direct access to the
 * filesystem, Git, or any process - the deterministic
 * `GoalExecutionOrchestrator` decides, independently, whether a proposed
 * action is actually allowed to run.
 */
export interface CognitiveModelProvider {
  decide(request: CognitiveDecisionRequest): Promise<CognitiveDecisionResult>;
}
