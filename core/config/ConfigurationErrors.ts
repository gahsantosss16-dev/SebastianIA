import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface ConfigurationErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class ConfigurationError extends AppError {
  protected constructor(message: string, options: ConfigurationErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidConfigurationKeyError extends ConfigurationError {
  public constructor(message: string, options: ConfigurationErrorOptions = {}) {
    super(message, options);
  }
}

export class ConfigurationSchemaAlreadyRegisteredError extends ConfigurationError {
  public constructor(message: string, options: ConfigurationErrorOptions = {}) {
    super(message, options);
  }
}

export class InvalidConfigurationSchemaError extends ConfigurationError {
  public constructor(message: string, options: ConfigurationErrorOptions = {}) {
    super(message, options);
  }
}

export class ConfigurationValidationError extends ConfigurationError {
  public constructor(message: string, options: ConfigurationErrorOptions = {}) {
    super(message, options);
  }
}

export class DuplicateConfigurationEntryError extends ConfigurationError {
  public constructor(message: string, options: ConfigurationErrorOptions = {}) {
    super(message, options);
  }
}
