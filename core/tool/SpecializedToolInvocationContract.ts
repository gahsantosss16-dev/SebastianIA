export interface SpecializedToolInvocationInput {
  readonly toolId: string;
  readonly executionId: string;
  readonly responsibilityId: string;
  readonly requestedAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface SpecializedToolInvocationSuccess {
  readonly status: 'completed';
  readonly output: Readonly<Record<string, unknown>>;
}

export interface SpecializedToolInvocationFailure {
  readonly status: 'failed';
  readonly error: Error;
}

export type SpecializedToolInvocationResult =
  | SpecializedToolInvocationSuccess
  | SpecializedToolInvocationFailure;

/**
 * A Tool may resolve its result immediately (every existing filesystem,
 * Git, authorized-command and restricted-online Tool) or asynchronously
 * (e.g. a GitHub read-only Tool backed by `fetch`). Both are the same
 * contract: callers that can react to either use `await`, which resolves a
 * plain value exactly as if it were already a settled Promise; callers that
 * require a synchronous result use `requireSynchronousToolInvocationResult`
 * from `SynchronousToolInvocationGuard.ts`.
 */
export interface SpecializedTool {
  invoke(
    input: SpecializedToolInvocationInput,
  ): SpecializedToolInvocationResult | Promise<SpecializedToolInvocationResult>;
}
