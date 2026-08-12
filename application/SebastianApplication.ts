import {
  bootstrapCoreOperationalRuntime,
  type CoreOperationalRuntimeBootstrapInput,
} from '../core/CoreOperationalRuntimeBootstrap.js';
import type { SebastianCore } from '../core/core.js';
import type { CoreConfig } from '../core/config.js';
import type { Logger } from '../core/logger.js';
import { resolveMemoryFilePath } from '../core/memory/index.js';
import {
  VALIDATION_TEST_TOOL_ID,
  VALIDATION_BUILD_TOOL_ID,
  VALIDATION_TYPECHECK_TOOL_ID,
  type AuthorizedCommandDefinition,
} from '../core/tool/index.js';
import {
  LOCAL_GREETING_CAPABILITY_ID,
  LOCAL_GREETING_COMMAND_TYPE,
  localGreetingCapabilityProvider,
} from './LocalGreetingCapabilityProvider.js';
import {
  LOCAL_MEMORY_RECALL_COMMAND_TYPE,
  LOCAL_MEMORY_REMEMBER_COMMAND_TYPE,
  MEMORY_RECALL_CAPABILITY_ID,
  MEMORY_REMEMBER_CAPABILITY_ID,
  localMemoryCapabilityProvider,
} from './LocalMemoryCapabilityProvider.js';
import {
  CONVERSE_CAPABILITY_ID,
  LOCAL_CONVERSE_COMMAND_TYPE,
  localConverseCapabilityProvider,
} from './LocalConverseCapabilityProvider.js';

export interface SebastianApplicationOptions {
  readonly name?: string;
  readonly config?: Partial<CoreConfig>;
  readonly logger?: Logger;
  /**
   * Directory where Sebastian IA persists local memory. When omitted, the
   * pipeline runs with non-persistent in-memory adapters (safe default for
   * tests and embedders that have not opted into disk persistence).
   */
  readonly dataDir?: string;
  /**
   * Root directory the filesystem inspection Tool is allowed to read from.
   * Defaults to `process.cwd()` - the seam exists so tests and future
   * hosting environments can isolate or override it explicitly, but it is
   * never derived from user input.
   */
  readonly allowedFilesystemRoot?: string;
  /**
   * Pre-authorized commands (e.g. `validation.test`) exposed to the Agent.
   * Never derived from user text. Defaults to this project's own build/test
   * pipeline - the seam exists so tests and other workspaces can override or
   * clear it explicitly.
   */
  readonly authorizedCommands?: readonly AuthorizedCommandDefinition[];
}

/**
 * This project's own default validation set, invoked without a shell by
 * running Node's built-in `--run <script>` against package.json scripts -
 * portable across platforms and, unlike spawning `npm`/`npm.cmd` directly,
 * never requires `shell: true` (which would reintroduce argument-injection
 * risk) to work on Windows.
 */
function defaultAuthorizedCommands(): readonly AuthorizedCommandDefinition[] {
  return [
    { toolId: VALIDATION_TEST_TOOL_ID, executable: process.execPath, args: ['--run', 'test'] },
    { toolId: VALIDATION_BUILD_TOOL_ID, executable: process.execPath, args: ['--run', 'build'] },
    { toolId: VALIDATION_TYPECHECK_TOOL_ID, executable: process.execPath, args: ['--run', 'typecheck'] },
  ];
}

export function createSebastianApplication(options: SebastianApplicationOptions = {}): SebastianCore {
  const memoryFilePath = options.dataDir === undefined ? undefined : resolveMemoryFilePath(options.dataDir);
  const allowedFilesystemRoot = options.allowedFilesystemRoot ?? process.cwd();
  const authorizedCommands = options.authorizedCommands ?? defaultAuthorizedCommands();

  const input: CoreOperationalRuntimeBootstrapInput = {
    composition: {
      providers: [localGreetingCapabilityProvider, localMemoryCapabilityProvider, localConverseCapabilityProvider],
      allowedFilesystemRoot,
      authorizedCommands,
      bindings: [
        {
          commandType: LOCAL_GREETING_COMMAND_TYPE,
          capabilityId: LOCAL_GREETING_CAPABILITY_ID,
        },
        {
          commandType: LOCAL_MEMORY_REMEMBER_COMMAND_TYPE,
          capabilityId: MEMORY_REMEMBER_CAPABILITY_ID,
        },
        {
          commandType: LOCAL_MEMORY_RECALL_COMMAND_TYPE,
          capabilityId: MEMORY_RECALL_CAPABILITY_ID,
        },
        {
          commandType: LOCAL_CONVERSE_COMMAND_TYPE,
          capabilityId: CONVERSE_CAPABILITY_ID,
        },
      ],
      ...(memoryFilePath === undefined ? {} : { memoryFilePath }),
    },
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.config === undefined ? {} : { config: options.config }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  };

  return bootstrapCoreOperationalRuntime(input);
}
