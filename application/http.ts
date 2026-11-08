#!/usr/bin/env node

import { createLogger } from '../core/logger.js';
import { createOnlineSebastianApplication } from './OnlineSebastianApplication.js';
import { join } from 'node:path';
import { createOnlineCognitiveModelProvider } from './OnlineCognitiveProviderConfiguration.js';
import {
  ConversationRegistry,
  FileCommandContextHydrator,
  createMemoryStoreRuntime,
  type MemoryStoreRuntime,
  resolveSebastianDataDirectory,
} from '../core/memory/index.js';
import { resolveOnlineApiToken, resolveOnlinePort, SebastianHttpServer } from './SebastianHttpServer.js';
import { resolveBuildProvenance } from './BuildProvenance.js';

import { createConfiguredProjectContext, createConfiguredProjectTaskOrchestrator, inspectProjectConfiguration } from './ProjectConfiguration.js';
const logger = createLogger();

async function startOnlineServer(): Promise<void> {
  let persistence: MemoryStoreRuntime | undefined;
  try {
    const projectRuntime = inspectProjectConfiguration(process.env);
    logger.info('Project selection runtime resolved.', { ...projectRuntime });
    const apiToken = resolveOnlineApiToken();
    const port = resolveOnlinePort();
    const cognitiveModelProvider = createOnlineCognitiveModelProvider(process.env, logger);
    const dataDir = resolveSebastianDataDirectory();
    persistence = createMemoryStoreRuntime(dataDir);
    await persistence.ready();
    const projectContext = createConfiguredProjectContext(dataDir, process.env, persistence.store);
    const projectTaskOrchestrator = createConfiguredProjectTaskOrchestrator(dataDir, process.env, undefined, cognitiveModelProvider, persistence.store);
    const application = createOnlineSebastianApplication(logger, cognitiveModelProvider, dataDir, process.env, projectContext, projectTaskOrchestrator, persistence.store);
    const conversationHydrator = new FileCommandContextHydrator(persistence.store);
    const conversationRegistry = new ConversationRegistry(persistence.store, conversationHydrator);
    const httpServer = new SebastianHttpServer({
      application,
      apiToken,
      conversationRegistry,
      ...(projectContext === undefined ? {} : { projectContext }),
      ...(projectTaskOrchestrator === undefined ? {} : { projectTaskOrchestrator }),
      logger,
      ...(persistence.driver === 'supabase'
        ? { sessionStore: persistence.store }
        : { webSessionStateFilePath: join(dataDir, 'web-session.json') }),
      closePersistence: () => persistence!.close(),
    });
    const started = await httpServer.listen(port);
    const build = resolveBuildProvenance();
    logger.info('Sebastian online started.', { port: started.port, memoryDriver: persistence.driver, buildSha: build.sha, buildSource: build.source });

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
    await persistence?.close().catch(() => { process.exitCode = 1; });
    logger.error('Sebastian online failed to start.', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'A non-Error value was thrown.',
    });
    process.exitCode = 1;
  }
}

void startOnlineServer();
