import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGitHubProjectRegistry,
  createGitHubReadOnlyTool,
  SEBASTIAN_GITHUB_DEFAULT_BRANCH_ENV_VAR,
  SEBASTIAN_GITHUB_OWNER_ENV_VAR,
  SEBASTIAN_GITHUB_PROJECT_ALIASES_ENV_VAR,
  SEBASTIAN_GITHUB_PROJECT_ID_ENV_VAR,
  SEBASTIAN_GITHUB_PROJECT_NAME_ENV_VAR,
  SEBASTIAN_GITHUB_REPOSITORY_ENV_VAR,
  SEBASTIAN_GITHUB_TOKEN_ENV_VAR,
} from '../../application/GitHubProjectRegistryConfiguration.js';
import { GitHubReadOnlyTool } from '../../core/tool/GitHubReadOnlyTool.js';
import { ProjectRegistry } from '../../core/project/index.js';
import type { Logger } from '../../core/logger.js';

function validProjectEnv(overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    [SEBASTIAN_GITHUB_PROJECT_ID_ENV_VAR]: 'sebastiania',
    [SEBASTIAN_GITHUB_PROJECT_NAME_ENV_VAR]: 'SebastianIA',
    [SEBASTIAN_GITHUB_OWNER_ENV_VAR]: 'gahsantosss16-dev',
    [SEBASTIAN_GITHUB_REPOSITORY_ENV_VAR]: 'SebastianIA',
    [SEBASTIAN_GITHUB_DEFAULT_BRANCH_ENV_VAR]: 'main',
    ...overrides,
  };
}

function capturingLogger(): { readonly logger: Logger; readonly calls: Array<{ readonly level: string; readonly message: string; readonly metadata: unknown }> } {
  const calls: Array<{ readonly level: string; readonly message: string; readonly metadata: unknown }> = [];
  const record = (level: string) => (message: string, metadata?: Record<string, unknown>) => {
    calls.push({ level, message, metadata });
  };
  return {
    calls,
    logger: { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') },
  };
}

test('with no configuration, the registry is empty and read-only, and no GitHub tool is created', () => {
  const registry = createGitHubProjectRegistry({});

  assert.equal(registry.listDescriptors().length, 0);
  assert.throws(() =>
    registry.register({
      id: 'x',
      displayName: 'X',
      aliases: [],
      resourceKind: 'github-repository',
      remoteRepository: { owner: 'o', repository: 'r', defaultBranch: 'main' },
      permissions: { access: 'read-only' },
    }),
  );

  assert.equal(createGitHubReadOnlyTool({}, registry), undefined);
});

test('a complete set of SEBASTIAN_GITHUB_* env vars registers exactly one project', () => {
  const registry = createGitHubProjectRegistry(validProjectEnv());

  const resolved = registry.resolve('sebastiania');
  assert.equal(resolved?.id, 'sebastiania');
  assert.equal(resolved?.displayName, 'SebastianIA');
  assert.equal(resolved?.remoteRepository.owner, 'gahsantosss16-dev');
  assert.equal(resolved?.remoteRepository.repository, 'SebastianIA');
  assert.equal(resolved?.remoteRepository.defaultBranch, 'main');
  assert.equal(resolved?.permissions.access, 'read-only');
  assert.deepEqual(resolved?.aliases, []);
  assert.equal(registry.listDescriptors().length, 1);
});

test('SEBASTIAN_GITHUB_PROJECT_ALIASES accepts a plain comma-separated list, not JSON', () => {
  const env = validProjectEnv({ [SEBASTIAN_GITHUB_PROJECT_ALIASES_ENV_VAR]: 'Sebastian, Sebastian IA ,,  ' });

  const registry = createGitHubProjectRegistry(env);

  assert.equal(registry.resolve('Sebastian')?.id, 'sebastiania');
  assert.equal(registry.resolve('Sebastian IA')?.id, 'sebastiania');
  assert.deepEqual(registry.getById('sebastiania')?.aliases, ['Sebastian', 'Sebastian IA']);
});

for (const missingVar of [
  SEBASTIAN_GITHUB_PROJECT_ID_ENV_VAR,
  SEBASTIAN_GITHUB_PROJECT_NAME_ENV_VAR,
  SEBASTIAN_GITHUB_OWNER_ENV_VAR,
  SEBASTIAN_GITHUB_REPOSITORY_ENV_VAR,
  SEBASTIAN_GITHUB_DEFAULT_BRANCH_ENV_VAR,
]) {
  test(`an incomplete configuration (missing ${missingVar}) registers no project instead of a partial one`, () => {
    const env = validProjectEnv({ [missingVar]: '' });

    const registry = createGitHubProjectRegistry(env);

    assert.equal(registry.listDescriptors().length, 0);
    assert.equal(registry.resolve('sebastiania'), undefined);
  });
}

test('an incomplete configuration never throws - startup stays fail-soft', () => {
  assert.doesNotThrow(() => createGitHubProjectRegistry({ [SEBASTIAN_GITHUB_PROJECT_ID_ENV_VAR]: 'sebastiania' }));
});

test('no secret or configured value leaks into the resolved-configuration logs', () => {
  const { logger, calls } = capturingLogger();
  const env = validProjectEnv();

  createGitHubProjectRegistry(env, logger);
  createGitHubReadOnlyTool({ [SEBASTIAN_GITHUB_TOKEN_ENV_VAR]: 'a-very-secret-token-value' }, new ProjectRegistry(), logger);

  const serialized = JSON.stringify(calls);
  assert.equal(serialized.includes('gahsantosss16-dev'), false);
  assert.equal(serialized.includes('SebastianIA'), false);
  assert.equal(serialized.includes('a-very-secret-token-value'), false);
});

test('createGitHubReadOnlyTool returns a Tool only when SEBASTIAN_GITHUB_TOKEN is configured', () => {
  const registry = createGitHubProjectRegistry({});

  assert.equal(createGitHubReadOnlyTool({}, registry), undefined);
  assert.equal(createGitHubReadOnlyTool({ [SEBASTIAN_GITHUB_TOKEN_ENV_VAR]: '   ' }, registry), undefined);

  const tool = createGitHubReadOnlyTool({ [SEBASTIAN_GITHUB_TOKEN_ENV_VAR]: 'a-token' }, registry);
  assert.ok(tool instanceof GitHubReadOnlyTool);
});
