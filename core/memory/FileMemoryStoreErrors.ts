import { AppError, type AppErrorOptions } from '../errors/AppError.js';
import { ErrorCategory } from '../errors/ErrorCategory.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { ErrorSeverity } from '../errors/ErrorSeverity.js';

interface FileMemoryStoreErrorOptions extends AppErrorOptions {
  readonly cause?: unknown;
}

abstract class FileMemoryStoreError extends AppError {
  protected constructor(message: string, options: FileMemoryStoreErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      ...options,
    });
  }
}

export class InvalidFileMemoryStorePathError extends FileMemoryStoreError {
  public constructor(message: string, options: FileMemoryStoreErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.INVALID_ARGUMENT,
      ...options,
    });
  }
}

export class FileMemoryStoreReadError extends FileMemoryStoreError {
  public constructor(message: string, options: FileMemoryStoreErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      ...options,
    });
  }
}

export class FileMemoryStoreWriteError extends FileMemoryStoreError {
  public constructor(message: string, options: FileMemoryStoreErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      ...options,
    });
  }
}

export class FileMemoryStoreCorruptedError extends FileMemoryStoreError {
  public constructor(message: string, options: FileMemoryStoreErrorOptions = {}) {
    super(message, {
      code: ErrorCodes.OPERATION_FAILED,
      ...options,
    });
  }
}
