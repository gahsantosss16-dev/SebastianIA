import type { Logger } from '../core/logger.js';
import { GitHubReadOnlyTool } from '../core/tool/GitHubReadOnlyTool.js';
import { ProjectRegistry } from '../core/project/index.js';
import type { ProjectDescriptor } from '../core/project/index.js';

export const SEBASTIAN_GITHUB_TOKEN_ENV_VAR = 'SEBASTIAN_GITHUB_TOKEN';
/** JSON array of closed, read-only project descriptors for multi-project deployments. */
export const SEBASTIAN_GITHUB_PROJECTS_ENV_VAR = 'SEBASTIAN_GITHUB_PROJECTS';

/**
 * Simple, flat env vars describing exactly one authorized GitHub project -
 * supplied entirely by the operator/deployment, never derived from user
 * text and never editable by the model. All five are required together;
 * `ProjectRegistry` itself stays fully capable of holding many projects,
 * this is only how many this composition currently reads from the
 * environment. Aliases are optional and, deliberately, not JSON: a single
 * comma-separated list, so a hosting panel that mishandles a JSON-shaped
 * value (quoting, BOM, escaping) has nothing complex left to mishandle.
 */
export const SEBASTIAN_GITHUB_PROJECT_ID_ENV_VAR = 'SEBASTIAN_GITHUB_PROJECT_ID';
export const SEBASTIAN_GITHUB_PROJECT_NAME_ENV_VAR = 'SEBASTIAN_GITHUB_PROJECT_NAME';
export const SEBASTIAN_GITHUB_OWNER_ENV_VAR = 'SEBASTIAN_GITHUB_OWNER';
export const SEBASTIAN_GITHUB_REPOSITORY_ENV_VAR = 'SEBASTIAN_GITHUB_REPOSITORY';
export const SEBASTIAN_GITHUB_DEFAULT_BRANCH_ENV_VAR = 'SEBASTIAN_GITHUB_DEFAULT_BRANCH';
export const SEBASTIAN_GITHUB_PROJECT_ALIASES_ENV_VAR = 'SEBASTIAN_GITHUB_PROJECT_ALIASES';

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function parseAliases(raw: string | undefined): readonly string[] {
  if (raw === undefined) {
    return [];
  }
  return raw.split(',').map((alias) => alias.trim()).filter((alias) => alias !== '');
}

function parseMultiProjectConfiguration(raw: string | undefined): readonly ProjectDescriptor[] | undefined {
  if (!isNonEmptyString(raw)) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as { projects?: unknown }).projects)
        ? (parsed as { projects: unknown[] }).projects
        : undefined;
    if (entries === undefined || entries.length === 0) return undefined;
    return entries.map((entry): ProjectDescriptor => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('invalid entry');
      const value = entry as Record<string, unknown>;
      const remote = value.remoteRepository;
      if (remote === null || typeof remote !== 'object' || Array.isArray(remote)) throw new Error('invalid repository');
      const repository = remote as Record<string, unknown>;
      if (typeof value.id !== 'string' || typeof value.displayName !== 'string' ||
        !Array.isArray(value.aliases) || value.aliases.some((alias) => typeof alias !== 'string') ||
        typeof repository.owner !== 'string' || typeof repository.repository !== 'string' || typeof repository.defaultBranch !== 'string') {
        throw new Error('invalid project shape');
      }
      return {
        id: value.id,
        displayName: value.displayName,
        aliases: value.aliases as string[],
        resourceKind: 'github-repository',
        remoteRepository: { owner: repository.owner, repository: repository.repository, defaultBranch: repository.defaultBranch },
        permissions: { access: 'read-only' },
      };
    });
  } catch {
    return undefined;
  }
}

/**
 * Builds the closed, read-only registry of projects the online cognitive
 * loop may investigate, from the flat `SEBASTIAN_GITHUB_*` env vars above.
 * All five required vars must be present and non-empty for the project to
 * be registered; if any is missing, the registry is simply empty - GitHub
 * investigation stays unavailable until the operator completes the
 * configuration. Never partially registers a project from incomplete
 * configuration.
 */
export function createGitHubProjectRegistry(env: NodeJS.ProcessEnv = process.env, logger?: Logger): ProjectRegistry {
  const multiProjectEntries = parseMultiProjectConfiguration(env[SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]);
  if (multiProjectEntries !== undefined) {
    try {
      const registry = new ProjectRegistry({ readOnly: true, entries: multiProjectEntries });
      logger?.info('GitHub project registry resolved.', { projectCount: multiProjectEntries.length, outcome: 'configuredMultiProject' });
      return registry;
    } catch {
      // A malformed optional multi-project value must not disable the known-good
      // legacy project during a rolling configuration update.
      logger?.warn('GitHub multi-project registry ignored; using legacy configuration.');
    }
  } else if (isNonEmptyString(env[SEBASTIAN_GITHUB_PROJECTS_ENV_VAR])) {
    logger?.warn('GitHub multi-project registry ignored; using legacy configuration.');
  }
  const id = env[SEBASTIAN_GITHUB_PROJECT_ID_ENV_VAR];
  const displayName = env[SEBASTIAN_GITHUB_PROJECT_NAME_ENV_VAR];
  const owner = env[SEBASTIAN_GITHUB_OWNER_ENV_VAR];
  const repository = env[SEBASTIAN_GITHUB_REPOSITORY_ENV_VAR];
  const defaultBranch = env[SEBASTIAN_GITHUB_DEFAULT_BRANCH_ENV_VAR];

  const isComplete =
    isNonEmptyString(id) &&
    isNonEmptyString(displayName) &&
    isNonEmptyString(owner) &&
    isNonEmptyString(repository) &&
    isNonEmptyString(defaultBranch);

  if (!isComplete) {
    logger?.info('GitHub project registry resolved.', { projectCount: 0, outcome: 'notConfigured' });
    return new ProjectRegistry({ readOnly: true, entries: [] });
  }

  const registry = new ProjectRegistry({
    readOnly: true,
    entries: [
      {
        id: id.trim(),
        displayName: displayName.trim(),
        aliases: parseAliases(env[SEBASTIAN_GITHUB_PROJECT_ALIASES_ENV_VAR]),
        resourceKind: 'github-repository',
        remoteRepository: {
          owner: owner.trim(),
          repository: repository.trim(),
          defaultBranch: defaultBranch.trim(),
        },
        permissions: { access: 'read-only' },
      },
    ],
  });
  logger?.info('GitHub project registry resolved.', { projectCount: 1, outcome: 'configured' });
  return registry;
}

/**
 * Builds the GitHub read-only Tool when (and only when) an operator token is
 * configured. Absent a token, GitHub investigation is unavailable and the
 * online composition never exposes any `github.*` toolId - never a Tool
 * that would fail every call, and never a Tool constructed with an empty
 * credential.
 */
export function createGitHubReadOnlyTool(
  env: NodeJS.ProcessEnv = process.env,
  registry: ProjectRegistry,
  logger?: Logger,
): GitHubReadOnlyTool | undefined {
  const token = env[SEBASTIAN_GITHUB_TOKEN_ENV_VAR];
  if (typeof token !== 'string' || token.trim() === '') {
    logger?.info('GitHub read-only tool resolved.', { outcome: 'notConfigured' });
    return undefined;
  }

  logger?.info('GitHub read-only tool resolved.', { outcome: 'configured' });
  return new GitHubReadOnlyTool({ token, registry, ...(logger === undefined ? {} : { logger }) });
}
