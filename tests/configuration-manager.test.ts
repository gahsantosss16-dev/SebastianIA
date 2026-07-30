import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConfigurationManager,
  ConfigurationSource,
  ConfigurationValidationError,
  ConfigurationSchemaAlreadyRegisteredError,
  DuplicateConfigurationEntryError,
  InvalidConfigurationKeyError,
  InvalidConfigurationSchemaError,
  type ConfigurationSchema,
} from '../core/config/index.js';

test('registers a valid schema', () => {
  const manager = new ConfigurationManager();
  const schema: ConfigurationSchema = {
    key: 'feature.enabled',
    validate: (value) => typeof value === 'boolean',
  };

  assert.equal(manager.registerSchema(schema), true);
  assert.equal(manager.getSchema('feature.enabled')?.key, 'feature.enabled');
});

test('rejects a duplicated schema', () => {
  const manager = new ConfigurationManager();
  const schema: ConfigurationSchema = {
    key: 'feature.enabled',
    validate: (value) => typeof value === 'boolean',
  };

  manager.registerSchema(schema);
  assert.throws(() => manager.registerSchema(schema), ConfigurationSchemaAlreadyRegisteredError);
});

test('rejects an empty schema key', () => {
  const manager = new ConfigurationManager();
  const schema: ConfigurationSchema = {
    key: '   ',
    validate: () => true,
  };

  assert.throws(() => manager.registerSchema(schema), InvalidConfigurationKeyError);
});

test('rejects an invalid validate function', () => {
  const manager = new ConfigurationManager();
  const schema = {
    key: 'feature.enabled',
    validate: 'bad' as unknown as (value: unknown) => boolean,
  };

  assert.throws(() => manager.registerSchema(schema as ConfigurationSchema), InvalidConfigurationSchemaError);
});

test('removes a schema', () => {
  const manager = new ConfigurationManager();
  manager.registerSchema({ key: 'feature.enabled', validate: () => true });

  assert.equal(manager.removeSchema('feature.enabled'), true);
  assert.equal(manager.getSchema('feature.enabled'), undefined);
});

test('gets a schema by key', () => {
  const manager = new ConfigurationManager();
  const schema: ConfigurationSchema = { key: 'feature.flag', validate: () => true };

  manager.registerSchema(schema);
  const result = manager.getSchema('feature.flag');

  assert.ok(result);
  assert.equal(result?.key, 'feature.flag');
});

test('lists schemas in registration order', () => {
  const manager = new ConfigurationManager();
  manager.registerSchema({ key: 'first', validate: () => true });
  manager.registerSchema({ key: 'second', validate: () => true });

  assert.deepEqual(manager.listSchemas().map((schema) => schema.key), ['first', 'second']);
});

test('listSchemas does not allow mutation of the internal registry', () => {
  const manager = new ConfigurationManager();
  manager.registerSchema({ key: 'first', validate: () => true });

  const schemas = manager.listSchemas();
  schemas.pop();

  assert.equal(manager.listSchemas().length, 1);
});

test('stores a configuration without a schema', () => {
  const manager = new ConfigurationManager();

  assert.equal(manager.set('app.name', 'Sebastian IA'), true);
  assert.equal(manager.get('app.name'), 'Sebastian IA');
});

test('uses RUNTIME as the default source', () => {
  const manager = new ConfigurationManager();
  manager.set('app.name', 'Sebastian IA');

  assert.equal(manager.getEntry('app.name')?.source, ConfigurationSource.RUNTIME);
});

test('stores an explicit source', () => {
  const manager = new ConfigurationManager();
  manager.set('app.mode', 'production', ConfigurationSource.ENVIRONMENT);

  assert.equal(manager.getEntry('app.mode')?.source, ConfigurationSource.ENVIRONMENT);
});

test('replaces an existing configuration', () => {
  const manager = new ConfigurationManager();
  manager.set('app.mode', 'development');
  manager.set('app.mode', 'production');

  assert.equal(manager.get('app.mode'), 'production');
});

test('rejects an empty key in set', () => {
  const manager = new ConfigurationManager();
  assert.throws(() => manager.set('   ', 'value'), InvalidConfigurationKeyError);
});

