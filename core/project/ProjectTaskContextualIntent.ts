import type {
  CognitiveClassificationRequest,
  CognitiveClassificationResult,
  CognitiveModelProvider,
} from '../cognition/index.js';

export type ContextualIntentKind = 'analyze' | 'write' | 'homologate' | 'closeAll' | 'ordinary' | 'ambiguous';

export interface RelatedTaskSummary {
  readonly status: string;
  readonly requestText: string;
  readonly summary: string;
}

export interface ContextualIntentContext {
  readonly text: string;
  readonly projectDisplayName: string;
  /** The most recent task for this project/conversation, any status - `undefined` when there is none, in which case no call is ever worth making. */
  readonly relatedTask?: RelatedTaskSummary;
  /** Whether a Git close is currently reachable for that task - a `'closeAll'` classification is never honored without this. */
  readonly hasCloseEligibleTask: boolean;
  readonly requestedAt: string;
  readonly signal?: AbortSignal;
}

const MAX_SUMMARY_CHARS = 600;
/**
 * Bounds a single classification call even if a future `CognitiveModelProvider`
 * never implements its own timeout - the exact same defense-in-depth reason
 * `GoalExecutionOrchestrator.callCognitiveModelWithTimeout` races a local
 * timer against the provider call instead of trusting the provider alone.
 */
const CLASSIFY_FALLBACK_TIMEOUT_MS = 10_000;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Etapa 4's thin routing layer over the optional `CognitiveModelProvider.classify`
 * seam. This is classification only, never execution: the result is a closed
 * `ContextualIntentKind`, and the caller (`ProjectTaskOrchestrator`) is the
 * only place that turns it into an actual ANALISA/FAZ/FECHA TUDO call through
 * the already-homologated Etapa 2/3 paths. Never called when there is no
 * `relatedTask` - without a task in context, "write"/"homologate"/"closeAll"
 * make no sense and a call would simply be wasted spend.
 *
 * Fail-safe by construction: any outcome other than a clean `'classified'`
 * result - no provider, no `classify` method, `unavailable`, `timeout`,
 * `invalidResponse` - resolves to `'ambiguous'`, never to `'write'` or
 * `'closeAll'`. A `'closeAll'` classification is additionally rejected
 * (downgraded to `'ambiguous'`) unless the caller already confirmed a
 * close-eligible task exists - this function never grants Git access on its
 * own judgement.
 */
export async function resolveContextualIntent(
  provider: CognitiveModelProvider | undefined,
  context: ContextualIntentContext,
  /** Overridable purely for tests, so a "provider never resolves" scenario does not need to actually wait 10s. Production always gets the real default. */
  fallbackTimeoutMs: number = CLASSIFY_FALLBACK_TIMEOUT_MS,
): Promise<ContextualIntentKind> {
  if (!context.relatedTask) {
    return 'ordinary';
  }
  if (!provider || typeof provider.classify !== 'function') {
    return 'ambiguous';
  }

  const request: CognitiveClassificationRequest = {
    text: context.text,
    projectDisplayName: context.projectDisplayName,
    taskStatus: context.relatedTask.status,
    taskRequestSummary: truncate(context.relatedTask.requestText, MAX_SUMMARY_CHARS),
    taskResultSummary: truncate(context.relatedTask.summary, MAX_SUMMARY_CHARS),
    requestedAt: context.requestedAt,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  };

  const result = await callClassifyWithTimeout(provider, request, fallbackTimeoutMs);
  if (result.outcome !== 'classified') {
    return 'ambiguous';
  }
  if (result.category === 'closeAll' && !context.hasCloseEligibleTask) {
    return 'ambiguous';
  }
  return result.category;
}

async function callClassifyWithTimeout(
  provider: CognitiveModelProvider,
  request: CognitiveClassificationRequest,
  fallbackTimeoutMs: number,
): Promise<CognitiveClassificationResult> {
  const timeoutPromise = new Promise<CognitiveClassificationResult>((resolve) => {
    setTimeout(() => resolve({ outcome: 'timeout' }), fallbackTimeoutMs);
  });
  return Promise.race([
    provider.classify!(request).catch(
      (): CognitiveClassificationResult => ({ outcome: 'unavailable', reason: 'Falha inesperada ao classificar a mensagem.' }),
    ),
    timeoutPromise,
  ]);
}
