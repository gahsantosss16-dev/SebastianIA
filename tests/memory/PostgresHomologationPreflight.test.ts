import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

function run(url?: string, ca?: string, mode?: string, poolerHost?: string) {
  const env = { ...process.env };
  delete env.SEBASTIAN_SUPABASE_DATABASE_URL;
  delete env.SEBASTIAN_SUPABASE_CA_FILE;
  delete env.SEBASTIAN_SUPABASE_CONNECTION_MODE;
  delete env.SEBASTIAN_SUPABASE_SESSION_POOLER_HOST;
  if (mode !== undefined) env.SEBASTIAN_SUPABASE_CONNECTION_MODE = mode;
  if (poolerHost !== undefined) env.SEBASTIAN_SUPABASE_SESSION_POOLER_HOST = poolerHost;
  if (url !== undefined) env.SEBASTIAN_SUPABASE_DATABASE_URL = url;
  if (ca !== undefined) env.SEBASTIAN_SUPABASE_CA_FILE = ca;
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-postgres-homologation.ts'], {
    cwd: process.cwd(), env, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes('CREDENTIAL_SENTINEL'), false);
  assert.equal(result.stdout.includes('postgresql://'), false);
  return { status: result.status, report: JSON.parse(result.stdout.trim()) as Record<string, unknown> };
}

test('homologation check reports the missing secret binding without a connection attempt', () => {
  assert.deepEqual(run(), { status: 2, report: { status: 'blocked', missing: ['SEBASTIAN_SUPABASE_DATABASE_URL'] } });
});

test('homologation check rejects a different project or user without echoing credentials', () => {
  for (const url of [
    'postgresql://sebastian_app:CREDENTIAL_SENTINEL@other.invalid/postgres',
    'postgresql://postgres:CREDENTIAL_SENTINEL@db.smtyixukyexezjumouvw.supabase.co/postgres',
    'postgresql://sebastian_app:CREDENTIAL_SENTINEL@db.smtyixukyexezjumouvw.supabase.co:6543/postgres',
    'CREDENTIAL_SENTINEL:malformed-url',
  ]) assert.deepEqual(run(url), { status: 2, report: { status: 'blocked', code: 'INVALID_HOMOLOGATION_CONFIGURATION' } });
});

test('homologation check rejects SSL downgrade flags before opening a connection', () => {
  for (const mode of ['disable', 'no-verify', 'prefer', 'require']) {
    const url = `postgresql://sebastian_app:CREDENTIAL_SENTINEL@db.smtyixukyexezjumouvw.supabase.co/postgres?sslmode=${mode}`;
    assert.deepEqual(run(url), { status: 2, report: { status: 'blocked', code: 'INVALID_HOMOLOGATION_CONFIGURATION' } });
  }
});

test('a missing CA produces a fixed safe error code without leaking the URL or filesystem path', () => {
  const result = run('postgresql://sebastian_app:CREDENTIAL_SENTINEL@db.smtyixukyexezjumouvw.supabase.co/postgres?sslmode=verify-full', '/nonexistent/CREDENTIAL_SENTINEL.crt');
  assert.deepEqual(result, { status: 1, report: { status: 'failed', code: 'POSTGRES_CHECK_FAILED' } });
});

// Fixture hostname only: never inferred as the actual project's assigned endpoint.
const poolerHost = 'aws-0-us-west-2.pooler.supabase.com';
const qualifiedUser = 'sebastian_app.smtyixukyexezjumouvw';
const badConfiguration = { status: 2, report: { status: 'blocked', code: 'INVALID_HOMOLOGATION_CONFIGURATION' } };

test('session pooler requires an explicit host instead of guessing from region', () => {
  const url = `postgresql://${qualifiedUser}:CREDENTIAL_SENTINEL@${poolerHost}:5432/postgres`;
  assert.deepEqual(run(url, undefined, 'session-pooler'), {
    status: 2, report: { status: 'blocked', missing: ['SEBASTIAN_SUPABASE_SESSION_POOLER_HOST'] },
  });
});

test('session pooler accepts the project-qualified dedicated login up to CA loading, without a network attempt', () => {
  const url = `postgresql://${qualifiedUser}:CREDENTIAL_SENTINEL@${poolerHost}:5432/postgres?sslmode=verify-full`;
  assert.deepEqual(run(url, '/nonexistent/CREDENTIAL_SENTINEL.crt', 'session-pooler', poolerHost), {
    status: 1, report: { status: 'failed', code: 'POSTGRES_CHECK_FAILED' },
  });
});

test('session pooler rejects admin credentials, an unqualified user, another project, transaction mode and unapproved endpoints', () => {
  for (const [user, host, port] of [
    ['postgres.smtyixukyexezjumouvw', poolerHost, '5432'],
    ['sebastian_app', poolerHost, '5432'],
    ['sebastian_app.otherproject', poolerHost, '5432'],
    [qualifiedUser, poolerHost, '6543'],
    [qualifiedUser, 'aws-1-us-west-2.pooler.supabase.com', '5432'],
    [qualifiedUser, 'aws-0-us-west-2.pooler.supabase.com.attacker.invalid', '5432'],
  ]) {
    const url = `postgresql://${user}:CREDENTIAL_SENTINEL@${host}:${port}/postgres`;
    assert.deepEqual(run(url, undefined, 'session-pooler', poolerHost), badConfiguration);
  }
});

test('pooler does not become a silent fallback and SSL verification cannot be downgraded', () => {
  const url = `postgresql://${qualifiedUser}:CREDENTIAL_SENTINEL@${poolerHost}:5432/postgres`;
  assert.deepEqual(run(url), badConfiguration);
  assert.deepEqual(run(url, undefined, 'auto', poolerHost), badConfiguration);
  for (const ssl of ['sslmode=disable', 'sslmode=require', 'sslmode=no-verify', 'ssl=false']) {
    assert.deepEqual(run(`${url}?${ssl}`, undefined, 'session-pooler', poolerHost), badConfiguration);
  }
});
