import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packageJsonPath = resolve(projectRoot, 'package.json');
const packageLockPath = resolve(projectRoot, 'package-lock.json');
const cliPath = resolve(projectRoot, 'application/cli.ts');

interface PackageManifest {
  readonly bin?: Readonly<Record<string, string>>;
}

interface PackageLock {
  readonly packages?: Readonly<Record<string, { readonly bin?: Readonly<Record<string, string>> }>>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

test('package exposes the sebastiania executable at the compiled CLI entrypoint', () => {
  const manifest = readJson<PackageManifest>(packageJsonPath);

  assert.deepEqual(manifest.bin, {
    sebastiania: './dist/application/cli.js',
  });
});

test('package lock preserves the executable contract', () => {
  const lock = readJson<PackageLock>(packageLockPath);

  assert.deepEqual(lock.packages?.['']?.bin, {
    sebastiania: 'dist/application/cli.js',
  });
});

test('CLI source declares the Node shebang', () => {
  const firstLine = readFileSync(cliPath, 'utf8').split(/\r?\n/, 1)[0];

  assert.equal(firstLine, '#!/usr/bin/env node');
});

test('real CLI process executes a named greeting successfully', () => {
  const execution = spawnSync(
    process.execPath,
    ['--import', 'tsx', cliPath, 'greeting', 'Gabriel'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
    },
  );

  assert.equal(execution.error, undefined);
  assert.equal(execution.status, 0);
  assert.equal(execution.stderr, '');

  const result = JSON.parse(execution.stdout.trim()) as {
    readonly status: string;
    readonly output: Readonly<Record<string, unknown>>;
    readonly generatedAt: string;
  };
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, { message: 'Hello, Gabriel!' });
  assert.equal(Number.isNaN(Date.parse(result.generatedAt)), false);
});

test('real CLI process rejects missing arguments through stderr', () => {
  const execution = spawnSync(process.execPath, ['--import', 'tsx', cliPath], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  assert.equal(execution.error, undefined);
  assert.equal(execution.status, 1);
  assert.equal(execution.stdout, '');
  assert.deepEqual(JSON.parse(execution.stderr.trim()), {
    name: 'InvalidLocalCommandArgumentsError',
    message: 'Command type is required. Usage: greeting [name].',
    code: 'INVALID_ARGUMENT',
  });
});
