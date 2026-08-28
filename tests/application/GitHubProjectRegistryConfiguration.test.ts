import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGitHubProjectRegistry,
  createGitHubReadOnlyTool,
  SEBASTIAN_GITHUB_PROJECTS_ENV_VAR,
  SEBASTIAN_GITHUB_TOKEN_ENV_VAR,
} from '../../application/GitHubProjectRegistryConfiguration.js';
import { GitHubReadOnlyTool } from '../../core/tool/GitHubReadOnlyTool.js';

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

test('createGitHubReadOnlyTool returns a Tool only when SEBASTIAN_GITHUB_TOKEN is configured', () => {
  const registry = createGitHubProjectRegistry({});

  assert.equal(createGitHubReadOnlyTool({}, registry), undefined);
  assert.equal(createGitHubReadOnlyTool({ [SEBASTIAN_GITHUB_TOKEN_ENV_VAR]: '   ' }, registry), undefined);

  const tool = createGitHubReadOnlyTool({ [SEBASTIAN_GITHUB_TOKEN_ENV_VAR]: 'a-token' }, registry);
  assert.ok(tool instanceof GitHubReadOnlyTool);
});
