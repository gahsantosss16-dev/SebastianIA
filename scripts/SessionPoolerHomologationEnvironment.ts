import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export const CONFIRMED_POOLER_HOST = 'aws-1-us-west-2.pooler.supabase.com';
export const CONFIRMED_POOLER_LOGIN = 'sebastian_app.smtyixukyexezjumouvw';

export class HomologationPreparationError extends Error {
  public constructor(public readonly code: string) { super('Homologation preparation failed.'); }
}

/** The returned environment contains a secret: keep it in process memory, never serialize it. */
export function prepareSessionPoolerEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new HomologationPreparationError('UNSAFE_TLS_ENVIRONMENT');
  if (env.SEBASTIAN_SUPABASE_SESSION_POOLER_HOST !== undefined && env.SEBASTIAN_SUPABASE_SESSION_POOLER_HOST !== CONFIRMED_POOLER_HOST) {
    throw new HomologationPreparationError('UNEXPECTED_POOLER_HOST');
  }
  const path = env.SEBASTIAN_SUPABASE_PASSWORD_FILE;
  if (!path || !isAbsolute(path)) throw new HomologationPreparationError('PASSWORD_FILE_REQUIRED');
  let password: string;
  try {
    const file = statSync(path);
    if (!file.isFile() || file.size > 8_192) throw new HomologationPreparationError('INVALID_PASSWORD_FILE');
    if ((file.mode & 0o077) !== 0) throw new HomologationPreparationError('INSECURE_PASSWORD_FILE_PERMISSIONS');
    password = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
  } catch (error) {
    if (error instanceof HomologationPreparationError) throw error;
    throw new HomologationPreparationError('PASSWORD_FILE_UNAVAILABLE');
  }
  if (!password || /[\r\n\0]/.test(password)) throw new HomologationPreparationError('INVALID_PASSWORD_FILE');
  const url = new URL(`postgresql://${CONFIRMED_POOLER_HOST}:5432/postgres`);
  url.username = CONFIRMED_POOLER_LOGIN;
  url.password = encodeURIComponent(password);
  url.searchParams.set('sslmode', 'verify-full');
  const prepared: NodeJS.ProcessEnv = {
    ...env,
    SEBASTIAN_STORE_DRIVER: 'supabase',
    SEBASTIAN_SUPABASE_CONNECTION_MODE: 'session-pooler',
    SEBASTIAN_SUPABASE_SESSION_POOLER_HOST: CONFIRMED_POOLER_HOST,
    SEBASTIAN_SUPABASE_DATABASE_URL: url.toString(),
  };
  // Never use an inherited administrative password as a fallback.
  delete prepared.PGPASSWORD;
  return prepared;
}
