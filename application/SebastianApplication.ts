import {
  bootstrapCoreOperationalRuntime,
  type CoreOperationalRuntimeBootstrapInput,
} from '../core/CoreOperationalRuntimeBootstrap.js';
import type { SebastianCore } from '../core/core.js';
import type { CoreConfig } from '../core/config.js';
import type { Logger } from '../core/logger.js';
import {
  LOCAL_GREETING_CAPABILITY_ID,
  LOCAL_GREETING_COMMAND_TYPE,
  localGreetingCapabilityProvider,
} from './LocalGreetingCapabilityProvider.js';

export interface SebastianApplicationOptions {
  readonly name?: string;
  readonly config?: Partial<CoreConfig>;
  readonly logger?: Logger;
}

export function createSebastianApplication(options: SebastianApplicationOptions = {}): SebastianCore {
  const input: CoreOperationalRuntimeBootstrapInput = {
    composition: {
      providers: [localGreetingCapabilityProvider],
      bindings: [
        {
          commandType: LOCAL_GREETING_COMMAND_TYPE,
          capabilityId: LOCAL_GREETING_CAPABILITY_ID,
        },
      ],
    },
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.config === undefined ? {} : { config: options.config }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  };

  return bootstrapCoreOperationalRuntime(input);
}
