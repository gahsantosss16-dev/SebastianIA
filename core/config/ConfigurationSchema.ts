import { ConfigurationValidationError, InvalidConfigurationKeyError, InvalidConfigurationSchemaError } from './ConfigurationErrors.js';

export interface ConfigurationSchema {
  readonly key: string;
  readonly required?: boolean;
  readonly defaultValue?: unknown;
  readonly validate: (value: unknown) => boolean;
  readonly description?: string;
}

export function createSchema(schema: ConfigurationSchema): ConfigurationSchema {
  if (typeof schema.key !== 'string' || schema.key.trim() === '') {
    throw new InvalidConfigurationKeyError('Configuration schema key must be a non-empty string');
  }

  if (typeof schema.validate !== 'function') {
    throw new InvalidConfigurationSchemaError('Configuration schema validate must be a function');
  }

  if (schema.required !== undefined && typeof schema.required !== 'boolean') {
    throw new InvalidConfigurationSchemaError('Configuration schema required must be a boolean when provided');
  }

  if (schema.defaultValue !== undefined && !schema.validate(schema.defaultValue)) {
    throw new ConfigurationValidationError('Configuration schema defaultValue does not satisfy the validator');
  }

  return Object.freeze({
    ...schema,
    required: schema.required ?? false,
  });
}
