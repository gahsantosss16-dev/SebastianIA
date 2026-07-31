import assert from 'node:assert/strict';
import test from 'node:test';

import { ErrorCodes } from '../core/errors/index.js';
import { InvalidMemoryKeyError, InvalidMemoryNamespaceError, MemoryManager } from '../core/memory/index.js';

test('stores and retrieves values in a namespace', async () => {
  const manager = new MemoryManager();

  await manager.set('conversation', 'greeting', 'hello');

  assert.equal(await manager.get('conversation', 'greeting'), 'hello');
  assert.equal(await manager.has('conversation', 'greeting'), true);
  assert.equal(await manager.size(), 1);
});

test('isolates namespaces that share the same key', async () => {
  const manager = new MemoryManager();

  await manager.set('conversation', 'topic', 'chat');
  await manager.set('runtime', 'topic', 'system');

  assert.equal(await manager.get('conversation', 'topic'), 'chat');
  assert.equal(await manager.get('runtime', 'topic'), 'system');
  assert.equal(await manager.size(), 2);
});

test('overwrites an existing key without increasing size', async () => {
  const manager = new MemoryManager();

  await manager.set('conversation', 'topic', 'first');
  await manager.set('conversation', 'topic', 'second');

  assert.equal(await manager.get('conversation', 'topic'), 'second');
  assert.equal(await manager.size(), 1);
});

test('returns undefined for missing values and false for missing existence', async () => {
  const manager = new MemoryManager();

  assert.equal(await manager.get('conversation', 'missing'), undefined);
  assert.equal(await manager.has('conversation', 'missing'), false);
});

test('remove returns true only for an existing entry and reduces size', async () => {
  const manager = new MemoryManager();

  await manager.set('conversation', 'topic', 'chat');

  assert.equal(await manager.remove('conversation', 'topic'), true);
  assert.equal(await manager.remove('conversation', 'topic'), false);
  assert.equal(await manager.has('conversation', 'topic'), false);
  assert.equal(await manager.size(), 0);
});

test('clearNamespace removes only the target namespace and preserves the rest', async () => {
  const manager = new MemoryManager();

  await manager.set('conversation', 'topic', 'chat');
  await manager.set('runtime', 'status', 'ready');

  await manager.clearNamespace('conversation');

  assert.equal(await manager.has('conversation', 'topic'), false);
  assert.equal(await manager.get('runtime', 'status'), 'ready');
  assert.equal(await manager.size(), 1);
});

test('clearNamespace on a missing namespace does not throw and does not alter state', async () => {
  const manager = new MemoryManager();

  await manager.set('conversation', 'topic', 'chat');

  await assert.doesNotReject(() => manager.clearNamespace('missing'));
  assert.equal(await manager.size(), 1);
});

test('clear removes everything from the instance', async () => {
  const manager = new MemoryManager();

  await manager.set('conversation', 'topic', 'chat');
  await manager.set('runtime', 'status', 'ready');

  await manager.clear();

  assert.equal(await manager.size(), 0);
  assert.equal(await manager.has('conversation', 'topic'), false);
  assert.equal(await manager.has('runtime', 'status'), false);
});

test('rejects a namespace containing only spaces in set, get, has, remove and clearNamespace', async () => {
  const manager = new MemoryManager();

  await assert.rejects(() => manager.set('   ', 'key', 'value'), InvalidMemoryNamespaceError);
  await assert.rejects(() => manager.get('   ', 'key'), InvalidMemoryNamespaceError);
  await assert.rejects(() => manager.has('   ', 'key'), InvalidMemoryNamespaceError);
  await assert.rejects(() => manager.remove('   ', 'key'), InvalidMemoryNamespaceError);
  await assert.rejects(() => manager.clearNamespace('   '), InvalidMemoryNamespaceError);
});

test('rejects a key containing only spaces in set, get, has, remove and clearNamespace', async () => {
  const manager = new MemoryManager();

  await assert.rejects(() => manager.set('ns', '   ', 'value'), InvalidMemoryKeyError);
  await assert.rejects(() => manager.get('ns', '   '), InvalidMemoryKeyError);
  await assert.rejects(() => manager.has('ns', '   '), InvalidMemoryKeyError);
  await assert.rejects(() => manager.remove('ns', '   '), InvalidMemoryKeyError);
});

test('protects stored values from external mutation for objects, arrays and nested structures', async () => {
  const manager = new MemoryManager();
  const payload = { nested: { enabled: true }, list: ['one'] };

  await manager.set('conversation', 'state', payload);

  payload.nested.enabled = false;
  payload.list.push('two');

  const stored = await manager.get('conversation', 'state');

  assert.deepEqual(stored, { nested: { enabled: true }, list: ['one'] });
  assert.equal((stored as { nested: { enabled: boolean } }).nested.enabled, true);
});

