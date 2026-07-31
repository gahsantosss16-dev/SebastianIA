import { AppError, type AppErrorOptions } from './errors/AppError.js';
import { ErrorCategory } from './errors/ErrorCategory.js';
import { ErrorCodes } from './errors/ErrorCodes.js';
import { ErrorSeverity } from './errors/ErrorSeverity.js';

interface CoreOperationalRuntimeBootstrapErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

export class CoreOperationalRuntimeBootstrapError extends AppError {
  public constructor(message: string, options: CoreOperationalRuntimeBootstrapErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_STATE,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidCoreOperationalRuntimeBootstrapInputError extends CoreOperationalRuntimeBootstrapError {
  public constructor(message: string, options: CoreOperationalRuntimeBootstrapErrorOptions = {}) {
    super(message, { code: ErrorCodes.INVALID_ARGUMENT, ...options });
  }
}

export class CoreRuntimeCompositionError extends CoreOperationalRuntimeBootstrapError {}

export class CoreRuntimeCreationError extends CoreOperationalRuntimeBootstrapError {}

export class CoreRuntimeInitializationError extends CoreOperationalRuntimeBootstrapError {}

export class CoreRuntimeStartError extends CoreOperationalRuntimeBootstrapError {}
