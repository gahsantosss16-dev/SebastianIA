import { spawnSync } from 'node:child_process';

const GIT_TIMEOUT_MS = 10_000;

export interface GitCommandOutcome {
  /**
   * False whenever git itself could not be run as expected against this
   * directory - git missing from PATH, the directory not being a
   * repository, or any other non-zero exit. Callers that only care about
   * "is there git protection/information available here" can treat this as
   * a single, safe signal without inspecting exitCode/stderr themselves.
   */
  readonly ranAsGitRepo: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The single, safe primitive every git-touching Tool goes through: a fixed
 * executable ("git"), a caller-supplied argument array (never shell text),
 * no shell, a bounded timeout, and cwd always pinned to the allowed root.
 * Never throws for "not a repository" or "git not installed" - both collapse
 * into `ranAsGitRepo: false` so callers can decide locally what that means
 * for them (a read-only git Tool reports it to the user; a filesystem-edit
 * dirty-check simply treats it as "no git protection available, proceed").
 */
export function runGitCommand(cwd: string, args: readonly string[]): GitCommandOutcome {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    shell: false,
  });

  if (result.error || result.status === null || result.status !== 0) {
    return {
      ranAsGitRepo: false,
      exitCode: result.status ?? null,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? (result.error instanceof Error ? result.error.message : ''),
    };
  }

  return {
    ranAsGitRepo: true,
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}
