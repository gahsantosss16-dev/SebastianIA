import type { CapabilityResult } from '../core/capability/index.js';
import type { CommandProcessingInput } from '../core/command/index.js';
import type { SebastianCore } from '../core/core.js';
import type { Logger } from '../core/logger.js';
import { resolveSebastianDataDirectory } from '../core/memory/index.js';
import {
  InvalidLocalCommandArgumentsError,
  LocalCommandExecutionAndShutdownError,
  LocalCommandRuntimeShutdownError,
} from './LocalCommandInvocationErrors.js';
import { LOCAL_GREETING_COMMAND_TYPE } from './LocalGreetingCapabilityProvider.js';
import {
  LOCAL_MEMORY_RECALL_COMMAND_TYPE,
  LOCAL_MEMORY_REMEMBER_COMMAND_TYPE,
} from './LocalMemoryCapabilityProvider.js';
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

interface LocalCommandDefinition {
  readonly type: string;
  readonly usage: string;
  readonly minArgs: number;
  readonly maxArgs: number;
  readonly buildInput: (args: readonly string[]) => Readonly<Record<string, unknown>>;
}

const COMMAND_DEFINITIONS: readonly LocalCommandDefinition[] = [
  {
    type: LOCAL_GREETING_COMMAND_TYPE,
    usage: 'greeting [name]',
    minArgs: 1,
    maxArgs: 2,
    buildInput: (args) => (args[1] === undefined ? {} : { name: args[1] }),
  },
  {
    type: LOCAL_MEMORY_REMEMBER_COMMAND_TYPE,
    usage: 'remember <text>',
    minArgs: 2,
    maxArgs: Number.POSITIVE_INFINITY,
    buildInput: (args) => {
      const text = args.slice(1).join(' ').trim();
      if (text === '') {
        throw new InvalidLocalCommandArgumentsError('Remembered fact text must not be empty. Usage: remember <text>.');
      }
      return { text };
    },
  },
  {
    type: LOCAL_MEMORY_RECALL_COMMAND_TYPE,
    usage: 'recall',
    minArgs: 1,
    maxArgs: 1,
    buildInput: () => ({}),
  },
];

const USAGE_SUMMARY = COMMAND_DEFINITIONS.map((definition) => definition.usage).join(' | ');

export class LocalCommandInvocationAdapter {
  private readonly createApplication: () => CommandExecutor;
  private readonly now: () => Date;

  public constructor(dependencies: LocalCommandInvocationDependencies = {}) {
    this.createApplication =
      dependencies.createApplication ??
      (() =>
        createSebastianApplication({
          logger: silentLogger,
          dataDir: resolveSebastianDataDirectory(),
        }));
    this.now = dependencies.now ?? (() => new Date());
  }

  public execute(args: readonly string[]): CapabilityResult {
    const { type, input: payload } = this.resolveCommand(args);

    const input: CommandProcessingInput = {
      type,
      input: payload,
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

  private resolveCommand(args: readonly string[]): {
    readonly type: string;
    readonly input: Readonly<Record<string, unknown>>;
  } {
    if (!Array.isArray(args)) {
      throw new InvalidLocalCommandArgumentsError('Local command arguments must be an array.');
    }

    if (args.length === 0) {
      throw new InvalidLocalCommandArgumentsError(`Command type is required. Usage: ${USAGE_SUMMARY}.`);
    }

    const definition = COMMAND_DEFINITIONS.find((candidate) => candidate.type === args[0]);
    if (!definition) {
      throw new InvalidLocalCommandArgumentsError(`Unsupported local command: ${args[0]}. Usage: ${USAGE_SUMMARY}.`);
    }

    if (args.length < definition.minArgs || args.length > definition.maxArgs) {
      throw new InvalidLocalCommandArgumentsError(
        `Invalid arguments for "${definition.type}". Usage: ${definition.usage}.`,
      );
    }

    return { type: definition.type, input: definition.buildInput(args) };
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
