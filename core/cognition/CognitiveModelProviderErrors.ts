import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface CognitiveModelProviderErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class CognitiveModelProviderError extends AppError {
  protected constructor(message: string, options: CognitiveModelProviderErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

/** Thrown only for genuinely malformed construction input (e.g. a missing model name) - never for a bad model response, which is always a normal `invalidResponse` result instead. */
export class InvalidCognitiveModelProviderInputError extends CognitiveModelProviderError {
  public constructor(message: string, options: CognitiveModelProviderErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}
