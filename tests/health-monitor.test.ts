import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HealthMonitor,
  HealthStatus,
  type HealthCheck,
  type HealthReport,
} from '../core/health/index.js';

test('registers a health check with a unique id', async () => {
  const monitor = new HealthMonitor();
  const check: HealthCheck = {
    id: 'db',
    name: 'Database',
    check: () => ({ id: 'db', name: 'Database', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }),
  };

  assert.equal(monitor.register(check), true);
  assert.equal(monitor.get('db'), check);
});

test('rejects a duplicated health check id', () => {
  const monitor = new HealthMonitor();
  const first: HealthCheck = {
    id: 'db',
    name: 'Database',
    check: () => ({ id: 'db', name: 'Database', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }),
  };
  const second: HealthCheck = {
    id: 'db',
    name: 'Database 2',
    check: () => ({ id: 'db', name: 'Database 2', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }),
  };

  monitor.register(first);
  assert.throws(() => monitor.register(second), /already registered/i);
});

test('removes a registered health check', () => {
  const monitor = new HealthMonitor();
  const check: HealthCheck = {
    id: 'cache',
    name: 'Cache',
    check: () => ({ id: 'cache', name: 'Cache', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }),
  };

  monitor.register(check);
  assert.equal(monitor.remove('cache'), true);
  assert.equal(monitor.get('cache'), undefined);
});

test('clear removes all registered checks', () => {
  const monitor = new HealthMonitor();
  monitor.register({ id: 'a', name: 'A', check: () => ({ id: 'a', name: 'A', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }) });
  monitor.register({ id: 'b', name: 'B', check: () => ({ id: 'b', name: 'B', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }) });

  monitor.clear();
  assert.deepEqual(monitor.list(), []);
});

test('gets a check by id', () => {
  const monitor = new HealthMonitor();
  const check: HealthCheck = {
    id: 'queue',
    name: 'Queue',
    check: () => ({ id: 'queue', name: 'Queue', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }),
  };

  monitor.register(check);
  assert.equal(monitor.get('queue'), check);
});

test('preserves registration order', () => {
  const monitor = new HealthMonitor();
  const first: HealthCheck = { id: 'first', name: 'First', check: () => ({ id: 'first', name: 'First', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }) };
  const second: HealthCheck = { id: 'second', name: 'Second', check: () => ({ id: 'second', name: 'Second', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }) };

  monitor.register(first);
  monitor.register(second);
  assert.deepEqual(monitor.list().map((item) => item.id), ['first', 'second']);
});

test('list returns a copy and does not allow external mutation of the monitor state', () => {
  const monitor = new HealthMonitor();
  monitor.register({ id: 'one', name: 'One', check: () => ({ id: 'one', name: 'One', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }) });

  const snapshot = monitor.list();
  snapshot.pop();

  assert.equal(monitor.list().length, 1);
});

test('runs a single check and returns a report', async () => {
  const monitor = new HealthMonitor();
  const check: HealthCheck = {
    id: 'api',
    name: 'API',
    check: () => ({ id: 'api', name: 'API', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }),
  };

  monitor.register(check);
  const report = await monitor.run('api');

  assert.equal(report.status, HealthStatus.HEALTHY);
  assert.equal(report.id, 'api');
});

test('runAll executes checks sequentially', async () => {
  const monitor = new HealthMonitor();
  const executionOrder: string[] = [];

  monitor.register({
    id: 'first',
    name: 'First',
    check: async () => {
      executionOrder.push('first');
      return { id: 'first', name: 'First', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() };
    },
  });
  monitor.register({
    id: 'second',
    name: 'Second',
    check: async () => {
      executionOrder.push('second');
      return { id: 'second', name: 'Second', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }; 
    },
  });

  await monitor.runAll();
  assert.deepEqual(executionOrder, ['first', 'second']);
});

test('a failing check does not stop the remaining checks', async () => {
  const monitor = new HealthMonitor();
  monitor.register({
    id: 'broken',
    name: 'Broken',
    check: () => {
      throw new Error('boom');
    },
  });
  monitor.register({
    id: 'healthy',
    name: 'Healthy',
    check: () => ({ id: 'healthy', name: 'Healthy', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }),
  });

  const reports = await monitor.runAll();
  assert.ok(reports[0]);
  assert.ok(reports[1]);
  assert.equal(reports[0].status, HealthStatus.UNHEALTHY);
  assert.equal(reports[1].status, HealthStatus.HEALTHY);
});

test('creates an automatic report for exceptions and preserves the cause', async () => {
  const monitor = new HealthMonitor();
  const cause = new Error('root cause');
  monitor.register({
    id: 'crash',
    name: 'Crash',
    check: () => {
      throw cause;
    },
  });

  const report = await monitor.run('crash');
  assert.equal(report.status, HealthStatus.UNHEALTHY);
  assert.equal(report.message, 'Health check failed');
  assert.equal((report.metadata as Record<string, unknown>).cause, cause);
});

test('creates a timestamp automatically for generated reports', async () => {
  const monitor = new HealthMonitor();
  monitor.register({ id: 'clock', name: 'Clock', check: () => ({ id: 'clock', name: 'Clock', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }) });

  const report = await monitor.run('clock');
  assert.match(report.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('allows optional metadata on reports', async () => {
  const monitor = new HealthMonitor();
  monitor.register({
    id: 'meta',
    name: 'Meta',
    check: () => ({ id: 'meta', name: 'Meta', status: HealthStatus.DEGRADED, timestamp: new Date().toISOString(), metadata: { source: 'unit-test' } }),
  });

  const report = await monitor.run('meta');
  assert.deepEqual(report.metadata, { source: 'unit-test' });
});

test('keeps health monitor instances isolated', async () => {
  const first = new HealthMonitor();
  const second = new HealthMonitor();

  first.register({ id: 'only-first', name: 'Only First', check: () => ({ id: 'only-first', name: 'Only First', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }) });

  assert.equal(first.get('only-first')?.id, 'only-first');
  assert.equal(second.get('only-first'), undefined);
});

test('throws when running a missing check id', async () => {
  const monitor = new HealthMonitor();
  await assert.rejects(() => monitor.run('missing'), /not found/i);
});

test('returns undefined for a missing check id in get', () => {
  const monitor = new HealthMonitor();
  assert.equal(monitor.get('missing'), undefined);
});

test('return value of remove is false for a missing id', () => {
  const monitor = new HealthMonitor();
  assert.equal(monitor.remove('missing'), false);
});

test('runAll returns a report for each check even when one fails', async () => {
  const monitor = new HealthMonitor();
  monitor.register({ id: 'one', name: 'One', check: () => ({ id: 'one', name: 'One', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }) });
  monitor.register({ id: 'two', name: 'Two', check: () => { throw new Error('boom'); } });

  const reports = await monitor.runAll();
  assert.equal(reports.length, 2);
  assert.ok(reports[0]);
  assert.ok(reports[1]);
  assert.equal(reports[0].status, HealthStatus.HEALTHY);
  assert.equal(reports[1].status, HealthStatus.UNHEALTHY);
});

test('runAll preserves the order of reports', async () => {
  const monitor = new HealthMonitor();
  monitor.register({ id: 'a', name: 'A', check: () => ({ id: 'a', name: 'A', status: HealthStatus.HEALTHY, timestamp: new Date().toISOString() }) });
  monitor.register({ id: 'b', name: 'B', check: () => ({ id: 'b', name: 'B', status: HealthStatus.DEGRADED, timestamp: new Date().toISOString() }) });

  const reports = await monitor.runAll();
  assert.deepEqual(reports.map((report) => report.id), ['a', 'b']);
});
