import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface CommandCapabilityPipelineExecutorErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class BaseCommandCapabilityPipelineExecutorError extends AppError {
  protected constructor(message: string, options: CommandCapabilityPipelineExecutorErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidCommandCapabilityPipelineInputError extends BaseCommandCapabilityPipelineExecutorError {
  public constructor(message: string, options: CommandCapabilityPipelineExecutorErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}

export class CommandCapabilityPipelineExecutorError extends BaseCommandCapabilityPipelineExecutorError {
  public constructor(message: string, options: CommandCapabilityPipelineExecutorErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      ...options,
    });
  }
}