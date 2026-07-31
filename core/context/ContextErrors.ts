import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface ContextErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class ContextError extends AppError {
  protected constructor(message: string, options: ContextErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidContextConversationIdError extends ContextError {
  public constructor(message: string, options: ContextErrorOptions = {}) {
    super(message, options);
  }
}

export class InvalidContextSessionIdError extends ContextError {
  public constructor(message: string, options: ContextErrorOptions = {}) {
    super(message, options);
  }
}

export class InvalidContextInputError extends ContextError {
  public constructor(message: string, options: ContextErrorOptions = {}) {
    super(message, options);
  }
}
