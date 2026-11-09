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
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { resolveMemoryFilePath } from '../core/memory/FileMemoryStoreLocation.js';
import { createSupabaseMemoryStore } from '../core/memory/PostgresMemoryStoreConfiguration.js';
import { migrateFileMemoryToPostgres, type MemoryMigrationMode } from '../core/memory/FileToPostgresMemoryMigration.js';

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
    if (persistence.driver === 'supabase' && process.env.SEBASTIAN_MEMORY_MIGRATION === 'copy') {
      // Cutover: copy the final file snapshot before serving. Fails closed; the file is never modified.
      await runFileToSupabaseMigration(dataDir, 'copy', true);
    }
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
    if (persistence.driver === 'file' && process.env.SEBASTIAN_SUPABASE_DATABASE_URL?.trim()) {
      // Background preflight while still serving from the file: never affects availability.
      void runSupabasePreflight(dataDir);
    }

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

/** Safe error fields only: never connection strings or credential material. */
function safeError(error: unknown): Record<string, unknown> {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : '';
  const secret = process.env.PGPASSWORD;
  const safeMessage = message.includes('://') || (secret !== undefined && secret !== '' && message.includes(secret)) ? 'redacted' : message.slice(0, 200);
  return { name: error instanceof Error ? error.name : 'UnknownError', ...(typeof code === 'string' && /^[0-9A-Z_]{2,40}$/.test(code) ? { code } : {}), message: safeMessage };
}

function expectedDatabaseUser(): string {
  try { return decodeURIComponent(new URL(process.env.SEBASTIAN_SUPABASE_DATABASE_URL ?? '').username).split('.')[0] ?? ''; } catch { return ''; }
}

async function runFileToSupabaseMigration(dataDir: string, mode: MemoryMigrationMode, failClosed: boolean): Promise<void> {
  const store = createSupabaseMemoryStore(process.env);
  try {
    await store.ready();
    const report = await migrateFileMemoryToPostgres(resolveMemoryFilePath(dataDir), store, mode);
    logger.info('Memory migration report.', { ...report });
    if (failClosed && !report.verified) throw new Error('Memory migration verification failed.');
  } catch (error) {
    if (failClosed) throw error;
    logger.error('Memory migration check failed.', safeError(error));
  } finally {
    await store.close().catch(() => undefined);
  }
}

async function runSupabasePreflight(dataDir: string): Promise<void> {
  const store = createSupabaseMemoryStore(process.env);
  try {
    await store.ready();
    const connection = await store.inspectSecureConnection(expectedDatabaseUser());
    const namespace = `validation-hostinger-preflight:${randomUUID()}`;
    const value = { probe: randomUUID(), at: new Date().toISOString() };
    const inserted = await store.insertRecordIfAbsent(namespace, 'connection-proof', value);
    const readBack = isDeepStrictEqual(await store.readRecord(namespace, 'connection-proof'), value);
    logger.info('Supabase preflight passed.', {
      identityVerified: connection.identityVerified, tlsVerified: connection.tlsVerified, tlsProtocol: connection.tlsProtocol,
      writeVerified: inserted, readVerified: readBack,
    });
  } catch (error) {
    logger.error('Supabase preflight failed.', safeError(error));
    return;
  } finally {
    await store.close().catch(() => undefined);
  }
  await runFileToSupabaseMigration(dataDir, 'dry-run', false);
}

void startOnlineServer();
