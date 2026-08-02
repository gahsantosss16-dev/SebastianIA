import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface CommandContextHydrationContractErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class CommandContextHydrationContractError extends AppError {
  protected constructor(message: string, options: CommandContextHydrationContractErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidCommandContextHydrationRequestError extends CommandContextHydrationContractError {
  public constructor(message: string, options: CommandContextHydrationContractErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}
