import { AppError, type AppErrorOptions } from './errors/AppError.js';
import { ErrorCategory } from './errors/ErrorCategory.js';
import { ErrorCodes } from './errors/ErrorCodes.js';
import { ErrorSeverity } from './errors/ErrorSeverity.js';

interface CorePipelineBootstrapErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

export class CorePipelineBootstrapError extends AppError {
  public constructor(message: string, options: CorePipelineBootstrapErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_STATE,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidCorePipelineProvidersError extends CorePipelineBootstrapError {}

export class InvalidCorePipelineBindingsError extends CorePipelineBootstrapError {}

export class InvalidCorePipelineBundleError extends CorePipelineBootstrapError {}

export class InvalidCorePipelineExecutorError extends CorePipelineBootstrapError {}
