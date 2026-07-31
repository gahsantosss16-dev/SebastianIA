import type { CapabilityResult } from '../core/capability/index.js';
import type { CommandProcessingInput } from '../core/command/index.js';
import type { SebastianCore } from '../core/core.js';
import type { Logger } from '../core/logger.js';
import {
  InvalidLocalCommandArgumentsError,
  LocalCommandExecutionAndShutdownError,
  LocalCommandRuntimeShutdownError,
} from './LocalCommandInvocationErrors.js';
import { LOCAL_GREETING_COMMAND_TYPE } from './LocalGreetingCapabilityProvider.js';
import { createSebastianApplication } from './SebastianApplication.js';

interface CommandExecutor {
  executeCommand(input: CommandProcessingInput): CapabilityResult;
  shutdown(): void;
}

export interface LocalCommandInvocationDependencies {
  readonly createApplication?: () => CommandExecutor;
  readonly now?: () => Date;
}

export interface LocalCommandProcessOutput {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export class LocalCommandInvocationAdapter {
  private readonly createApplication: () => CommandExecutor;
  private readonly now: () => Date;

  public constructor(dependencies: LocalCommandInvocationDependencies = {}) {
    this.createApplication =
      dependencies.createApplication ?? (() => createSebastianApplication({ logger: silentLogger }));
    this.now = dependencies.now ?? (() => new Date());
  }

  public execute(args: readonly string[]): CapabilityResult {
    this.validateArgs(args);

    const input: CommandProcessingInput = {
      type: LOCAL_GREETING_COMMAND_TYPE,
      input: args[1] === undefined ? {} : { name: args[1] },
      generatedAt: this.now().toISOString(),
    };

    const application = this.createApplication();
    let result: CapabilityResult;

    try {
      result = application.executeCommand(input);
    } catch (executionError) {
      try {
        application.shutdown();
      } catch (shutdownError) {
        throw new LocalCommandExecutionAndShutdownError(executionError, shutdownError);
      }
      throw executionError;
    }

    try {
      application.shutdown();
    } catch (shutdownError) {
      throw new LocalCommandRuntimeShutdownError('Local command runtime shutdown failed.', {
        cause: shutdownError,
      });
    }

    return result;
  }

  private validateArgs(args: readonly string[]): void {
    if (!Array.isArray(args)) {
      throw new InvalidLocalCommandArgumentsError('Local command arguments must be an array.');
    }

    if (args.length === 0) {
      throw new InvalidLocalCommandArgumentsError('Command type is required. Usage: greeting [name].');
    }

    if (args[0] !== LOCAL_GREETING_COMMAND_TYPE) {
      throw new InvalidLocalCommandArgumentsError(
        `Unsupported local command: ${args[0] ?? ''}. Usage: greeting [name].`,
      );
    }

    if (args.length > 2) {
      throw new InvalidLocalCommandArgumentsError('Too many arguments. Usage: greeting [name].');
    }
  }
}

export function runLocalCommand(
  args: readonly string[],
  output: LocalCommandProcessOutput,
  adapter: LocalCommandInvocationAdapter = new LocalCommandInvocationAdapter(),
): number {
  try {
    const result = adapter.execute(args);
    output.stdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    output.stderr(`${JSON.stringify(serializeLocalCommandError(error))}\n`);
    return 1;
  }
}

function serializeLocalCommandError(error: unknown): Readonly<Record<string, unknown>> {
  if (error instanceof Error) {
    const code = (error as Error & { readonly code?: unknown }).code;
    return {
      name: error.constructor.name,
      message: error.message,
      ...(typeof code === 'string' ? { code } : {}),
    };
  }

  return {
    name: 'UnknownError',
    message: typeof error === 'string' ? error : 'A non-Error value was thrown.',
  };
}

export type LocalCommandApplication = SebastianCore;
