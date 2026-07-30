import type { ErrorCode } from './ErrorCodes.js';
import { ErrorCategory } from './ErrorCategory.js';
import { ErrorSeverity } from './ErrorSeverity.js';

export interface AppErrorOptions {
  readonly code?: ErrorCode;
  readonly category?: ErrorCategory | undefined;
  readonly severity?: ErrorSeverity | undefined;
  readonly cause?: unknown;
  readonly metadata?: Record<string, unknown> | undefined;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly cause: unknown;
  public readonly metadata: Readonly<Record<string, unknown>> | undefined;
  public readonly timestamp: string;

  public constructor(message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = options.code ?? 'UNKNOWN_ERROR';
    this.category = options.category ?? ErrorCategory.UNKNOWN;
    this.severity = options.severity ?? ErrorSeverity.ERROR;
    this.cause = options.cause;
    this.metadata = options.metadata ? Object.freeze({ ...options.metadata }) : undefined;
    this.timestamp = new Date().toISOString();
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      severity: this.severity,
      metadata: this.metadata ? { ...this.metadata } : undefined,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
      timestamp: this.timestamp,
    };
  }
}
