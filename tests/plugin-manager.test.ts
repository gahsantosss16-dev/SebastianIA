import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InvalidPluginError,
  InvalidPluginStateError,
  PluginActivationError,
  PluginAggregateError,
  PluginAlreadyRegisteredError,
  PluginDeactivationError,
  PluginManager,
  type Plugin,
  type PluginContext,
} from '../core/plugins/index.js';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

class TestPlugin implements Plugin {
  public readonly id: string;
  public readonly name: string;
  public readonly version: string;
  public readonly description?: string | undefined;

  public activateCalls: PluginContext[] = [];
  public deactivateCalls = 0;

  public constructor(id: string, name: string, version: string, description?: string) {
    this.id = id;
    this.name = name;
    this.version = version;
    this.description = description;
  }

  public async activate(context: PluginContext): Promise<void> {
    this.activateCalls.push(context);
  }

  public async deactivate(): Promise<void> {
    this.deactivateCalls += 1;
  }
}

test('registers a valid plugin', () => {
  const manager = new PluginManager();
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');

  manager.register(plugin);

  assert.equal(manager.isRegistered('alpha'), true);
  assert.equal(manager.getState('alpha'), 'registered');
  assert.equal(manager.getMetadata('alpha')?.name, 'Alpha');
});

test('rejects a duplicated identifier', () => {
  const manager = new PluginManager();
  manager.register(new TestPlugin('alpha', 'Alpha', '1.0.0'));

  assert.throws(() => manager.register(new TestPlugin('alpha', 'Alpha', '1.0.1')), PluginAlreadyRegisteredError);
});

test('rejects invalid metadata', () => {
  const manager = new PluginManager();

  assert.throws(() => manager.register(new TestPlugin('', 'Alpha', '1.0.0')), InvalidPluginError);
  assert.throws(() => manager.register(new TestPlugin('alpha', '', '1.0.0')), InvalidPluginError);
  assert.throws(() => manager.register(new TestPlugin('alpha', 'Alpha', '')), InvalidPluginError);
});

test('queries a plugin by identifier', () => {
  const manager = new PluginManager();
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');

  manager.register(plugin);

  assert.equal(manager.get('alpha'), plugin);
  assert.equal(manager.get('missing'), undefined);
});

test('lists plugins preserving the registration order', () => {
  const manager = new PluginManager();
  manager.register(new TestPlugin('first', 'First', '1.0.0'));
  manager.register(new TestPlugin('second', 'Second', '1.0.0'));

  assert.deepEqual(manager.list().map((entry) => entry.id), ['first', 'second']);
});

test('list returns a copy that does not mutate the internal registry', () => {
  const manager = new PluginManager();
  manager.register(new TestPlugin('first', 'First', '1.0.0'));
  manager.register(new TestPlugin('second', 'Second', '1.0.0'));

  const snapshot = manager.list();
  snapshot.push({ id: 'third', name: 'Third', version: '1.0.0', state: 'registered' });

  assert.equal(manager.list().length, 2);
  assert.equal(manager.isRegistered('third'), false);
});

test('uses registered as the initial state after registration', () => {
  const manager = new PluginManager();
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');

  manager.register(plugin);

  assert.equal(manager.getState('alpha'), 'registered');
});

test('activates a plugin successfully', async () => {
  const manager = new PluginManager();
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');
  const context: PluginContext = { metadata: { source: 'test' } };

  manager.register(plugin);
  await manager.activate('alpha', context);

  assert.equal(manager.getState('alpha'), 'active');
  assert.equal(plugin.activateCalls[0], context);
});

test('passes the provided context to the plugin activation', async () => {
  const manager = new PluginManager();
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');
  const context: PluginContext = { serviceContainer: { resolve: () => 'ok' } };

  manager.register(plugin);
  await manager.activate('alpha', context);

  assert.equal(plugin.activateCalls[0], context);
});

test('blocks duplicate activation according to the documented policy', async () => {
  const manager = new PluginManager();
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');

  manager.register(plugin);
  await manager.activate('alpha');

  await assert.rejects(() => manager.activate('alpha'), InvalidPluginStateError);
});

test('marks a plugin as failed when activation fails', async () => {
  const manager = new PluginManager();
  const originalError = new Error('activation failed');
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');

  plugin.activate = async () => {
    throw originalError;
  };

  manager.register(plugin);

  await assert.rejects(() => manager.activate('alpha'), PluginActivationError);
  assert.equal(manager.getState('alpha'), 'failed');
});

test('preserves the original cause for activation failures', async () => {
  const manager = new PluginManager();
  const originalError = new Error('activation failed');
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');

  plugin.activate = async () => {
    throw originalError;
  };

  manager.register(plugin);

  await assert.rejects(async () => {
    await manager.activate('alpha');
  }, (error: unknown) => {
    assert.ok(error instanceof PluginActivationError);
    assert.equal((error as PluginActivationError).cause, originalError);
    return true;
  });
});

