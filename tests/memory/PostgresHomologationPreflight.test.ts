import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

function run(url?: string, ca?: string) {
  const env = { ...process.env };
  delete env.SEBASTIAN_SUPABASE_DATABASE_URL;
  delete env.SEBASTIAN_SUPABASE_CA_FILE;
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
