import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface CommandProcessingResultAdapterErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class BaseCommandProcessingResultAdapterError extends AppError {
  protected constructor(message: string, options: CommandProcessingResultAdapterErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidCommandProcessingResultAdapterInputError extends BaseCommandProcessingResultAdapterError {
  public constructor(message: string, options: CommandProcessingResultAdapterErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}

export class CommandProcessingResultAdapterError extends BaseCommandProcessingResultAdapterError {
  public constructor(message: string, options: CommandProcessingResultAdapterErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      ...options,
    });
  }
}