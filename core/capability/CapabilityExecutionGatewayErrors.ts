import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface CapabilityExecutionGatewayErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class BaseCapabilityExecutionGatewayError extends AppError {
  protected constructor(message: string, options: CapabilityExecutionGatewayErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidCapabilityExecutionGatewayInputError extends BaseCapabilityExecutionGatewayError {
  public constructor(message: string, options: CapabilityExecutionGatewayErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}

export class CapabilityExecutionGatewayError extends BaseCapabilityExecutionGatewayError {
  public constructor(message: string, options: CapabilityExecutionGatewayErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      ...options,
    });
  }
}