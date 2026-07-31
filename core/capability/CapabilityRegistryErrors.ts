import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface CapabilityRegistryErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class BaseCapabilityRegistryError extends AppError {
  protected constructor(message: string, options: CapabilityRegistryErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidCapabilityRegistrationError extends BaseCapabilityRegistryError {
  public constructor(message: string, options: CapabilityRegistryErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}

export class CapabilityAlreadyRegisteredError extends BaseCapabilityRegistryError {
  public constructor(message: string, options: CapabilityRegistryErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.ALREADY_EXISTS,
      ...options,
    });
  }
}

export class CapabilityNotFoundError extends BaseCapabilityRegistryError {
  public constructor(message: string, options: CapabilityRegistryErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.NOT_FOUND,
      ...options,
    });
  }
}

export class CapabilityRegistryError extends BaseCapabilityRegistryError {
  public constructor(message: string, options: CapabilityRegistryErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_STATE,
      ...options,
    });
  }
}
