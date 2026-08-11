export interface SpecializedAgentHandoffInput {
  readonly responsibilityId: string;
  readonly executionId: string;
  readonly commandType: string;
  readonly requestedAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface SpecializedAgentHandoffSuccess {
  readonly status: 'completed';
  readonly output: Readonly<Record<string, unknown>>;
}

export interface SpecializedAgentHandoffFailure {
  readonly status: 'failed';
  readonly error: Error;
}

export type SpecializedAgentHandoffResult =
  | SpecializedAgentHandoffSuccess
  | SpecializedAgentHandoffFailure;

export interface SpecializedAgent {
  handoff(input: SpecializedAgentHandoffInput): Promise<SpecializedAgentHandoffResult>;
}
