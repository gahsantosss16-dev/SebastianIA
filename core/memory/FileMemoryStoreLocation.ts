import { homedir } from 'node:os';
import { join } from 'node:path';
import { InvalidFileMemoryStorePathError } from './FileMemoryStoreErrors.js';

export const SEBASTIAN_DATA_DIRECTORY_ENV_VAR = 'SEBASTIAN_DATA_DIR';
const MEMORY_STORE_FILE_NAME = 'memory.json';

/**
 * Resolves the OS-conventional per-user data directory for Sebastian IA,
 * mirroring the platform's usual "application support" location instead of a
 * project-local path, so local memory never lives inside the repository.
 */
export function resolveDefaultSebastianDataDirectory(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (platform === 'win32') {
    return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'SebastianIA');
  }

  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'SebastianIA');
  }

  return join(env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'sebastiania');
}

/**
 * Resolves the data directory Sebastian IA should use, honoring the
 * SEBASTIAN_DATA_DIR override so callers (notably tests) can fully isolate
 * persistence from the real user profile.
 */
export function resolveSebastianDataDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const override = env[SEBASTIAN_DATA_DIRECTORY_ENV_VAR];
  if (typeof override === 'string' && override.trim() !== '') {
    return override;
  }

  return resolveDefaultSebastianDataDirectory(platform, env, home);
}

export function resolveMemoryFilePath(dataDir: string): string {
  if (typeof dataDir !== 'string' || dataDir.trim() === '') {
    throw new InvalidFileMemoryStorePathError('Sebastian data directory must be a non-empty string.');
  }

  return join(dataDir, MEMORY_STORE_FILE_NAME);
}
