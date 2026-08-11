import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface ModelProviderContractErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class ModelProviderContractError extends AppError {
  protected constructor(message: string, options: ModelProviderContractErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidModelInterpretationRequestError extends ModelProviderContractError {
  public constructor(message: string, options: ModelProviderContractErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}
