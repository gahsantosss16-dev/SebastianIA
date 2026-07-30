import type { ConfigurationSchema } from './ConfigurationSchema.js';
import { createSchema } from './ConfigurationSchema.js';
import {
  ConfigurationSchemaAlreadyRegisteredError,
  ConfigurationValidationError,
  DuplicateConfigurationEntryError,
  InvalidConfigurationKeyError,
} from './ConfigurationErrors.js';
import { ConfigurationSource, type ConfigValue, type ConfigurationEntry } from './ConfigurationTypes.js';

export interface ValidationResult {
  readonly key: string;
  readonly valid: boolean;
  readonly message?: string | undefined;
}

export interface ValidationReport {
  readonly valid: boolean;
  readonly results: readonly ValidationResult[];
}

export interface ConfigurationEntryInput {
  readonly key: string;
  readonly value: ConfigValue;
}

export class ConfigurationManager {
  private readonly schemas = new Map<string, ConfigurationSchema>();
  private readonly values = new Map<string, ConfigurationEntry>();

  public registerSchema(schema: ConfigurationSchema): boolean {
    const normalized = createSchema(schema);
    this.assertValidKey(normalized.key);

    if (this.schemas.has(normalized.key)) {
      throw new ConfigurationSchemaAlreadyRegisteredError(`Schema '${normalized.key}' is already registered`);
    }

    this.schemas.set(normalized.key, normalized);
    return true;
  }

  public removeSchema(key: string): boolean {
    this.assertValidKey(key);
    return this.schemas.delete(key);
  }

  public getSchema(key: string): ConfigurationSchema | undefined {
    this.assertValidKey(key);
    const schema = this.schemas.get(key);
    return schema ? this.deepFreeze(schema) : undefined;
  }

  public listSchemas(): ConfigurationSchema[] {
    return Array.from(this.schemas.values()).map((schema) => this.deepFreeze(schema));
  }

  public set(key: string, value: ConfigValue, source: ConfigurationSource = ConfigurationSource.RUNTIME): boolean {
    this.assertValidKey(key);
    const schema = this.schemas.get(key);

    if (schema) {
      if (!this.validateAgainstSchema(schema, value)) {
        throw new ConfigurationValidationError(`Value for '${key}' does not satisfy the schema`);
      }
    }

    const entry: ConfigurationEntry = {
      key,
      value: this.deepFreeze(value),
      source,
      registeredAt: new Date().toISOString(),
    };

    this.values.set(key, entry);
    return true;
  }

  public setMany(entries: readonly ConfigurationEntryInput[], source: ConfigurationSource = ConfigurationSource.RUNTIME): boolean {
    const duplicates = new Set<string>();
    const seen = new Set<string>();

    for (const entry of entries) {
      this.assertValidKey(entry.key);
      if (seen.has(entry.key)) {
        throw new DuplicateConfigurationEntryError(`Duplicate configuration key '${entry.key}' in batch`);
      }
      seen.add(entry.key);
    }

    const validated: Array<{ key: string; value: ConfigValue }> = [];

    for (const entry of entries) {
      const schema = this.schemas.get(entry.key);
      if (schema && !this.validateAgainstSchema(schema, entry.value)) {
        throw new ConfigurationValidationError(`Value for '${entry.key}' does not satisfy the schema`);
      }
      validated.push({ key: entry.key, value: entry.value });
    }

    for (const entry of validated) {
      this.values.set(entry.key, {
        key: entry.key,
        value: this.deepFreeze(entry.value),
        source,
        registeredAt: new Date().toISOString(),
      });
    }

    return true;
  }

  public get(key: string): ConfigValue | undefined {
    this.assertValidKey(key);
    const entry = this.values.get(key);
    return entry ? this.cloneValue(entry.value) : undefined;
  }

  public getEntry(key: string): ConfigurationEntry | undefined {
    this.assertValidKey(key);
    const entry = this.values.get(key);
    return entry ? this.deepFreezeEntry(entry) : undefined;
  }

  public has(key: string): boolean {
    this.assertValidKey(key);
    return this.values.has(key);
  }

  public remove(key: string): boolean {
    this.assertValidKey(key);
    return this.values.delete(key);
  }

  public clear(): void {
    this.values.clear();
  }

  public validate(key: string): boolean {
    this.assertValidKey(key);
    const schema = this.schemas.get(key);
    if (!schema) {
      return true;
    }

    const value = this.values.get(key)?.value;
    if (value !== undefined) {
      return this.validateAgainstSchema(schema, value);
    }

    if (schema.required) {
      return false;
    }

    if (schema.defaultValue !== undefined) {
      return this.validateAgainstSchema(schema, schema.defaultValue);
    }

    return true;
  }

  public validateAll(): ValidationReport {
    const results: ValidationResult[] = [];

    for (const schema of this.schemas.values()) {
      const valid = this.validate(schema.key);
      results.push({
        key: schema.key,
        valid,
        message: valid ? undefined : `Validation failed for '${schema.key}'`,
      });
    }

    return {
      valid: results.every((result) => result.valid),
      results,
    };
  }

  public resolve(key: string): ConfigValue | undefined {
    this.assertValidKey(key);
    const explicit = this.values.get(key)?.value;
    if (explicit !== undefined) {
      const schema = this.schemas.get(key);
      if (schema && !this.validateAgainstSchema(schema, explicit)) {
        throw new ConfigurationValidationError(`Explicit value for '${key}' is invalid`);
      }
      return this.cloneValue(explicit);
    }

    const schema = this.schemas.get(key);
    if (!schema) {
      return undefined;
    }

    if (schema.defaultValue !== undefined) {
      const defaultValue = schema.defaultValue as ConfigValue;
      if (!this.validateAgainstSchema(schema, defaultValue)) {
        throw new ConfigurationValidationError(`Default value for '${key}' is invalid`);
      }
      return this.cloneValue(defaultValue);
    }

    return undefined;
  }

  private assertValidKey(key: string): void {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new InvalidConfigurationKeyError('Configuration key must be a non-empty string');
    }
  }

  private validateAgainstSchema(schema: ConfigurationSchema, value: unknown): boolean {
    return schema.validate(value);
  }

  private deepFreezeEntry(entry: ConfigurationEntry): ConfigurationEntry {
    return Object.freeze({
      key: entry.key,
      value: this.deepFreeze(entry.value),
      source: entry.source,
      registeredAt: entry.registeredAt,
    });
  }

  private deepFreeze<T>(value: T): T {
    if (Array.isArray(value)) {
      const frozenItems = value.map((item) => this.deepFreeze(item));
      return Object.freeze(frozenItems) as T;
    }

    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, this.deepFreeze(v)] as const);
      const frozenObject = Object.fromEntries(entries);
      return Object.freeze(frozenObject) as T;
    }

    return value;
  }

  private cloneValue(value: ConfigValue): ConfigValue {
    if (Array.isArray(value)) {
      return value.map((item) => this.cloneValue(item)) as ConfigValue;
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, ConfigValue>).map(([key, item]) => [key, this.cloneValue(item)]));
    }

    return value;
  }
}
