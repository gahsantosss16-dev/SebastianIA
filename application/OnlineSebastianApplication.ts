import type { Logger } from '../core/logger.js';
import { GIT_STATUS_TOOL_ID, OnlineReadOnlyTool } from '../core/tool/index.js';
import type { CognitiveModelProvider } from '../core/cognition/index.js';
import { createSebastianApplication } from './SebastianApplication.js';

/**
 * Online composition root. It uses the same SebastianApplication/Core/Agent
 * graph as the CLI, but replaces the local dispatcher with a Tool boundary
 * that cannot perform side effects. A cognitive provider is optional and
 * injected explicitly by the HTTP composition; persistent memory remains
 * outside this profile.
 */
export function createOnlineSebastianApplication(
  logger?: Logger,
  cognitiveModelProvider?: CognitiveModelProvider,
  dataDir?: string,
) {
  return createSebastianApplication({
    ...(logger === undefined ? {} : { logger }),
    authorizedCommands: [],
    specializedTool: new OnlineReadOnlyTool(process.cwd()),
    ...(cognitiveModelProvider === undefined ? {} : { cognitiveModelProvider }),
    cognitiveOperationalTools: [{
      toolId: GIT_STATUS_TOOL_ID,
      description: 'Consulta branch e alterações pendentes do repositório atual, sem modificar nada.',
      requiresAuthorization: false,
      requiredStringArguments: [],
    }],
    ...(dataDir === undefined ? {} : { dataDir }),
  });
}
