#!/usr/bin/env node

import { createLogger } from '../core/logger.js';
import { createOnlineSebastianApplication } from './OnlineSebastianApplication.js';
import { join } from 'node:path';
import { createOnlineCognitiveModelProvider } from './OnlineCognitiveProviderConfiguration.js';
import {
  ConversationRegistry,
  FileCommandContextHydrator,
  FileMemoryStore,
  resolveMemoryFilePath,
  resolveSebastianDataDirectory,
} from '../core/memory/index.js';
import { resolveOnlineApiToken, resolveOnlinePort, SebastianHttpServer } from './SebastianHttpServer.js';
import { resolveBuildProvenance } from './BuildProvenance.js';

const logger = createLogger();

async function startOnlineServer(): Promise<void> {
  try {
    const apiToken = resolveOnlineApiToken();
    const port = resolveOnlinePort();
    const cognitiveModelProvider = createOnlineCognitiveModelProvider(process.env, logger);
    const dataDir = resolveSebastianDataDirectory();
    const application = createOnlineSebastianApplication(logger, cognitiveModelProvider, dataDir, process.env);
    // A second reader over the same memory.json document - safe by
    // FileMemoryStore's own design (every read re-parses from disk, no
    // shared in-process cache) - so the HTTP layer can list/validate/reopen
    // conversations without threading conversation CRUD through Core's
    // cognition-facing command pipeline.
    const conversationMemoryStore = new FileMemoryStore(resolveMemoryFilePath(dataDir));
    const conversationHydrator = new FileCommandContextHydrator(conversationMemoryStore);
    const conversationRegistry = new ConversationRegistry(conversationMemoryStore, conversationHydrator);
    const httpServer = new SebastianHttpServer({
      application,
      apiToken,
      conversationRegistry,
      logger,
      webSessionStateFilePath: join(dataDir, 'web-session.json'),
    });
    const started = await httpServer.listen(port);
    const build = resolveBuildProvenance();
    logger.info('Sebastian online started.', { port: started.port, buildSha: build.sha, buildSource: build.source });

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
