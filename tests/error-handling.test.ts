import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AppError,
  ErrorCategory,
  ErrorCodes,
  ErrorFactory,
  ErrorSeverity,
} from '../core/errors/index.js';

test('creates an AppError with the provided fields', () => {
  const error = new AppError('boom', {
    code: ErrorCodes.INVALID_ARGUMENT,
    category: ErrorCategory.VALIDATION,
    severity: ErrorSeverity.WARNING,
    metadata: { source: 'test' },
  });

  assert.equal(error.message, 'boom');
  assert.equal(error.code, ErrorCodes.INVALID_ARGUMENT);
  assert.equal(error.category, ErrorCategory.VALIDATION);
  assert.equal(error.severity, ErrorSeverity.WARNING);
  assert.deepEqual(error.metadata, { source: 'test' });
});

test('creates a timestamp automatically', () => {
  const error = new AppError('boom');

  assert.match(error.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('accepts optional metadata', () => {
  const error = new AppError('boom');

  assert.equal(error.metadata, undefined);
});

test('accepts optional cause', () => {
  const error = new AppError('boom', { cause: new Error('root') });

  assert.equal(error.cause instanceof Error, true);
});

test('preserves the original cause when wrapping', () => {
  const root = new Error('root cause');
  const wrapped = ErrorFactory.wrap(root, { code: ErrorCodes.OPERATION_FAILED });

  assert.equal(wrapped.cause, root);
  assert.equal(wrapped.code, ErrorCodes.OPERATION_FAILED);
});

test('creates an unknown error with the expected defaults', () => {
  const error = ErrorFactory.unknown('something unexpected');

  assert.equal(error.code, ErrorCodes.UNKNOWN_ERROR);
  assert.equal(error.category, ErrorCategory.UNKNOWN);
  assert.equal(error.severity, ErrorSeverity.ERROR);
  assert.equal(error.message, 'something unexpected');
});

test('exposes the expected severity values', () => {
  assert.equal(ErrorSeverity.INFO, 'INFO');
  assert.equal(ErrorSeverity.WARNING, 'WARNING');
  assert.equal(ErrorSeverity.ERROR, 'ERROR');
  assert.equal(ErrorSeverity.FATAL, 'FATAL');
});

test('exposes the expected category values', () => {
  assert.equal(ErrorCategory.SYSTEM, 'SYSTEM');
  assert.equal(ErrorCategory.PLUGIN, 'PLUGIN');
  assert.equal(ErrorCategory.LIFECYCLE, 'LIFECYCLE');
  assert.equal(ErrorCategory.CONTAINER, 'CONTAINER');
  assert.equal(ErrorCategory.EVENTBUS, 'EVENTBUS');
  assert.equal(ErrorCategory.VALIDATION, 'VALIDATION');
  assert.equal(ErrorCategory.UNKNOWN, 'UNKNOWN');
});

test('exposes the expected error codes', () => {
  assert.equal(ErrorCodes.UNKNOWN_ERROR, 'UNKNOWN_ERROR');
  assert.equal(ErrorCodes.INVALID_ARGUMENT, 'INVALID_ARGUMENT');
  assert.equal(ErrorCodes.INVALID_STATE, 'INVALID_STATE');
  assert.equal(ErrorCodes.NOT_FOUND, 'NOT_FOUND');
  assert.equal(ErrorCodes.ALREADY_EXISTS, 'ALREADY_EXISTS');
  assert.equal(ErrorCodes.OPERATION_FAILED, 'OPERATION_FAILED');
});

test('is an instance of Error and AppError', () => {
  const error = ErrorFactory.create('boom');

  assert.ok(error instanceof Error);
  assert.ok(error instanceof AppError);
});

test('serializes consistently to a plain object', () => {
  const error = ErrorFactory.create('boom', {
    code: ErrorCodes.NOT_FOUND,
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.ERROR,
    metadata: { foo: 'bar' },
  });

  const snapshot = error.toJSON();

  assert.deepEqual(snapshot, {
    name: 'AppError',
    message: 'boom',
    code: ErrorCodes.NOT_FOUND,
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.ERROR,
    metadata: { foo: 'bar' },
    cause: undefined,
    timestamp: error.timestamp,
  });
});

test('freezes metadata to preserve immutability', () => {
  const metadata = { retryable: true };
  const error = ErrorFactory.create('boom', { metadata });

  assert.equal(Object.isFrozen(error.metadata), true);
  assert.throws(() => {
    (error.metadata as Record<string, unknown>).retryable = false;
  }, TypeError);
});

test('wrap uses the provided message when the cause is not an Error', () => {
  const wrapped = ErrorFactory.wrap('plain string', { message: 'wrapped message' });

  assert.equal(wrapped.message, 'wrapped message');
  assert.equal(wrapped.cause, 'plain string');
});

test('wrap preserves a non-Error cause without crashing', () => {
  const wrapped = ErrorFactory.wrap({ detail: 'value' });

  assert.deepEqual(wrapped.cause, { detail: 'value' });
});

test('factory create delegates to AppError with the provided values', () => {
  const error = ErrorFactory.create('boom', {
    code: ErrorCodes.ALREADY_EXISTS,
    category: ErrorCategory.PLUGIN,
    severity: ErrorSeverity.FATAL,
  });

  assert.equal(error.code, ErrorCodes.ALREADY_EXISTS);
  assert.equal(error.category, ErrorCategory.PLUGIN);
  assert.equal(error.severity, ErrorSeverity.FATAL);
});

test('factory create keeps the message and timestamp visible in serialization', () => {
  const error = ErrorFactory.create('boom');
  const snapshot = error.toJSON();

  assert.equal(snapshot.message, 'boom');
  assert.equal(typeof snapshot.timestamp, 'string');
});
