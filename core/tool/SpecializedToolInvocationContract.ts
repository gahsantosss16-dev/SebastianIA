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

export interface SpecializedTool {
  invoke(input: SpecializedToolInvocationInput): SpecializedToolInvocationResult;
}
