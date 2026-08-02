import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface SpecializedToolInvocationErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class SpecializedToolInvocationError extends AppError {
  protected constructor(message: string, options: SpecializedToolInvocationErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidSpecializedToolInvocationInputError extends SpecializedToolInvocationError {
  public constructor(message: string, options: SpecializedToolInvocationErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}

export class SpecializedToolInvocationFailureError extends SpecializedToolInvocationError {
  public constructor(message: string, options: SpecializedToolInvocationErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      ...options,
    });
  }
}
