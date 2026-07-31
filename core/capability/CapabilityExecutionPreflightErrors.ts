import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface CapabilityExecutionPreflightErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class BaseCapabilityExecutionPreflightError extends AppError {
  protected constructor(message: string, options: CapabilityExecutionPreflightErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidCapabilityPreflightInputError extends BaseCapabilityExecutionPreflightError {
  public constructor(message: string, options: CapabilityExecutionPreflightErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}

export class CapabilityPreflightNotReadyError extends BaseCapabilityExecutionPreflightError {
  public constructor(message: string, options: CapabilityExecutionPreflightErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_STATE,
      ...options,
    });
  }
}

export class CapabilityPreflightError extends BaseCapabilityExecutionPreflightError {
  public constructor(message: string, options: CapabilityExecutionPreflightErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      ...options,
    });
  }
}