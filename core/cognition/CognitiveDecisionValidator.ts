import type {
  CognitiveCompletionState,
  CognitiveDecision,
  CognitiveIntent,
  CognitiveNextAction,
} from './CognitiveModelProviderContract.js';

const VALID_INTENTS: ReadonlySet<string> = new Set(['investigate', 'proposeFix', 'verify', 'conclude']);
const VALID_NEXT_ACTIONS: ReadonlySet<string> = new Set([
  'invokeTool',
  'requestMoreEvidence',
  'concludeCompleted',
  'concludeFailed',
]);
const VALID_COMPLETION_STATES: ReadonlySet<string> = new Set([
  'inProgress',
  'completed',
  'failed',
  'insufficientEvidence',
]);

/** Defensive ceiling on the logged justification - never a chain-of-thought transcript, just a short operational line. Overlong values are truncated, not rejected. */
export const MAX_REASONING_SUMMARY_CHARS = 300;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The single point every raw model response passes through before it is
 * ever trusted as a `CognitiveDecision` - anything malformed, missing a
 * required field, carrying the wrong type, or self-inconsistent (an
 * `invokeTool` action without a `toolId`) is rejected as `null` rather than
 * coerced or guessed at. Used by every `CognitiveModelProvider` adapter
 * (Ollama today) so schema validation lives in exactly one place instead of
 * being reimplemented per adapter.
 */
export function parseCognitiveDecision(raw: unknown): CognitiveDecision | null {
  if (!isPlainObject(raw)) {
    return null;
  }

  const intent = raw.intent;
  if (typeof intent !== 'string' || !VALID_INTENTS.has(intent)) {
    return null;
  }

  const goal = raw.goal;
  if (!isNonEmptyString(goal)) {
    return null;
  }

  const reasoningSummary = raw.reasoningSummary;
  if (typeof reasoningSummary !== 'string' || reasoningSummary.trim() === '') {
    return null;
  }

  const nextAction = raw.nextAction;
  if (typeof nextAction !== 'string' || !VALID_NEXT_ACTIONS.has(nextAction)) {
    return null;
  }

  const requiresAuthorization = raw.requiresAuthorization;
  if (typeof requiresAuthorization !== 'boolean') {
    return null;
  }

  const expectedEvidence = raw.expectedEvidence;
  if (!isNonEmptyString(expectedEvidence)) {
    return null;
  }

  const completionState = raw.completionState;
  if (typeof completionState !== 'string' || !VALID_COMPLETION_STATES.has(completionState)) {
    return null;
  }

  const confidence = raw.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return null;
  }

  let toolId: string | undefined;
  let toolArguments: Readonly<Record<string, unknown>> | undefined;

  if (nextAction === 'invokeTool') {
    if (!isNonEmptyString(raw.toolId)) {
      return null;
    }
    toolId = raw.toolId;

    if (raw.toolArguments !== undefined && !isPlainObject(raw.toolArguments)) {
      return null;
    }
    toolArguments = isPlainObject(raw.toolArguments) ? raw.toolArguments : {};
  }

  const decision: CognitiveDecision = {
    intent: intent as CognitiveIntent,
    goal,
    reasoningSummary: reasoningSummary.slice(0, MAX_REASONING_SUMMARY_CHARS),
    nextAction: nextAction as CognitiveNextAction,
    requiresAuthorization,
    expectedEvidence,
    completionState: completionState as CognitiveCompletionState,
    confidence,
    ...(toolId === undefined ? {} : { toolId }),
    ...(toolArguments === undefined ? {} : { toolArguments }),
  };

  return Object.freeze(decision);
}
