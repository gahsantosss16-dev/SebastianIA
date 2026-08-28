import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOnlineCognitiveModelProvider,
  SEBASTIAN_COGNITIVE_API_KEY_ENV_VAR,
  SEBASTIAN_COGNITIVE_MODEL_ENV_VAR,
  SEBASTIAN_COGNITIVE_PROVIDER_ENV_VAR,
  SEBASTIAN_COGNITIVE_TIMEOUT_MS_ENV_VAR,
} from '../../application/OnlineCognitiveProviderConfiguration.js';
import { GeminiCognitiveModelProvider } from '../../core/cognition/GeminiCognitiveModelProvider.js';
import type { Logger } from '../../core/logger.js';

test('SPEC-050: absent or explicitly disabled provider preserves deterministic online behavior', () => {
  assert.equal(createOnlineCognitiveModelProvider({}), undefined);
  assert.equal(
    createOnlineCognitiveModelProvider({ [SEBASTIAN_COGNITIVE_PROVIDER_ENV_VAR]: 'disabled' }),
    undefined,
  );
});

test('SPEC-050: complete Gemini environment creates the remote provider', () => {
  const provider = createOnlineCognitiveModelProvider({
    [SEBASTIAN_COGNITIVE_PROVIDER_ENV_VAR]: 'gemini',
    [SEBASTIAN_COGNITIVE_API_KEY_ENV_VAR]: 'fake-key',
    [SEBASTIAN_COGNITIVE_MODEL_ENV_VAR]: 'gemini-2.5-flash-lite',
    [SEBASTIAN_COGNITIVE_TIMEOUT_MS_ENV_VAR]: '7000',
  });

  assert.ok(provider instanceof GeminiCognitiveModelProvider);
});

test('SPEC-050: partial, unsupported or invalid-timeout configuration fails safely without secret values', () => {
  const secret = 'must-never-appear';
  const invalidEnvironments: NodeJS.ProcessEnv[] = [
    { [SEBASTIAN_COGNITIVE_API_KEY_ENV_VAR]: secret },
    { [SEBASTIAN_COGNITIVE_PROVIDER_ENV_VAR]: 'unknown', [SEBASTIAN_COGNITIVE_API_KEY_ENV_VAR]: secret },
    {
      [SEBASTIAN_COGNITIVE_PROVIDER_ENV_VAR]: 'gemini',
      [SEBASTIAN_COGNITIVE_API_KEY_ENV_VAR]: secret,
    },
    {
      [SEBASTIAN_COGNITIVE_PROVIDER_ENV_VAR]: 'gemini',
      [SEBASTIAN_COGNITIVE_API_KEY_ENV_VAR]: secret,
      [SEBASTIAN_COGNITIVE_MODEL_ENV_VAR]: 'gemini-2.5-flash-lite',
      [SEBASTIAN_COGNITIVE_TIMEOUT_MS_ENV_VAR]: '15000',
    },
  ];

  for (const env of invalidEnvironments) {
    assert.throws(
      () => createOnlineCognitiveModelProvider(env),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes(secret), false);
        return true;
      },
    );
  }
});

test('online cognitive configuration logs only safe provider metadata', () => {
  const entries: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug: () => undefined,
    info: (message, metadata) => entries.push({ message, ...(metadata === undefined ? {} : { metadata }) }),
    warn: () => undefined,
    error: () => undefined,
  };
  const secret = 'configuration-secret-never-logged';

  createOnlineCognitiveModelProvider(
    {
      [SEBASTIAN_COGNITIVE_PROVIDER_ENV_VAR]: 'gemini',
      [SEBASTIAN_COGNITIVE_API_KEY_ENV_VAR]: secret,
      [SEBASTIAN_COGNITIVE_MODEL_ENV_VAR]: 'gemini-2.5-flash-lite',
      [SEBASTIAN_COGNITIVE_TIMEOUT_MS_ENV_VAR]: '7000',
    },
    logger,
  );

  assert.deepEqual(entries, [
    {
      message: 'Online cognitive provider configuration resolved.',
      metadata: {
        provider: 'gemini',
        model: 'gemini-2.5-flash-lite',
        timeoutMs: 7000,
        outcome: 'configured',
      },
    },
  ]);
  assert.equal(JSON.stringify(entries).includes(secret), false);
});
