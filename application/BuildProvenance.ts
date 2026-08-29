import { execFileSync } from 'node:child_process';

const SHA_PATTERN = /^[0-9a-f]{7,64}$/i;
const BUILD_SHA_ENV_VARS = ['SEBASTIAN_BUILD_SHA', 'RENDER_GIT_COMMIT', 'GITHUB_SHA', 'SOURCE_VERSION'] as const;

export interface BuildProvenance {
  readonly sha: string;
  readonly source: 'environment' | 'git' | 'unknown';
}

export function resolveBuildProvenance(
  env: NodeJS.ProcessEnv = process.env,
  readGitHead: () => string = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 2_000 }),
): BuildProvenance {
  for (const name of BUILD_SHA_ENV_VARS) {
    const candidate = env[name]?.trim();
    if (candidate && SHA_PATTERN.test(candidate)) return { sha: candidate.toLowerCase(), source: 'environment' };
  }
  try {
    const candidate = readGitHead().trim();
    if (SHA_PATTERN.test(candidate)) return { sha: candidate.toLowerCase(), source: 'git' };
  } catch {
    // Production images may intentionally omit Git; provenance then stays explicit rather than guessed.
  }
  return { sha: 'unknown', source: 'unknown' };
}
