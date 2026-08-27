/**
 * Limits on the cognitive DECIDE loop, layered on top of (never replacing)
 * `MAX_GOAL_EXECUTION_STEPS` - that ceiling still bounds every Tool call
 * regardless of who chose it. These bound the *cognitive* side specifically:
 * how many times the model may be consulted, how much text it is ever shown,
 * how long a single call may take, how repetitive its own choices may be
 * before that is treated as a stuck loop, and how little confidence is still
 * accepted before Sebastian stops rather than guesses.
 */
export interface CognitiveExecutionBudget {
  /** Hard ceiling on model consultations per goal - independent of, and always smaller than, the remaining Tool-call step budget. */
  readonly maxCognitiveDecisions: number;
  /** Maximum characters of any single observation/file excerpt sent to the model - never the full repository, never an unbounded transcript. */
  readonly maxObservationChars: number;
  /** Per-call timeout enforced by the orchestrator itself, independent of whatever timeout (if any) the provider implements internally. */
  readonly decisionTimeoutMs: number;
  /** How many times the exact same (toolId, arguments) decision may repeat before it is treated as a stuck loop and the goal stops instead of retrying blindly. */
  readonly maxRepeatedDecisions: number;
  /** Decisions below this confidence are refused before ever reaching a Tool - "don't invent certainty". */
  readonly minConfidence: number;
  /** Consecutive malformed/unparseable model responses tolerated before giving up rather than asking forever. */
  readonly maxConsecutiveInvalidDecisions: number;
}

export const DEFAULT_COGNITIVE_EXECUTION_BUDGET: CognitiveExecutionBudget = Object.freeze({
  maxCognitiveDecisions: 8,
  maxObservationChars: 4000,
  decisionTimeoutMs: 30_000,
  maxRepeatedDecisions: 2,
  minConfidence: 0.35,
  maxConsecutiveInvalidDecisions: 2,
});
