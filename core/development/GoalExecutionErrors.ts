import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface GoalExecutionErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class GoalExecutionError extends AppError {
  protected constructor(message: string, options: GoalExecutionErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidGoalExecutionInputError extends GoalExecutionError {
  public constructor(message: string, options: GoalExecutionErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}
