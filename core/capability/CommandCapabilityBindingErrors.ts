import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface CommandCapabilityBindingErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class BaseCommandCapabilityBindingError extends AppError {
  protected constructor(message: string, options: CommandCapabilityBindingErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidCommandCapabilityBindingError extends BaseCommandCapabilityBindingError {
  public constructor(message: string, options: CommandCapabilityBindingErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}

export class CommandCapabilityBindingNotFoundError extends BaseCommandCapabilityBindingError {
  public constructor(message: string, options: CommandCapabilityBindingErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.NOT_FOUND,
      ...options,
    });
  }
}

export class DuplicateCommandCapabilityBindingError extends BaseCommandCapabilityBindingError {
  public constructor(message: string, options: CommandCapabilityBindingErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.ALREADY_EXISTS,
      ...options,
    });
  }
}

export class CommandCapabilityBindingConsistencyError extends BaseCommandCapabilityBindingError {
  public constructor(message: string, options: CommandCapabilityBindingErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_STATE,
      ...options,
    });
  }
}