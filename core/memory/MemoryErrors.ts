import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface MemoryErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class MemoryError extends AppError {
  protected constructor(message: string, options: MemoryErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidMemoryNamespaceError extends MemoryError {
  public constructor(message: string, options: MemoryErrorOptions = {}) {
    super(message, options);
  }
}

export class InvalidMemoryKeyError extends MemoryError {
  public constructor(message: string, options: MemoryErrorOptions = {}) {
    super(message, options);
  }
}
