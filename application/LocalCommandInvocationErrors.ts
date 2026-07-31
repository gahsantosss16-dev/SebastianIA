import { AppError, type AppErrorOptions } from '../core/errors/AppError.js';
import { ErrorCategory } from '../core/errors/ErrorCategory.js';
import { ErrorCodes } from '../core/errors/ErrorCodes.js';
import { ErrorSeverity } from '../core/errors/ErrorSeverity.js';

export class InvalidLocalCommandArgumentsError extends AppError {
  public constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      category: ErrorCategory.VALIDATION,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class LocalCommandRuntimeShutdownError extends AppError {
  public constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class LocalCommandExecutionAndShutdownError extends AppError {
  public readonly shutdownCause: unknown;

  public constructor(executionCause: unknown, shutdownCause: unknown) {
    super('Local command execution and runtime shutdown both failed.', {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      cause: executionCause,
    });
    this.shutdownCause = shutdownCause;
  }
}
