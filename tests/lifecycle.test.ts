import assert from 'node:assert/strict';
import test from 'node:test';

import { LifecycleComponentAdapter, LifecycleManager } from '../core/lifecycle/index.js';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function createComponent(id: string, order: number | undefined, startImpl: () => Promise<void> = async () => {}, stopImpl: () => Promise<void> = async () => {}) {
  return new LifecycleComponentAdapter(id, startImpl, stopImpl, order);
}

async function waitForState(manager: LifecycleManager, expectedState: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (manager.getState() === expectedState) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error(`Expected state ${expectedState} but received ${manager.getState()}`);
}

test('initialization runs components in increasing priority order', async () => {
  const manager = new LifecycleManager();
  const calls: string[] = [];

  manager.register(createComponent('third', 1, async () => { calls.push('start:third'); }));
  manager.register(createComponent('first', 1, async () => { calls.push('start:first'); }));
  manager.register(createComponent('second', 2, async () => { calls.push('start:second'); }));

  await manager.start();

  assert.deepEqual(calls, ['start:third', 'start:first', 'start:second']);
  assert.equal(manager.getState(), 'running');
});

test('same priority preserves registration order', async () => {
  const manager = new LifecycleManager();
  const calls: string[] = [];

  manager.register(createComponent('beta', 1, async () => { calls.push('start:beta'); }));
  manager.register(createComponent('alpha', 1, async () => { calls.push('start:alpha'); }));
  manager.register(createComponent('gamma', 1, async () => { calls.push('start:gamma'); }));

  await manager.start();

  assert.deepEqual(calls, ['start:beta', 'start:alpha', 'start:gamma']);
});

test('shutdown runs components in reverse order', async () => {
  const manager = new LifecycleManager();
  const calls: string[] = [];

  manager.register(createComponent('first', 1, async () => { calls.push('start:first'); }, async () => { calls.push('stop:first'); }));
  manager.register(createComponent('second', 2, async () => { calls.push('start:second'); }, async () => { calls.push('stop:second'); }));

  await manager.start();
  await manager.stop();

  assert.deepEqual(calls, ['start:first', 'start:second', 'stop:second', 'stop:first']);
  assert.equal(manager.getState(), 'stopped');
});

test('registering the same identifier twice throws an error', () => {
  const manager = new LifecycleManager();

  manager.register(createComponent('dup', 1));

  assert.throws(() => manager.register(createComponent('dup', 2)), /already registered/);
});

test('a second start call is blocked', async () => {
  const manager = new LifecycleManager();

  manager.register(createComponent('component', 1));
  await manager.start();

  await assert.rejects(() => manager.start(), /already starting or running/);
});

test('a second stop call is handled idempotently', async () => {
  const manager = new LifecycleManager();

  manager.register(createComponent('component', 1));
  await manager.start();

  await manager.stop();
  await assert.doesNotReject(() => manager.stop());
  assert.equal(manager.getState(), 'stopped');
});

test('start failure transitions to failed and preserves the original cause', async () => {
  const manager = new LifecycleManager();
  const originalError = new Error('boom');

  manager.register(createComponent('good', 1, async () => {}, async () => {}));
  manager.register(createComponent('bad', 2, async () => {
    throw originalError;
  }));

  await assert.rejects(() => manager.start(), /boom/);
  assert.equal(manager.getState(), 'failed');
});

test('start failure stops already started components in reverse order', async () => {
  const manager = new LifecycleManager();
  const calls: string[] = [];

  manager.register(createComponent('first', 1, async () => { calls.push('start:first'); }, async () => { calls.push('stop:first'); }));
  manager.register(createComponent('second', 2, async () => { calls.push('start:second'); throw new Error('boom'); }, async () => { calls.push('stop:second'); }));

  await assert.rejects(() => manager.start(), /boom/);

  assert.deepEqual(calls, ['start:first', 'start:second', 'stop:first']);
});

test('stop failure does not prevent the remaining components from stopping', async () => {
  const manager = new LifecycleManager();
  const calls: string[] = [];

  manager.register(createComponent('first', 1, async () => {}, async () => { calls.push('stop:first'); throw new Error('first stop failed'); }));
  manager.register(createComponent('second', 2, async () => {}, async () => { calls.push('stop:second'); }));

  await manager.start();
  await assert.rejects(() => manager.stop(), /first stop failed/);

  assert.deepEqual(calls, ['stop:second', 'stop:first']);
  assert.equal(manager.getState(), 'failed');
});

test('remove is blocked while the manager is starting, running or stopping', async () => {
  const manager = new LifecycleManager();
  const gate = createDeferred<void>();

  manager.register(createComponent('delayed', 1, async () => {
    await gate.promise;
  }));

  const startPromise = manager.start();
  await waitForState(manager, 'starting');

  assert.throws(() => manager.remove('delayed'), /Cannot remove component/);

  gate.resolve();
  await startPromise;

  assert.throws(() => manager.remove('delayed'), /Cannot remove component/);

  const stopPromise = manager.stop();
  await waitForState(manager, 'stopping');
  assert.throws(() => manager.remove('delayed'), /Cannot remove component/);
  await stopPromise;
});

test('list returns a copy and does not allow mutation of the internal registry', async () => {
  const manager = new LifecycleManager();

  manager.register(createComponent('first', 1));
  manager.register(createComponent('second', 2));

  const list = manager.list();
  list.push(createComponent('third', 3));

  assert.equal(manager.list().length, 2);
  assert.equal(manager.isRegistered('third'), false);
});

test('stop aggregates multiple stop errors and preserves a clear failure message', async () => {
  const manager = new LifecycleManager();

  manager.register(createComponent('first', 1, async () => {}, async () => { throw new Error('first failure'); }));
  manager.register(createComponent('second', 2, async () => {}, async () => { throw new Error('second failure'); }));

  await manager.start();
  await assert.rejects(() => manager.stop(), /first failure|second failure/);
  assert.equal(manager.getState(), 'failed');
});
