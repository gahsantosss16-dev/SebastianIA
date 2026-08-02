export interface CommandResultMemoryWriteBackInput {
  readonly executionId: string;
  readonly commandType: string;
  readonly commandGeneratedAt: string;
  readonly resultGeneratedAt: string;
  readonly resultStatus: string;
  readonly output: Readonly<Record<string, unknown>>;
  readonly metadata: {
    readonly conversationId?: string;
    readonly sessionId?: string;
  };
}

export interface CommandResultMemoryWriteBackSuccess {
  readonly status: 'recorded';
  readonly key: string;
  readonly recordedAt: string;
}

export interface CommandResultMemoryWriteBackFailure {
  readonly status: 'failed';
  readonly error: Error;
}

export type CommandResultMemoryWriteBackResult =
  | CommandResultMemoryWriteBackSuccess
  | CommandResultMemoryWriteBackFailure;

export interface CommandResultMemoryWriter {
  write(input: CommandResultMemoryWriteBackInput): CommandResultMemoryWriteBackResult;
}
