import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CONFIRMED_POOLER_HOST, CONFIRMED_POOLER_LOGIN, HomologationPreparationError, prepareSessionPoolerEnvironment,
} from '../../scripts/SessionPoolerHomologationEnvironment.js';

function withSecret(run: (path: string, secret: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-secret-preparation-'));
  const path = join(dir, 'password');
  const secret = 'CREDENTIAL_SENTINEL_%2F:@/?# spaces';
  writeFileSync(path, secret + '\n', { mode: 0o600 });
  try { run(path, secret); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function preparationError(code: string) {
  return (error: unknown): boolean => error instanceof HomologationPreparationError && error.code === code;
}

test('preparation pins the confirmed endpoint and encodes the dedicated password exactly once in memory', () => {
  withSecret((path, secret) => {
    const original = { SEBASTIAN_SUPABASE_PASSWORD_FILE: path, PGPASSWORD: 'ADMINISTRATIVE_SENTINEL', SEBASTIAN_SUPABASE_DATABASE_URL: 'unused-previous-url' };
    const env = prepareSessionPoolerEnvironment(original);
    const url = new URL(env.SEBASTIAN_SUPABASE_DATABASE_URL!);
    assert.equal(url.hostname, CONFIRMED_POOLER_HOST);
    assert.equal(url.port, '5432');
    assert.equal(url.pathname, '/postgres');
    assert.equal(decodeURIComponent(url.username), CONFIRMED_POOLER_LOGIN);
    assert.equal(decodeURIComponent(url.password), secret);
    assert.equal(url.searchParams.get('sslmode'), 'verify-full');
    assert.equal(env.PGPASSWORD, undefined);
    assert.equal(env.SEBASTIAN_SUPABASE_CONNECTION_MODE, 'session-pooler');
    assert.equal(original.PGPASSWORD, 'ADMINISTRATIVE_SENTINEL');
    assert.equal(original.SEBASTIAN_SUPABASE_DATABASE_URL, 'unused-previous-url');
  });
});

test('preparation fails without a protected password file and never falls back to an administrative environment password', () => {
  assert.throws(() => prepareSessionPoolerEnvironment({ PGPASSWORD: 'ADMINISTRATIVE_SENTINEL' }), preparationError('PASSWORD_FILE_REQUIRED'));
  withSecret((path) => {
    chmodSync(path, 0o644);
    assert.throws(() => prepareSessionPoolerEnvironment({ SEBASTIAN_SUPABASE_PASSWORD_FILE: path }), preparationError('INSECURE_PASSWORD_FILE_PERMISSIONS'));
  });
});

test('preparation rejects TLS downgrade and a stale or different pooler host', () => {
  withSecret((path) => {
    const env = { SEBASTIAN_SUPABASE_PASSWORD_FILE: path };
    assert.throws(() => prepareSessionPoolerEnvironment({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }), preparationError('UNSAFE_TLS_ENVIRONMENT'));
    assert.throws(() => prepareSessionPoolerEnvironment({ ...env, SEBASTIAN_SUPABASE_SESSION_POOLER_HOST: 'aws-0-us-west-2.pooler.supabase.com' }), preparationError('UNEXPECTED_POOLER_HOST'));
  });
});

test('offline preparation loads a mounted secret without connecting or printing credentials', () => {
  withSecret((path, secret) => {
    const env: NodeJS.ProcessEnv = { ...process.env, SEBASTIAN_SUPABASE_PASSWORD_FILE: path };
    delete env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete env.SEBASTIAN_SUPABASE_SESSION_POOLER_HOST;
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/run-session-pooler-homologation.ts', '--prepare-only'], {
      env, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.includes(secret), false);
    assert.equal(result.stdout.includes('CREDENTIAL_SENTINEL'), false);
    assert.equal(result.stdout.includes('postgresql://'), false);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'prepared', endpointConfirmed: true, secretLoaded: true, tlsRequired: true, connectionAttempted: false,
    });
  });
});

test('runner invokes the real npm diagnostic and sanitizes its failure without any network attempt', () => {
  withSecret((path, secret) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env, SEBASTIAN_SUPABASE_PASSWORD_FILE: path,
      SEBASTIAN_SUPABASE_CA_FILE: '/nonexistent/CREDENTIAL_SENTINEL.crt',
    };
    delete env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete env.SEBASTIAN_SUPABASE_SESSION_POOLER_HOST;
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/run-session-pooler-homologation.ts'], {
      env, encoding: 'utf8', timeout: 20_000,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.includes(secret), false);
    assert.equal(result.stdout.includes('CREDENTIAL_SENTINEL'), false);
    assert.equal(result.stdout.includes('postgresql://'), false);
    assert.deepEqual(JSON.parse(result.stdout), { status: 'failed', code: 'POSTGRES_CHECK_FAILED' });
  });
});
