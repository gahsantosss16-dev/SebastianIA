#!/usr/bin/env node

import { createLogger } from '../core/logger.js';
import { createOnlineSebastianApplication } from './OnlineSebastianApplication.js';
import { resolveOnlineApiToken, resolveOnlinePort, SebastianHttpServer } from './SebastianHttpServer.js';

const logger = createLogger();

async function startOnlineServer(): Promise<void> {
  try {
    const apiToken = resolveOnlineApiToken();
    const port = resolveOnlinePort();
    const application = createOnlineSebastianApplication(logger);
    const httpServer = new SebastianHttpServer({ application, apiToken, logger });
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
  } catch {
    logger.error('Sebastian online failed to start.');
    process.exitCode = 1;
  }
}

void startOnlineServer();
