import {
  bootstrapCoreOperationalRuntime,
  type CoreOperationalRuntimeBootstrapInput,
} from '../core/CoreOperationalRuntimeBootstrap.js';
import type { SebastianCore } from '../core/core.js';
import type { CoreConfig } from '../core/config.js';
import type { Logger } from '../core/logger.js';
import { resolveMemoryFilePath } from '../core/memory/index.js';
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
}

export function createSebastianApplication(options: SebastianApplicationOptions = {}): SebastianCore {
  const memoryFilePath = options.dataDir === undefined ? undefined : resolveMemoryFilePath(options.dataDir);
  const allowedFilesystemRoot = options.allowedFilesystemRoot ?? process.cwd();

  const input: CoreOperationalRuntimeBootstrapInput = {
    composition: {
      providers: [localGreetingCapabilityProvider, localMemoryCapabilityProvider, localConverseCapabilityProvider],
      allowedFilesystemRoot,
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
