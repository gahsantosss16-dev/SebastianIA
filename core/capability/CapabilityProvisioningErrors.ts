import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface CapabilityProvisioningErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class BaseCapabilityProvisioningError extends AppError {
  protected constructor(message: string, options: CapabilityProvisioningErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidCapabilityProviderError extends BaseCapabilityProvisioningError {
  public constructor(message: string, options: CapabilityProvisioningErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}

export class InvalidCapabilityProvisioningError extends BaseCapabilityProvisioningError {
  public constructor(message: string, options: CapabilityProvisioningErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}

export class DuplicateCapabilityProvisionError extends BaseCapabilityProvisioningError {
  public constructor(message: string, options: CapabilityProvisioningErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.ALREADY_EXISTS,
      ...options,
    });
  }
}

export class CapabilityProvisioningError extends BaseCapabilityProvisioningError {
  public constructor(message: string, options: CapabilityProvisioningErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      ...options,
    });
  }
}