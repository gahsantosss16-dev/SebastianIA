import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface ProjectRegistryErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class BaseProjectRegistryError extends AppError {
  protected constructor(message: string, options: ProjectRegistryErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidProjectRegistrationError extends BaseProjectRegistryError {
  public constructor(message: string, options: ProjectRegistryErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}

export class ProjectAlreadyRegisteredError extends BaseProjectRegistryError {
  public constructor(message: string, options: ProjectRegistryErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.ALREADY_EXISTS,
      ...options,
    });
  }
}

export class ProjectRegistryError extends BaseProjectRegistryError {
  public constructor(message: string, options: ProjectRegistryErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_STATE,
      ...options,
    });
  }
}
