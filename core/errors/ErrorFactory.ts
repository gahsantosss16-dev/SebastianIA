import { AppError, type AppErrorOptions } from './AppError.js';
import { ErrorCodes, type ErrorCode } from './ErrorCodes.js';
import { ErrorCategory } from './ErrorCategory.js';
import { ErrorSeverity } from './ErrorSeverity.js';

export interface WrapOptions extends AppErrorOptions {
  readonly message?: string;
}

export class ErrorFactory {
  public static create(message: string, options: AppErrorOptions = {}): AppError {
    return new AppError(message, options);
  }

  public static wrap(cause: unknown, options: WrapOptions = {}): AppError {
    const message = options.message ?? (cause instanceof Error ? cause.message : 'Unknown error');
    const code = options.code ?? ErrorCodes.OPERATION_FAILED;
    const category = options.category ?? ErrorCategory.UNKNOWN;
    const severity = options.severity ?? ErrorSeverity.ERROR;
    const metadata = options.metadata;

    return new AppError(message, {
      code,
      category,
      severity,
      cause: cause instanceof Error ? cause : cause,
      metadata,
    });
  }

  public static unknown(message: string, metadata?: Record<string, unknown>): AppError {
    return new AppError(message, {
      code: ErrorCodes.UNKNOWN_ERROR,
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.ERROR,
      metadata,
    });
  }
}
