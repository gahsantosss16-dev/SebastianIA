import {
  DEFAULT_GEMINI_COGNITIVE_TIMEOUT_MS,
  GeminiCognitiveModelProvider,
  type CognitiveModelProvider,
} from '../core/cognition/index.js';
import type { Logger } from '../core/logger.js';

export const SEBASTIAN_COGNITIVE_PROVIDER_ENV_VAR = 'SEBASTIAN_COGNITIVE_PROVIDER';
export const SEBASTIAN_COGNITIVE_API_KEY_ENV_VAR = 'SEBASTIAN_COGNITIVE_API_KEY';
export const SEBASTIAN_COGNITIVE_MODEL_ENV_VAR = 'SEBASTIAN_COGNITIVE_MODEL';
export const SEBASTIAN_COGNITIVE_TIMEOUT_MS_ENV_VAR = 'SEBASTIAN_COGNITIVE_TIMEOUT_MS';

export function createOnlineCognitiveModelProvider(
  env: NodeJS.ProcessEnv = process.env,
  logger?: Logger,
): CognitiveModelProvider | undefined {
  const provider = env[SEBASTIAN_COGNITIVE_PROVIDER_ENV_VAR]?.trim().toLowerCase();
  const hasAnyCognitiveConfiguration = [
    SEBASTIAN_COGNITIVE_PROVIDER_ENV_VAR,
    SEBASTIAN_COGNITIVE_API_KEY_ENV_VAR,
    SEBASTIAN_COGNITIVE_MODEL_ENV_VAR,
    SEBASTIAN_COGNITIVE_TIMEOUT_MS_ENV_VAR,
  ].some((name) => env[name] !== undefined);

  if (!hasAnyCognitiveConfiguration) {
    logger?.info('Online cognitive provider configuration resolved.', {
      provider: 'none',
      outcome: 'notConfigured',
    });
    return undefined;
  }
  if (provider === 'disabled' || provider === 'none') {
    logger?.info('Online cognitive provider configuration resolved.', {
      provider: 'none',
      outcome: 'disabled',
    });
    return undefined;
  }
  if (provider !== 'gemini') {
    throw new Error('Online cognitive provider configuration is invalid or unsupported.');
  }

  const apiKey = env[SEBASTIAN_COGNITIVE_API_KEY_ENV_VAR];
  const model = env[SEBASTIAN_COGNITIVE_MODEL_ENV_VAR];
  if (typeof apiKey !== 'string' || apiKey.trim() === '' || typeof model !== 'string' || model.trim() === '') {
    throw new Error('Online Gemini cognitive configuration is incomplete.');
  }

  const timeoutMs = parseTimeout(env[SEBASTIAN_COGNITIVE_TIMEOUT_MS_ENV_VAR]);
  logger?.info('Online cognitive provider configuration resolved.', {
    provider: 'gemini',
    model: model.trim(),
    timeoutMs,
    outcome: 'configured',
  });
  return new GeminiCognitiveModelProvider({
    apiKey,
    model,
    timeoutMs,
    ...(logger === undefined ? {} : { logger }),
  });
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_GEMINI_COGNITIVE_TIMEOUT_MS;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error('Online Gemini cognitive timeout configuration is invalid.');
  }
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs >= 15_000) {
    throw new Error('Online Gemini cognitive timeout configuration is invalid.');
  }
  return timeoutMs;
}
