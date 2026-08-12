import { spawnSync } from 'node:child_process';
import {
  type SpecializedTool,
  type SpecializedToolInvocationInput,
  type SpecializedToolInvocationResult,
} from './SpecializedToolInvocationContract.js';
import {
  InvalidSpecializedToolInvocationInputError,
  SpecializedToolInvocationFailureError,
} from './SpecializedToolInvocationErrors.js';

/**
 * A single, pre-authorized command a workspace's composition chooses to
 * expose - never user text. `executable`/`args` are always spawned as a
 * structured array with `shell: false`; nothing derived from natural
 * language ever reaches this shape, so there is no path from a user's
 * sentence to a shell command line.
 */
export interface AuthorizedCommandDefinition {
  readonly toolId: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly timeoutMs?: number;
}

/**
 * Conventional, suggested toolIds for the three validations this project
 * itself exposes by default (see `application/SebastianApplication.ts`).
 * They are not special-cased anywhere in this Tool - any workspace is free
 * to register its own commands under entirely different toolIds (as long as
 * they use the `validation.` prefix the dispatcher routes on). These exist
 * purely so the temporary `DevelopmentModelProvider` and the default
 * composition can agree on the same literal strings without duplicating them.
 */
export const VALIDATION_TEST_TOOL_ID = 'validation.test';
export const VALIDATION_BUILD_TOOL_ID = 'validation.build';
export const VALIDATION_TYPECHECK_TOOL_ID = 'validation.typecheck';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;
/** Generous ceiling passed to spawnSync itself, so Node never errors out before we get a chance to truncate ourselves. */
const SPAWN_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

interface ValidationOkOutput {
  readonly operation: 'validation';
  readonly outcome: 'ok';
  readonly toolId: string;
  readonly succeeded: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly message: string;
}

interface ValidationRejectedOutput {
  readonly operation: 'validation';
  readonly outcome: 'rejected';
  readonly toolId: string;
  readonly reasonCode: 'notAuthorized' | 'timedOut';
  readonly message: string;
}

type ValidationOutput = ValidationOkOutput | ValidationRejectedOutput;

/**
 * Runs only commands the workspace's composition explicitly registered
 * ahead of time, keyed by their own `toolId` (e.g. `validation.test`). This
 * is deliberately not a generic `shell.run` - an unregistered `toolId`
 * (including anything the natural-language layer might dream up) is refused
 * as a normal, safe `outcome: 'rejected'` result, never executed.
 *
 * Trust boundary: an authorized command such as `validation.test` may
 * itself run scripts defined by the target project (e.g. via `npm test`).
 * Registering that command is the user explicitly authorizing execution of
 * that workspace's own validation scripts - this Tool does not attempt to
 * sandbox what those scripts do.
 */
export class LocalAuthorizedCommandTool implements SpecializedTool {
  private readonly allowedRoot: string;
  private readonly commandsById: ReadonlyMap<string, AuthorizedCommandDefinition>;

  public constructor(allowedRoot: string, commands: readonly AuthorizedCommandDefinition[]) {
    if (typeof allowedRoot !== 'string' || allowedRoot.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError(
        'Local authorized command tool allowed root must be a non-empty string.',
      );
    }
    if (!Array.isArray(commands)) {
      throw new InvalidSpecializedToolInvocationInputError('Local authorized command tool commands must be an array.');
    }

    const commandsById = new Map<string, AuthorizedCommandDefinition>();
    for (const command of commands) {
      this.validateCommandDefinition(command);
      commandsById.set(command.toolId, command);
    }

    this.allowedRoot = allowedRoot;
    this.commandsById = commandsById;
  }

  public invoke(input: SpecializedToolInvocationInput): SpecializedToolInvocationResult {
    this.validateInput(input);
    const definition = this.commandsById.get(input.toolId);

    if (!definition) {
      return this.completed(this.rejected(input.toolId, 'notAuthorized', `A validação "${input.toolId}" não está autorizada.`));
    }

    try {
      return this.completed(this.run(definition));
    } catch (error) {
      return {
        status: 'failed',
        error: new SpecializedToolInvocationFailureError('Local authorized command tool invocation failed.', {
          cause: error,
        }),
      };
    }
  }

