import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface CapabilityInvocationComposerErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class BaseCapabilityInvocationComposerError extends AppError {
  protected constructor(message: string, options: CapabilityInvocationComposerErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidCapabilityInvocationInputError extends BaseCapabilityInvocationComposerError {
  public constructor(message: string, options: CapabilityInvocationComposerErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}

export class CapabilityInvocationCompositionError extends BaseCapabilityInvocationComposerError {
  public constructor(message: string, options: CapabilityInvocationComposerErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      ...options,
    });
  }
}