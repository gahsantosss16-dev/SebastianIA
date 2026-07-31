import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface CapabilityErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class CapabilityError extends AppError {
  protected constructor(message: string, options: CapabilityErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidCapabilityInvocationError extends CapabilityError {
  public constructor(message: string, options: CapabilityErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}

export class UnsupportedCapabilityError extends CapabilityError {
  public constructor(message: string, options: CapabilityErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.NOT_FOUND,
      ...options,
    });
  }
}

export class CapabilityResolutionError extends CapabilityError {
  public constructor(message: string, options: CapabilityErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.NOT_FOUND,
      ...options,
    });
  }
}

export class CapabilityExecutionError extends CapabilityError {
  public constructor(message: string, options: CapabilityErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      ...options,
    });
  }
}
