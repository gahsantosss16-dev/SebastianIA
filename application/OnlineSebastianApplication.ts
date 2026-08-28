import type { Logger } from '../core/logger.js';
import { RestrictedOnlineTool } from '../core/tool/index.js';
import { createSebastianApplication } from './SebastianApplication.js';

/**
 * Online composition root. It uses the same SebastianApplication/Core/Agent
 * graph as the CLI, but replaces the local dispatcher with a Tool boundary
 * that cannot perform side effects. No cognitive provider or persistent
 * memory adapter is configured by this foundation.
 */
export function createOnlineSebastianApplication(logger?: Logger) {
  return createSebastianApplication({
    ...(logger === undefined ? {} : { logger }),
    authorizedCommands: [],
    specializedTool: new RestrictedOnlineTool(),
  });
}
