import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface SpecializedAgentHandoffErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class SpecializedAgentHandoffError extends AppError {
  protected constructor(message: string, options: SpecializedAgentHandoffErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidSpecializedAgentHandoffInputError extends SpecializedAgentHandoffError {
  public constructor(message: string, options: SpecializedAgentHandoffErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}