  private run(definition: AuthorizedCommandDefinition): ValidationOutput {
    const timeoutMs = definition.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const result = spawnSync(definition.executable, definition.args, {
      cwd: this.allowedRoot,
      encoding: 'utf8',
      timeout: timeoutMs,
      shell: false,
      maxBuffer: SPAWN_MAX_BUFFER_BYTES,
    });

    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      if (code === 'ETIMEDOUT') {
        return this.rejected(
          definition.toolId,
          'timedOut',
          `A validação "${definition.toolId}" excedeu o tempo limite de ${timeoutMs}ms e foi encerrada.`,
        );
      }
      throw result.error;
    }

    const [stdout, stdoutTruncated] = this.truncate(result.stdout ?? '');
    const [stderr, stderrTruncated] = this.truncate(result.stderr ?? '');
    const exitCode = result.status;
    const succeeded = exitCode === 0;
    const summary = succeeded
      ? `Validação "${definition.toolId}" concluída com sucesso (exit code 0).`
      : `Validação "${definition.toolId}" falhou (exit code ${exitCode}).`;
    const details = [stderr, stdout].find((text) => text.trim() !== '');
    const message = succeeded || !details ? summary : `${summary}\n${details}`;

    return {
      operation: 'validation',
      outcome: 'ok',
      toolId: definition.toolId,
      succeeded,
      exitCode,
      stdout,
      stderr,
      stdoutTruncated,
      stderrTruncated,
      message,
    };
  }

  private truncate(text: string): readonly [string, boolean] {
    const buffer = Buffer.from(text, 'utf8');
    if (buffer.byteLength <= MAX_CAPTURED_OUTPUT_BYTES) {
      return [text, false];
    }
    return [buffer.subarray(0, MAX_CAPTURED_OUTPUT_BYTES).toString('utf8'), true];
  }

  private rejected(
    toolId: string,
    reasonCode: 'notAuthorized' | 'timedOut',
    message: string,
  ): ValidationOutput {
    return { operation: 'validation', outcome: 'rejected', toolId, reasonCode, message };
  }

  private completed(output: ValidationOutput): SpecializedToolInvocationResult {
    return {
      status: 'completed',
      output: Object.freeze({ ...output }) as Readonly<Record<string, unknown>>,
    };
  }

  private validateCommandDefinition(command: AuthorizedCommandDefinition): void {
    const isObject = command && typeof command === 'object' && !Array.isArray(command);
    if (!isObject) {
      throw new InvalidSpecializedToolInvocationInputError('Authorized command definition must be an object.');
    }
    if (typeof command.toolId !== 'string' || command.toolId.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError('Authorized command definition toolId must be a non-empty string.');
    }
    if (typeof command.executable !== 'string' || command.executable.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError(
        'Authorized command definition executable must be a non-empty string.',
      );
    }
    if (!Array.isArray(command.args) || command.args.some((arg) => typeof arg !== 'string')) {
      throw new InvalidSpecializedToolInvocationInputError('Authorized command definition args must be an array of strings.');
    }
  }

  private validateInput(input: SpecializedToolInvocationInput): void {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    if (!isObject) {
      throw new InvalidSpecializedToolInvocationInputError('Specialized tool invocation input must be an object.');
    }

    if (typeof input.toolId !== 'string' || input.toolId.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError('Specialized tool toolId must be a non-empty string.');
    }

    if (typeof input.executionId !== 'string' || input.executionId.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError('Specialized tool executionId must be a non-empty string.');
    }

    if (typeof input.responsibilityId !== 'string' || input.responsibilityId.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError(
        'Specialized tool responsibilityId must be a non-empty string.',
      );
    }

    if (typeof input.requestedAt !== 'string' || input.requestedAt.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError('Specialized tool requestedAt must be a non-empty string.');
    }

    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
      throw new InvalidSpecializedToolInvocationInputError('Specialized tool payload must be an object.');
    }
  }
}
