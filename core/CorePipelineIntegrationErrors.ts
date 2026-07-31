import { AppError, type AppErrorOptions } from './errors/AppError.js';
import { ErrorCategory } from './errors/ErrorCategory.js';
import { ErrorCodes } from './errors/ErrorCodes.js';
import { ErrorSeverity } from './errors/ErrorSeverity.js';

interface CorePipelineIntegrationErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class BaseCorePipelineIntegrationError extends AppError {
  protected constructor(message: string, options: CorePipelineIntegrationErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidCoreCommandInputError extends BaseCorePipelineIntegrationError {
  public constructor(message: string, options: CorePipelineIntegrationErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}

export class CorePipelineDependencyUnavailableError extends BaseCorePipelineIntegrationError {
  public constructor(message: string, options: CorePipelineIntegrationErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_STATE,
      ...options,
    });
  }
}

export class CorePipelineExecutionError extends BaseCorePipelineIntegrationError {
  public constructor(message: string, options: CorePipelineIntegrationErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      ...options,
    });
  }
}