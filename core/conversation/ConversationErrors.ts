import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface ConversationErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class ConversationError extends AppError {
  protected constructor(message: string, options: ConversationErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidConversationIdError extends ConversationError {
  public constructor(message: string, options: ConversationErrorOptions = {}) {
    super(message, options);
  }
}

export class InvalidSessionIdError extends ConversationError {
  public constructor(message: string, options: ConversationErrorOptions = {}) {
    super(message, options);
  }
}

export class ConversationNotFoundError extends ConversationError {
  public constructor(message: string, options: ConversationErrorOptions = {}) {
    super(message, options);
  }
}

export class SessionNotFoundError extends ConversationError {
  public constructor(message: string, options: ConversationErrorOptions = {}) {
    super(message, options);
  }
}

export class PendingTaskNotFoundError extends ConversationError {
  public constructor(message: string, options: ConversationErrorOptions = {}) {
    super(message, options);
  }
}

export class ConversationPersistenceError extends ConversationError {
  public constructor(message: string, options: ConversationErrorOptions = {}) {
    super(message, options);
  }
}
