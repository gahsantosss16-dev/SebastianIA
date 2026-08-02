import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface CommandResultMemoryContractErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class CommandResultMemoryContractError extends AppError {
  protected constructor(message: string, options: CommandResultMemoryContractErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidCommandResultMemoryWriteBackInputError extends CommandResultMemoryContractError {
  public constructor(message: string, options: CommandResultMemoryContractErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}

export class CommandResultMemoryWriteBackFailureError extends CommandResultMemoryContractError {
  public constructor(message: string, options: CommandResultMemoryContractErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      ...options,
    });
  }
}