test('deactivates a plugin successfully', async () => {
  const manager = new PluginManager();
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');

  manager.register(plugin);
  await manager.activate('alpha');
  await manager.deactivate('alpha');

  assert.equal(manager.getState('alpha'), 'inactive');
  assert.equal(plugin.deactivateCalls, 1);
});

test('marks a plugin as failed when deactivation fails', async () => {
  const manager = new PluginManager();
  const originalError = new Error('deactivation failed');
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');

  plugin.deactivate = async () => {
    throw originalError;
  };

  manager.register(plugin);
  await manager.activate('alpha');

  await assert.rejects(() => manager.deactivate('alpha'), PluginDeactivationError);
  assert.equal(manager.getState('alpha'), 'failed');
});

test('preserves the original cause for deactivation failures', async () => {
  const manager = new PluginManager();
  const originalError = new Error('deactivation failed');
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');

  plugin.deactivate = async () => {
    throw originalError;
  };

  manager.register(plugin);
  await manager.activate('alpha');

  await assert.rejects(async () => {
    await manager.deactivate('alpha');
  }, (error: unknown) => {
    assert.ok(error instanceof PluginDeactivationError);
    assert.equal((error as PluginDeactivationError).cause, originalError);
    return true;
  });
});

test('activateAll follows the registration order', async () => {
  const manager = new PluginManager();
  const calls: string[] = [];
  const first = new TestPlugin('first', 'First', '1.0.0');
  const second = new TestPlugin('second', 'Second', '1.0.0');
  const third = new TestPlugin('third', 'Third', '1.0.0');

  first.activate = async () => { calls.push('first'); };
  second.activate = async () => { calls.push('second'); };
  third.activate = async () => { calls.push('third'); };

  manager.register(first);
  manager.register(second);
  manager.register(third);

  await manager.activateAll();

  assert.deepEqual(calls, ['first', 'second', 'third']);
  assert.equal(manager.getState('third'), 'active');
});

test('activateAll stops at the first failing plugin', async () => {
  const manager = new PluginManager();
  const calls: string[] = [];
  const first = new TestPlugin('first', 'First', '1.0.0');
  const second = new TestPlugin('second', 'Second', '1.0.0');
  const third = new TestPlugin('third', 'Third', '1.0.0');

  first.activate = async () => { calls.push('first'); };
  second.activate = async () => { calls.push('second'); throw new Error('boom'); };
  third.activate = async () => { calls.push('third'); };

  manager.register(first);
  manager.register(second);
  manager.register(third);

  await assert.rejects(() => manager.activateAll(), PluginActivationError);
  assert.deepEqual(calls, ['first', 'second']);
  assert.equal(manager.getState('first'), 'inactive');
  assert.equal(manager.getState('second'), 'failed');
  assert.equal(manager.getState('third'), 'registered');
});

test('activateAll rollback runs in reverse activation order', async () => {
  const manager = new PluginManager();
  const calls: string[] = [];
  const first = new TestPlugin('first', 'First', '1.0.0');
  const second = new TestPlugin('second', 'Second', '1.0.0');
  const third = new TestPlugin('third', 'Third', '1.0.0');

  first.activate = async () => { calls.push('activate:first'); };
  first.deactivate = async () => { calls.push('deactivate:first'); };
  second.activate = async () => { calls.push('activate:second'); };
  second.deactivate = async () => { calls.push('deactivate:second'); };
  third.activate = async () => { calls.push('activate:third'); throw new Error('boom'); };
  third.deactivate = async () => { calls.push('deactivate:third'); };

  manager.register(first);
  manager.register(second);
  manager.register(third);

  await assert.rejects(() => manager.activateAll(), PluginActivationError);

  assert.deepEqual(calls, ['activate:first', 'activate:second', 'activate:third', 'deactivate:second', 'deactivate:first']);
  assert.equal(manager.getState('first'), 'inactive');
  assert.equal(manager.getState('second'), 'inactive');
  assert.equal(manager.getState('third'), 'failed');
});

test('activateAll rolls back only the plugins activated during the current operation', async () => {
  const manager = new PluginManager();
  const calls: string[] = [];
  const first = new TestPlugin('first', 'First', '1.0.0');
  const second = new TestPlugin('second', 'Second', '1.0.0');
  const third = new TestPlugin('third', 'Third', '1.0.0');

  first.activate = async () => { calls.push('activate:first'); };
  first.deactivate = async () => { calls.push('deactivate:first'); };
  second.activate = async () => { calls.push('activate:second'); throw new Error('boom'); };
  second.deactivate = async () => { calls.push('deactivate:second'); };
  third.activate = async () => { calls.push('activate:third'); };
  third.deactivate = async () => { calls.push('deactivate:third'); };

  manager.register(first);
  manager.register(second);
  manager.register(third);
  await manager.activate('first');

  await assert.rejects(() => manager.activateAll(), PluginActivationError);

  assert.deepEqual(calls, ['activate:first', 'activate:second']);
  assert.equal(manager.getState('first'), 'active');
  assert.equal(manager.getState('second'), 'failed');
  assert.equal(manager.getState('third'), 'registered');
});

