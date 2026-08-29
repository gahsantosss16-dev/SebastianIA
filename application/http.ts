#!/usr/bin/env node

import { createLogger } from '../core/logger.js';
import { createOnlineSebastianApplication } from './OnlineSebastianApplication.js';
import { join } from 'node:path';
import { createOnlineCognitiveModelProvider } from './OnlineCognitiveProviderConfiguration.js';
import { resolveSebastianDataDirectory } from '../core/memory/index.js';
import { resolveOnlineApiToken, resolveOnlinePort, SebastianHttpServer } from './SebastianHttpServer.js';

const logger = createLogger();

async function startOnlineServer(): Promise<void> {
  try {
    const apiToken = resolveOnlineApiToken();
    const port = resolveOnlinePort();
    const cognitiveModelProvider = createOnlineCognitiveModelProvider(process.env, logger);
    const dataDir = resolveSebastianDataDirectory();
    const application = createOnlineSebastianApplication(logger, cognitiveModelProvider, dataDir, process.env);
    const httpServer = new SebastianHttpServer({
      application,
      apiToken,
      logger,
      webSessionStateFilePath: join(dataDir, 'web-session.json'),
    });
    const started = await httpServer.listen(port);
    logger.info('Sebastian online started.', { port: started.port });

    let stopping = false;
    const shutdown = async (signal: string): Promise<void> => {
      if (stopping) {
        return;
      }
      stopping = true;
      logger.info('Sebastian online shutdown requested.', { signal });
      try {
        await started.close();
      } catch {
        process.exitCode = 1;
      }
    };

    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
  } catch (error) {
    logger.error('Sebastian online failed to start.', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'A non-Error value was thrown.',
    });
    process.exitCode = 1;
  }
}

void startOnlineServer();
