import type { Logger } from '../core/logger.js';
import { GitHubReadOnlyTool } from '../core/tool/GitHubReadOnlyTool.js';
import { ProjectRegistry, type ProjectDescriptor } from '../core/project/index.js';

export const SEBASTIAN_GITHUB_TOKEN_ENV_VAR = 'SEBASTIAN_GITHUB_TOKEN';
/**
 * JSON array of `{ id, displayName, aliases?, owner, repository, defaultBranch }`
 * entries, supplied entirely by the operator/deployment - never derived from
 * user text and never editable by the model. Each entry becomes one
 * read-only `ProjectDescriptor`; see `ProjectRegistry` for how a friendly
 * reference (e.g. "Neuro Hub") resolves back to one of these entries.
 */
export const SEBASTIAN_GITHUB_PROJECTS_ENV_VAR = 'SEBASTIAN_GITHUB_PROJECTS';

interface RawProjectEntry {
  readonly id?: unknown;
  readonly displayName?: unknown;
  readonly aliases?: unknown;
  readonly owner?: unknown;
  readonly repository?: unknown;
  readonly defaultBranch?: unknown;
}

/**
 * Builds the closed, read-only registry of projects the online cognitive
 * loop may investigate. With no configuration, returns an empty, locked
 * registry - GitHub investigation is simply unavailable until the operator
 * explicitly registers at least one project. Never invents a project from
 * partial or ambiguous configuration; any malformed entry fails the whole
 * startup loudly rather than silently registering something unintended.
 */
export function createGitHubProjectRegistry(env: NodeJS.ProcessEnv = process.env, logger?: Logger): ProjectRegistry {
  const raw = env[SEBASTIAN_GITHUB_PROJECTS_ENV_VAR];
  if (raw === undefined || raw.trim() === '') {
    logger?.info('GitHub project registry resolved.', { projectCount: 0, outcome: 'notConfigured' });
    return new ProjectRegistry({ readOnly: true, entries: [] });
  }

  // Strips only a leading UTF-8 BOM and outer whitespace - both invisible,
  // non-semantic artifacts some hosting panels add when persisting an env
  // var. Never repairs malformed JSON, typographic quotes, or an extra
  // layer of wrapping quotes: anything else still fails fast below.
  const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
  const normalized = (raw.startsWith(BYTE_ORDER_MARK) ? raw.slice(BYTE_ORDER_MARK.length) : raw).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized) as unknown;
  } catch {
    throw new Error('GitHub project registry configuration is not valid JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('GitHub project registry configuration must be a JSON array.');
  }

  const entries = parsed.map((entry) => toProjectDescriptor(entry as RawProjectEntry));
  const registry = new ProjectRegistry({ readOnly: true, entries });
  logger?.info('GitHub project registry resolved.', { projectCount: entries.length, outcome: 'configured' });
  return registry;
}

function toProjectDescriptor(entry: RawProjectEntry): ProjectDescriptor {
  const isObject = entry && typeof entry === 'object' && !Array.isArray(entry);
  if (!isObject) {
    throw new Error('GitHub project registry entry must be an object.');
  }
  if (typeof entry.id !== 'string' || entry.id.trim() === '') {
    throw new Error('GitHub project registry entry id must be a non-empty string.');
  }
  if (typeof entry.displayName !== 'string' || entry.displayName.trim() === '') {
    throw new Error('GitHub project registry entry displayName must be a non-empty string.');
  }
  const aliases = entry.aliases ?? [];
  if (!Array.isArray(aliases) || aliases.some((alias) => typeof alias !== 'string' || alias.trim() === '')) {
    throw new Error('GitHub project registry entry aliases must be an array of non-empty strings when provided.');
  }
  if (typeof entry.owner !== 'string' || entry.owner.trim() === '') {
    throw new Error('GitHub project registry entry owner must be a non-empty string.');
  }
  if (typeof entry.repository !== 'string' || entry.repository.trim() === '') {
    throw new Error('GitHub project registry entry repository must be a non-empty string.');
  }
  if (typeof entry.defaultBranch !== 'string' || entry.defaultBranch.trim() === '') {
    throw new Error('GitHub project registry entry defaultBranch must be a non-empty string.');
  }
  const allowedKeys = new Set(['id', 'displayName', 'aliases', 'owner', 'repository', 'defaultBranch']);
  if (Object.keys(entry).some((key) => !allowedKeys.has(key))) {
    throw new Error(`GitHub project registry entry "${entry.id}" contains unsupported fields.`);
  }

  return {
    id: entry.id,
    displayName: entry.displayName,
    aliases: aliases as readonly string[],
    resourceKind: 'github-repository',
    remoteRepository: {
      owner: entry.owner,
      repository: entry.repository,
      defaultBranch: entry.defaultBranch,
    },
    permissions: { access: 'read-only' },
  };
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