test('validates a value when a schema exists', () => {
  const manager = new ConfigurationManager();
  manager.registerSchema({ key: 'feature.enabled', validate: (value) => typeof value === 'boolean' });

  assert.equal(manager.set('feature.enabled', true), true);
});

test('rejects an invalid value without altering the previous value', () => {
  const manager = new ConfigurationManager();
  manager.registerSchema({ key: 'feature.enabled', validate: (value) => typeof value === 'boolean' });
  manager.set('feature.enabled', true);

  assert.throws(() => manager.set('feature.enabled', 'yes'), ConfigurationValidationError);
  assert.equal(manager.get('feature.enabled'), true);
});

test('gets a stored value', () => {
  const manager = new ConfigurationManager();
  manager.set('app.name', 'Sebastian IA');

  assert.equal(manager.get('app.name'), 'Sebastian IA');
});

test('gets a full entry', () => {
  const manager = new ConfigurationManager();
  manager.set('app.name', 'Sebastian IA');

  const entry = manager.getEntry('app.name');
  assert.ok(entry);
  assert.equal(entry?.value, 'Sebastian IA');
});

test('has reports whether a value is stored', () => {
  const manager = new ConfigurationManager();
  manager.set('app.name', 'Sebastian IA');

  assert.equal(manager.has('app.name'), true);
  assert.equal(manager.has('missing'), false);
});

test('removes a value without removing the schema', () => {
  const manager = new ConfigurationManager();
  manager.registerSchema({ key: 'feature.enabled', validate: () => true });
  manager.set('feature.enabled', true);

  assert.equal(manager.remove('feature.enabled'), true);
  assert.equal(manager.get('feature.enabled'), undefined);
  assert.equal(manager.getSchema('feature.enabled')?.key, 'feature.enabled');
});

test('clear removes values without removing schemas', () => {
  const manager = new ConfigurationManager();
  manager.registerSchema({ key: 'feature.enabled', validate: () => true });
  manager.set('feature.enabled', true);

  manager.clear();

  assert.equal(manager.has('feature.enabled'), false);
  assert.equal(manager.getSchema('feature.enabled')?.key, 'feature.enabled');
});

test('setMany applies a valid batch atomically', () => {
  const manager = new ConfigurationManager();
  manager.registerSchema({ key: 'feature.enabled', validate: (value) => typeof value === 'boolean' });

  const result = manager.setMany([
    { key: 'feature.enabled', value: true },
    { key: 'app.name', value: 'Sebastian IA' },
  ]);

  assert.equal(result, true);
  assert.equal(manager.get('feature.enabled'), true);
  assert.equal(manager.get('app.name'), 'Sebastian IA');
});

test('setMany is atomic when one entry fails', () => {
  const manager = new ConfigurationManager();
  manager.registerSchema({ key: 'feature.enabled', validate: (value) => typeof value === 'boolean' });
  manager.registerSchema({ key: 'app.name', validate: (value) => typeof value === 'string' });
  manager.set('app.name', 'initial');

  assert.throws(() => manager.setMany([
    { key: 'feature.enabled', value: true },
    { key: 'app.name', value: 42 as unknown as string },
  ]), ConfigurationValidationError);

  assert.equal(manager.get('feature.enabled'), undefined);
  assert.equal(manager.get('app.name'), 'initial');
});

test('setMany rejects duplicate keys within the same batch', () => {
  const manager = new ConfigurationManager();

  assert.throws(() => manager.setMany([
    { key: 'a', value: 1 },
    { key: 'a', value: 2 },
  ]), DuplicateConfigurationEntryError);
});

test('setMany stores all provided entries', () => {
  const manager = new ConfigurationManager();
  manager.setMany([
    { key: 'first', value: 'one' },
    { key: 'second', value: 'two' },
  ]);

  assert.equal(manager.get('first'), 'one');
  assert.equal(manager.get('second'), 'two');
});

test('resolve returns the explicit value', () => {
  const manager = new ConfigurationManager();
  manager.set('app.name', 'Sebastian IA');

  assert.equal(manager.resolve('app.name'), 'Sebastian IA');
});

test('resolve returns the default value', () => {
  const manager = new ConfigurationManager();
  manager.registerSchema({ key: 'feature.enabled', defaultValue: true, validate: (value) => typeof value === 'boolean' });

  assert.equal(manager.resolve('feature.enabled'), true);
});

