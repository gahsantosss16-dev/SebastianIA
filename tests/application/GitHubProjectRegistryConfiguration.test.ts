import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGitHubProjectRegistry,
  createGitHubReadOnlyTool,
  SEBASTIAN_GITHUB_PROJECTS_ENV_VAR,
  SEBASTIAN_GITHUB_TOKEN_ENV_VAR,
} from '../../application/GitHubProjectRegistryConfiguration.js';
import { GitHubReadOnlyTool } from '../../core/tool/GitHubReadOnlyTool.js';
import type { Logger } from '../../core/logger.js';

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

test('a well-formed SEBASTIAN_GITHUB_PROJECTS entry registers a project resolvable by its alias', () => {
  const env = {
    [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: JSON.stringify([
      { id: 'neuro-hub-pro', displayName: 'Neuro Hub Pro', aliases: ['Neuro Hub'], owner: 'sebastian-org', repository: 'neuro-hub', defaultBranch: 'main' },
    ]),
  };

  const registry = createGitHubProjectRegistry(env);
  const resolved = registry.resolve('Neuro Hub');

  assert.equal(resolved?.id, 'neuro-hub-pro');
  assert.equal(resolved?.remoteRepository.owner, 'sebastian-org');
  assert.equal(resolved?.permissions.access, 'read-only');
});

test('invalid JSON in SEBASTIAN_GITHUB_PROJECTS fails startup loudly instead of registering a partial project', () => {
  assert.throws(() => createGitHubProjectRegistry({ [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: '{not json' }));
});

test('a leading UTF-8 BOM (as some hosting panels add when persisting the env var) does not block parsing', () => {
  const byteOrderMark = String.fromCharCode(0xfeff);
  const env = {
    [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: byteOrderMark + JSON.stringify([
      { id: 'neuro-hub-pro', displayName: 'Neuro Hub Pro', aliases: ['Neuro Hub'], owner: 'sebastian-org', repository: 'neuro-hub', defaultBranch: 'main' },
    ]),
  };

  const registry = createGitHubProjectRegistry(env);

  assert.equal(registry.resolve('Neuro Hub')?.id, 'neuro-hub-pro');
});

test('outer whitespace around an otherwise valid SEBASTIAN_GITHUB_PROJECTS value does not block parsing', () => {
  const env = {
    [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: `  \n${JSON.stringify([
      { id: 'neuro-hub-pro', displayName: 'Neuro Hub Pro', aliases: ['Neuro Hub'], owner: 'sebastian-org', repository: 'neuro-hub', defaultBranch: 'main' },
    ])}\n  `,
  };

  const registry = createGitHubProjectRegistry(env);

  assert.equal(registry.resolve('Neuro Hub')?.id, 'neuro-hub-pro');
});

test('a value that is genuinely invalid JSON is still rejected even after BOM/whitespace normalization', () => {
  const byteOrderMark = String.fromCharCode(0xfeff);

  assert.throws(() => createGitHubProjectRegistry({ [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: `${byteOrderMark}  {not json  ` }));
  assert.throws(() => createGitHubProjectRegistry({ [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: "'[{\"id\":\"x\"}]'" }), 'an extra layer of wrapping quotes must not be auto-unwrapped');
});

test('a non-array SEBASTIAN_GITHUB_PROJECTS value is rejected', () => {
  assert.throws(() => createGitHubProjectRegistry({ [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: JSON.stringify({ id: 'x' }) }));
});

test('an entry missing a required field is rejected', () => {
  const env = {
    [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: JSON.stringify([{ id: 'neuro-hub-pro', displayName: 'Neuro Hub Pro' }]),
  };

  assert.throws(() => createGitHubProjectRegistry(env));
});

test('field-shape validation still applies unchanged after BOM/whitespace normalization', () => {
  const byteOrderMark = String.fromCharCode(0xfeff);
  const env = {
    [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: `${byteOrderMark}  ${JSON.stringify([{ id: 'neuro-hub-pro', displayName: 'Neuro Hub Pro' }])}  `,
  };

  assert.throws(() => createGitHubProjectRegistry(env));
});

test('an entry with an unsupported field (e.g. a token or url) is rejected rather than silently ignored', () => {
  const env = {
    [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: JSON.stringify([
      {
        id: 'neuro-hub-pro',
        displayName: 'Neuro Hub Pro',
        owner: 'sebastian-org',
        repository: 'neuro-hub',
        defaultBranch: 'main',
        token: 'should-not-be-here',
      },
    ]),
  };

  assert.throws(() => createGitHubProjectRegistry(env));
});

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

test('a JSON parse failure logs a safe, bounded diagnostic and never the configured value itself', () => {
  const { logger, calls } = capturingLogger();
  const secretLikeValue = 'gahsantosss16-dev/SebastianIA-super-secret-owner-repo-9f31c2';
  const env = {
    [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: `{not json but mentions "${secretLikeValue}" and a token abc123secret`,
  };

  assert.throws(
    () => createGitHubProjectRegistry(env, logger),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'GitHub project registry configuration is not valid JSON.');
      return true;
    },
  );

  const errorCalls = calls.filter((call) => call.level === 'error');
  assert.equal(errorCalls.length, 1);
  const diagnostic = errorCalls[0]?.metadata as Record<string, unknown>;

  assert.equal(typeof diagnostic.rawLength, 'number');
  assert.equal(typeof diagnostic.normalizedLength, 'number');
  assert.equal(typeof diagnostic.startsWithBracket, 'boolean');
  assert.equal(typeof diagnostic.endsWithBracket, 'boolean');
  assert.equal(typeof diagnostic.startsWithSingleQuote, 'boolean');
  assert.equal(typeof diagnostic.startsWithDoubleQuote, 'boolean');
  assert.equal(typeof diagnostic.endsWithSingleQuote, 'boolean');
  assert.equal(typeof diagnostic.endsWithDoubleQuote, 'boolean');
  assert.equal(typeof diagnostic.containsNullCharacter, 'boolean');
  assert.equal(typeof diagnostic.syntaxErrorMessage, 'string');

  const serializedCalls = JSON.stringify(calls);
  assert.equal(serializedCalls.includes(secretLikeValue), false);
  assert.equal(serializedCalls.includes('gahsantosss16-dev'), false);
  assert.equal(serializedCalls.includes('SebastianIA'), false);
  assert.equal(serializedCalls.includes('abc123secret'), false);
  assert.equal(serializedCalls.includes(env[SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]), false);
});

test('a BOM-prefixed value that still fails after normalization is diagnosed without leaking content', () => {
  const { logger, calls } = capturingLogger();
  const byteOrderMark = String.fromCharCode(0xfeff);
  const secretLikeValue = 'owner=gahsantosss16-dev repository=SebastianIA';
  const env = {
    [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: `${byteOrderMark}not an array, but has ${secretLikeValue}`,
  };

  assert.throws(() => createGitHubProjectRegistry(env, logger));

  const diagnostic = calls.find((call) => call.level === 'error')?.metadata as Record<string, unknown>;
  assert.ok(diagnostic);
  assert.equal(diagnostic.startsWithBracket, false);
  assert.equal(JSON.stringify(calls).includes(secretLikeValue), false);
});

test('a successful parse never logs an error-level diagnostic', () => {
  const { logger, calls } = capturingLogger();
  const env = {
    [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: JSON.stringify([
      { id: 'neuro-hub-pro', displayName: 'Neuro Hub Pro', owner: 'sebastian-org', repository: 'neuro-hub', defaultBranch: 'main' },
    ]),
  };

  createGitHubProjectRegistry(env, logger);

  assert.equal(calls.some((call) => call.level === 'error'), false);
});

test('createGitHubReadOnlyTool returns a Tool only when SEBASTIAN_GITHUB_TOKEN is configured', () => {
  const registry = createGitHubProjectRegistry({});

  assert.equal(createGitHubReadOnlyTool({}, registry), undefined);
  assert.equal(createGitHubReadOnlyTool({ [SEBASTIAN_GITHUB_TOKEN_ENV_VAR]: '   ' }, registry), undefined);

  const tool = createGitHubReadOnlyTool({ [SEBASTIAN_GITHUB_TOKEN_ENV_VAR]: 'a-token' }, registry);
  assert.ok(tool instanceof GitHubReadOnlyTool);
});
