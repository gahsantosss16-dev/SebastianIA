#!/usr/bin/env node

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../core/logger.js';
import { StudioGpuWorker } from '../studio/StudioGpuWorker.js';
import { createConfiguredStudioEngine } from './StudioEngineConfiguration.js';

/**
 * Sebastian Studio GPU worker: runs on the machine with the GPU, ComfyUI
 * (loopback) and the Work's composer. Connects out to the web app:
 *
 *   STUDIO_SERVER_URL=https://<sebastian> STUDIO_WORKER_TOKEN=<same as the web app>
 *   STUDIO_COMFYUI_URL=http://127.0.0.1:8188 STUDIO_COMFYUI_WORKFLOW_PATH=... STUDIO_COMPOSER_MODULE=...
 *   node dist/application/studio-worker.js
 */
const logger = createLogger();

async function main(): Promise<void> {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  try {
    const engine = await createConfiguredStudioEngine(process.env, logger);
    const status = await engine.availability();
    logger.info('Studio GPU worker local engine.', { engine: engine.id, available: status.available, message: status.message ?? '' });
    const worker = new StudioGpuWorker({
      serverUrl: process.env.STUDIO_SERVER_URL ?? '',
      workerToken: process.env.STUDIO_WORKER_TOKEN ?? '',
      engine,
      workDirectory: process.env.STUDIO_WORKER_DIR ?? join(tmpdir(), 'sebastian-studio-worker'),
      logger,
    });
    await worker.run(controller.signal);
  } catch (error) {
    logger.error('Studio GPU worker failed to start.', { message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }
}

void main();
