import type { SpecializedToolInvocationResult } from './SpecializedToolInvocationContract.js';
import { SpecializedToolInvocationFailureError } from './SpecializedToolInvocationErrors.js';

/**
 * Narrows a `SpecializedTool.invoke` result back down to its synchronous
 * shape for orchestrators (`GoalExecutionOrchestrator`,
 * `DevelopmentTaskOrchestrator`, and `InMemorySpecializedAgent`'s
 * deterministic tool-use paths) that only ever address toolIds resolved
 * synchronously today (filesystem, Git, authorized commands). None of those
 * toolIds are ever routed to an asynchronous Tool (e.g. the GitHub
 * read-only boundary), so this is a transparent pass-through in every
 * reachable case - and a loud, safe failure instead of silent corruption if
 * that assumption is ever violated.
 */
export function requireSynchronousToolInvocationResult(
  result: SpecializedToolInvocationResult | Promise<SpecializedToolInvocationResult>,
): SpecializedToolInvocationResult {
  if (result instanceof Promise) {
    throw new SpecializedToolInvocationFailureError(
      'This execution path requires a synchronous Tool result; an asynchronous Tool invocation is not supported here.',
    );
  }
  return result;
}
