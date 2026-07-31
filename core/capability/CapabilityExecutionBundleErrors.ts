import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface CapabilityExecutionBundleErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class BaseCapabilityExecutionBundleError extends AppError {
  protected constructor(message: string, options: CapabilityExecutionBundleErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidCapabilityExecutionBundleInputError extends BaseCapabilityExecutionBundleError {
  public constructor(message: string, options: CapabilityExecutionBundleErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}

export class CapabilityExecutionBundleConsistencyError extends BaseCapabilityExecutionBundleError {
  public constructor(message: string, options: CapabilityExecutionBundleErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_STATE,
      ...options,
    });
  }
}

export class CapabilityExecutionBundleError extends BaseCapabilityExecutionBundleError {
  public constructor(message: string, options: CapabilityExecutionBundleErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      ...options,
    });
  }
}