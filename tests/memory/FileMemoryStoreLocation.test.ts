import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  SEBASTIAN_DATA_DIRECTORY_ENV_VAR,
  resolveDefaultSebastianDataDirectory,
  resolveMemoryFilePath,
  resolveSebastianDataDirectory,
} from '../../core/memory/FileMemoryStoreLocation.js';
import { InvalidFileMemoryStorePathError } from '../../core/memory/FileMemoryStoreErrors.js';

test('resolves the Windows default directory under APPDATA', () => {
  const dir = resolveDefaultSebastianDataDirectory('win32', { APPDATA: 'C:\\Users\\Gabriel\\AppData\\Roaming' }, 'C:\\Users\\Gabriel');

  assert.equal(dir, join('C:\\Users\\Gabriel\\AppData\\Roaming', 'SebastianIA'));
});

test('resolves a Windows fallback when APPDATA is not set', () => {
  const dir = resolveDefaultSebastianDataDirectory('win32', {}, 'C:\\Users\\Gabriel');

  assert.equal(dir, join('C:\\Users\\Gabriel', 'AppData', 'Roaming', 'SebastianIA'));
});

test('resolves the macOS default directory under Application Support', () => {
  const dir = resolveDefaultSebastianDataDirectory('darwin', {}, '/Users/gabriel');

  assert.equal(dir, join('/Users/gabriel', 'Library', 'Application Support', 'SebastianIA'));
});

test('resolves the Linux default directory honoring XDG_DATA_HOME', () => {
  const dir = resolveDefaultSebastianDataDirectory('linux', { XDG_DATA_HOME: '/home/gabriel/.data' }, '/home/gabriel');

  assert.equal(dir, join('/home/gabriel/.data', 'sebastiania'));
});

test('resolves a Linux fallback when XDG_DATA_HOME is not set', () => {
  const dir = resolveDefaultSebastianDataDirectory('linux', {}, '/home/gabriel');

  assert.equal(dir, join('/home/gabriel', '.local', 'share', 'sebastiania'));
});

test('resolveSebastianDataDirectory honors the SEBASTIAN_DATA_DIR override', () => {
  const dir = resolveSebastianDataDirectory(
    { [SEBASTIAN_DATA_DIRECTORY_ENV_VAR]: '/tmp/isolated-sebastian' },
    'linux',
    '/home/gabriel',
  );

  assert.equal(dir, '/tmp/isolated-sebastian');
});

test('resolveSebastianDataDirectory falls back to the OS default when the override is blank', () => {
  const dir = resolveSebastianDataDirectory({ [SEBASTIAN_DATA_DIRECTORY_ENV_VAR]: '   ' }, 'linux', '/home/gabriel');

  assert.equal(dir, join('/home/gabriel', '.local', 'share', 'sebastiania'));
});

test('resolveMemoryFilePath joins the data directory with the memory file name', () => {
  assert.equal(resolveMemoryFilePath('/tmp/isolated-sebastian'), join('/tmp/isolated-sebastian', 'memory.json'));
});

test('resolveMemoryFilePath rejects an empty data directory', () => {
  assert.throws(
    () => resolveMemoryFilePath(''),
    (error: unknown) => {
      assert.ok(error instanceof InvalidFileMemoryStorePathError);
      return true;
    },
  );
});