test('resolve returns undefined when no value or default exists', () => {
  const manager = new ConfigurationManager();

  assert.equal(manager.resolve('missing'), undefined);
});

test('resolve rejects an explicit invalid value', () => {
  const manager = new ConfigurationManager();
  manager.registerSchema({ key: 'feature.enabled', validate: (value) => typeof value === 'boolean' });
  manager.set('feature.enabled', true);

  assert.throws(() => manager.set('feature.enabled', 'bad'), ConfigurationValidationError);
});

test('resolve rejects an invalid default value', () => {
  const manager = new ConfigurationManager();

  assert.throws(() => {
    manager.registerSchema({ key: 'feature.enabled', defaultValue: 'bad' as unknown as boolean, validate: (value) => typeof value === 'boolean' });
  }, ConfigurationValidationError);
});

test('validate returns true without a schema', () => {
  const manager = new ConfigurationManager();

  assert.equal(manager.validate('missing'), true);
});

test('validate recognizes a missing required value', () => {
  const manager = new ConfigurationManager();
  manager.registerSchema({ key: 'feature.enabled', required: true, validate: (value) => typeof value === 'boolean' });

  assert.equal(manager.validate('feature.enabled'), false);
});

test('validate accepts a valid default without applying it', () => {
  const manager = new ConfigurationManager();
  manager.registerSchema({ key: 'feature.enabled', defaultValue: true, validate: (value) => typeof value === 'boolean' });

  assert.equal(manager.validate('feature.enabled'), true);
  assert.equal(manager.has('feature.enabled'), false);
});

test('validateAll returns every validation result', () => {
  const manager = new ConfigurationManager();
  manager.registerSchema({ key: 'first', required: true, validate: () => true });
  manager.registerSchema({ key: 'second', required: true, validate: () => false });

  const report = manager.validateAll();
  assert.equal(report.valid, false);
  assert.equal(report.results.length, 2);
  assert.ok(report.results[1]);
  assert.equal(report.results[1].valid, false);
});

test('validateAll does not stop on the first failure', () => {
  const manager = new ConfigurationManager();
  manager.registerSchema({ key: 'first', validate: () => false });
  manager.registerSchema({ key: 'second', validate: () => false });

  const report = manager.validateAll();
  assert.equal(report.results.length, 2);
});

test('nested values cannot mutate the internal state', () => {
  const manager = new ConfigurationManager();
  manager.set('app', { nested: { enabled: true } });

  const value = manager.get('app') as Record<string, unknown>;
  (value.nested as Record<string, unknown>).enabled = false;

  const nested = manager.get('app') as Record<string, unknown>;
  assert.equal((nested.nested as Record<string, unknown>).enabled, true);
});

test('get does not expose a mutable reference', () => {
  const manager = new ConfigurationManager();
  manager.set('app', { nested: ['one'] });

  const value = manager.get('app') as Record<string, unknown>;
  (value.nested as Array<string>).push('two');

  assert.deepEqual(manager.get('app'), { nested: ['one'] });
});

test('getEntry does not expose a mutable reference', () => {
  const manager = new ConfigurationManager();
  manager.set('app', { nested: ['one'] });

  const entry = manager.getEntry('app');
  const value = entry?.value as Record<string, unknown>;

  assert.throws(() => {
    (value.nested as Array<string>).push('two');
  }, TypeError);

  assert.deepEqual((manager.getEntry('app')?.value as Record<string, unknown>), { nested: ['one'] });
});

test('schemas returned do not expose internal state', () => {
  const manager = new ConfigurationManager();
  manager.registerSchema({ key: 'feature.enabled', defaultValue: true, validate: (value) => typeof value === 'boolean' });

  const schema = manager.getSchema('feature.enabled');
  assert.ok(schema);
  assert.equal(schema?.defaultValue, true);
});

test('registeredAt is created automatically', () => {
  const manager = new ConfigurationManager();
  manager.set('app.name', 'Sebastian IA');

  assert.match(manager.getEntry('app.name')?.registeredAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
});

test('two configuration managers remain isolated', () => {
  const first = new ConfigurationManager();
  const second = new ConfigurationManager();

  first.set('app.name', 'Sebastian IA');

  assert.equal(first.get('app.name'), 'Sebastian IA');
  assert.equal(second.get('app.name'), undefined);
});