test('deactivateAll follows the reverse registration order', async () => {
  const manager = new PluginManager();
  const calls: string[] = [];
  const first = new TestPlugin('first', 'First', '1.0.0');
  const second = new TestPlugin('second', 'Second', '1.0.0');
  const third = new TestPlugin('third', 'Third', '1.0.0');

  first.deactivate = async () => { calls.push('first'); };
  second.deactivate = async () => { calls.push('second'); };
  third.deactivate = async () => { calls.push('third'); };

  manager.register(first);
  manager.register(second);
  manager.register(third);
  await manager.activateAll();
  await manager.deactivateAll();

  assert.deepEqual(calls, ['third', 'second', 'first']);
});

test('deactivateAll continues after a failed deactivation', async () => {
  const manager = new PluginManager();
  const calls: string[] = [];
  const first = new TestPlugin('first', 'First', '1.0.0');
  const second = new TestPlugin('second', 'Second', '1.0.0');
  const third = new TestPlugin('third', 'Third', '1.0.0');

  first.deactivate = async () => { calls.push('first'); throw new Error('first failed'); };
  second.deactivate = async () => { calls.push('second'); };
  third.deactivate = async () => { calls.push('third'); };

  manager.register(first);
  manager.register(second);
  manager.register(third);
  await manager.activateAll();

  await assert.rejects(() => manager.deactivateAll(), PluginAggregateError);
  assert.deepEqual(calls, ['third', 'second', 'first']);
});

test('deactivateAll aggregates multiple deactivation errors', async () => {
  const manager = new PluginManager();
  const first = new TestPlugin('first', 'First', '1.0.0');
  const second = new TestPlugin('second', 'Second', '1.0.0');

  first.deactivate = async () => { throw new Error('first failed'); };
  second.deactivate = async () => { throw new Error('second failed'); };

  manager.register(first);
  manager.register(second);
  await manager.activateAll();

  await assert.rejects(async () => {
    await manager.deactivateAll();
  }, (error: unknown) => {
    assert.ok(error instanceof PluginAggregateError);
    assert.equal((error as PluginAggregateError).errors.length, 2);
    return true;
  });
});

test('removes an inactive plugin', async () => {
  const manager = new PluginManager();
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');

  manager.register(plugin);
  await manager.activate('alpha');
  await manager.deactivate('alpha');

  manager.remove('alpha');

  assert.equal(manager.isRegistered('alpha'), false);
});

test('blocks removal of an active plugin', async () => {
  const manager = new PluginManager();
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');

  manager.register(plugin);
  await manager.activate('alpha');

  assert.throws(() => manager.remove('alpha'), InvalidPluginStateError);
});

test('blocks removal while activating', async () => {
  const manager = new PluginManager();
  const deferred = createDeferred<void>();
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');

  plugin.activate = async () => {
    await deferred.promise;
  };

  manager.register(plugin);
  const activationPromise = manager.activate('alpha');

  assert.throws(() => manager.remove('alpha'), InvalidPluginStateError);

  deferred.resolve();
  await activationPromise;
});

test('blocks removal while deactivating', async () => {
  const manager = new PluginManager();
  const deferred = createDeferred<void>();
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');

  plugin.deactivate = async () => {
    await deferred.promise;
  };

  manager.register(plugin);
  await manager.activate('alpha');
  const deactivationPromise = manager.deactivate('alpha');

  assert.throws(() => manager.remove('alpha'), InvalidPluginStateError);

  deferred.resolve();
  await deactivationPromise;
});

test('clear removes plugins in safe states', () => {
  const manager = new PluginManager();
  manager.register(new TestPlugin('first', 'First', '1.0.0'));
  manager.register(new TestPlugin('second', 'Second', '1.0.0'));

  manager.clear();

  assert.equal(manager.list().length, 0);
});

test('clear refuses to remove plugins in unsafe states', async () => {
  const manager = new PluginManager();
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');

  manager.register(plugin);
  await manager.activate('alpha');

  assert.throws(() => manager.clear(), InvalidPluginStateError);
  assert.equal(manager.isRegistered('alpha'), true);
});

test('rejects concurrent activation attempts for the same plugin', async () => {
  const manager = new PluginManager();
  const deferred = createDeferred<void>();
  const plugin = new TestPlugin('alpha', 'Alpha', '1.0.0');

  plugin.activate = async () => {
    await deferred.promise;
  };

  manager.register(plugin);
  const first = manager.activate('alpha');

  await assert.rejects(() => manager.activate('alpha'), InvalidPluginStateError);

  deferred.resolve();
  await first;
});

test('keeps plugin state isolated between two plugin managers', async () => {
  const managerA = new PluginManager();
  const managerB = new PluginManager();
  const plugin = new TestPlugin('shared', 'Shared', '1.0.0');

  managerA.register(plugin);
  await managerA.activate('shared');

  assert.equal(managerA.getState('shared'), 'active');
  assert.equal(managerB.get('shared'), undefined);
  assert.equal(managerB.getState('shared'), undefined);
});
