import { AppError, type AppErrorOptions } from '../core/errors/AppError.js';
import { ErrorCategory } from '../core/errors/ErrorCategory.js';
import { ErrorCodes } from '../core/errors/ErrorCodes.js';
import { ErrorSeverity } from '../core/errors/ErrorSeverity.js';

export class InvalidLocalCommandArgumentsError extends AppError {
  public constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      category: ErrorCategory.VALIDATION,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}