test('protects stored values from mutation through the returned reference', async () => {
  const manager = new MemoryManager();
  const payload = { nested: { enabled: true }, list: ['one'] };

  await manager.set('conversation', 'state', payload);

  const retrieved = await manager.get('conversation', 'state') as { nested: { enabled: boolean }; list: string[] };
  retrieved.nested.enabled = false;
  retrieved.list.push('two');

  const stored = await manager.get('conversation', 'state') as { nested: { enabled: boolean }; list: string[] };
  assert.equal(stored.nested.enabled, true);
  assert.deepEqual(stored.list, ['one']);
});

test('supports storing undefined values while distinguishing existence with has', async () => {
  const manager = new MemoryManager();

  await manager.set('conversation', 'empty', undefined);

  assert.equal(await manager.has('conversation', 'empty'), true);
  assert.equal(await manager.get('conversation', 'empty'), undefined);
  assert.equal(await manager.size(), 1);
});

test('preserves Date values through structuredClone', async () => {
  const manager = new MemoryManager();
  const value = new Date('2024-01-02T03:04:05.000Z');

  await manager.set('conversation', 'date', value);

  const stored = await manager.get('conversation', 'date') as Date;
  assert.ok(stored instanceof Date);
  assert.equal(stored.toISOString(), value.toISOString());

  stored.setDate(10);
  assert.equal((await manager.get('conversation', 'date') as Date).toISOString(), value.toISOString());
});

test('preserves Map values through structuredClone', async () => {
  const manager = new MemoryManager();
  const value = new Map<string, number>([['one', 1]]);

  await manager.set('conversation', 'map', value);

  const stored = await manager.get('conversation', 'map') as Map<string, number>;
  assert.ok(stored instanceof Map);
  assert.equal(stored.get('one'), 1);

  stored.set('two', 2);
  assert.equal((await manager.get('conversation', 'map') as Map<string, number>).has('two'), false);
});

test('preserves Set values through structuredClone', async () => {
  const manager = new MemoryManager();
  const value = new Set(['one']);

  await manager.set('conversation', 'set', value);

  const stored = await manager.get('conversation', 'set') as Set<string>;
  assert.ok(stored instanceof Set);
  assert.equal(stored.has('one'), true);

  stored.add('two');
  assert.equal((await manager.get('conversation', 'set') as Set<string>).has('two'), false);
});

test('preserves RegExp values through structuredClone', async () => {
  const manager = new MemoryManager();
  const value = /hello/gi;

  await manager.set('conversation', 'regexp', value);

  const stored = await manager.get('conversation', 'regexp') as RegExp;
  assert.ok(stored instanceof RegExp);
  assert.equal(stored.source, 'hello');
  assert.equal(stored.flags, 'gi');

  stored.lastIndex = 3;
  assert.equal((await manager.get('conversation', 'regexp') as RegExp).lastIndex, 0);
});

test('preserves circular references through structuredClone', async () => {
  const manager = new MemoryManager();
  const value: Record<string, unknown> = { name: 'root' };
  value.self = value;

  await manager.set('conversation', 'circular', value);

  const stored = await manager.get('conversation', 'circular') as Record<string, unknown>;
  assert.equal(stored.name, 'root');
  assert.equal(stored.self, stored);

  (value.self as Record<string, unknown>).name = 'mutated';
  assert.equal((await manager.get('conversation', 'circular') as Record<string, unknown>).name, 'root');
});

test('rejects unsupported values without silently converting them', async () => {
  const manager = new MemoryManager();

  await assert.rejects(() => manager.set('conversation', 'callback', () => undefined), /could not be cloned/);
});

test('uses INVALID_ARGUMENT for invalid namespace and key errors', async () => {
  const manager = new MemoryManager();

  try {
    await manager.set('   ', 'key', 'value');
    assert.fail('Expected invalid namespace error');
  } catch (error) {
    assert.equal((error as Error & { code?: string }).code, ErrorCodes.INVALID_ARGUMENT);
  }

  try {
    await manager.get('ns', '   ');
    assert.fail('Expected invalid key error');
  } catch (error) {
    assert.equal((error as Error & { code?: string }).code, ErrorCodes.INVALID_ARGUMENT);
  }
});

test('keeps two memory managers isolated', async () => {
  const first = new MemoryManager();
  const second = new MemoryManager();

  await first.set('conversation', 'topic', 'chat');

  assert.equal(await first.get('conversation', 'topic'), 'chat');
  assert.equal(await second.get('conversation', 'topic'), undefined);
});

test('supports sequential awaited operations with predictable results', async () => {
  const manager = new MemoryManager();

  await manager.set('conversation', 'topic', 'first');
  await manager.set('conversation', 'topic', 'second');
  await manager.remove('conversation', 'topic');

  assert.equal(await manager.has('conversation', 'topic'), false);
  assert.equal(await manager.size(), 0);
});
