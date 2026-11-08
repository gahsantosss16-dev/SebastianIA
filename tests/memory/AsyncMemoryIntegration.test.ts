import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsyncFileMemoryStore, type AsyncMemoryStore } from '../../core/memory/AsyncMemoryStore.js';
import { FileMemoryStore } from '../../core/memory/FileMemoryStore.js';
import { FileCommandContextHydrator } from '../../core/memory/FileCommandContextHydrator.js';
import { FileCommandResultMemoryWriter } from '../../core/memory/FileCommandResultMemoryWriter.js';
import { ConversationRegistry } from '../../core/memory/ConversationRegistry.js';
import { CorePipelineBootstrap } from '../../core/CorePipelineBootstrap.js';
import { SebastianCore } from '../../core/core.js';
import { CoreCommandResultMemoryWriteBackError } from '../../core/CorePipelineIntegrationErrors.js';

/** A scheduling gate around the real file driver: never replaces reads or writes. */
class GatedFileStore implements AsyncMemoryStore {
  private releaseWrite!: () => void;
  private readonly gate = new Promise<void>((resolve) => { this.releaseWrite = resolve; });
  public constructor(private readonly store: AsyncFileMemoryStore) {}
  public release(): void { this.releaseWrite(); }
  public listRecords(namespace: string): ReturnType<AsyncMemoryStore['listRecords']> {
    return this.store.listRecords(namespace);
  }
  public async writeRecord(namespace: string, key: string, value: Readonly<Record<string, unknown>>): Promise<void> {
    await this.gate;
    await this.store.writeRecord(namespace, key, value);
  }
}

const input = {
  executionId: 'remember:async', commandType: 'remember',
  commandGeneratedAt: '2026-11-08T00:00:00.000Z', resultGeneratedAt: '2026-11-08T00:00:01.000Z',
  resultStatus: 'succeeded', output: { fact: 'persistir antes de confirmar' }, metadata: {},
};

async function withFile(run: (store: AsyncFileMemoryStore, path: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-async-memory-'));
  const path = join(root, 'memory.json');
  try { await run(new AsyncFileMemoryStore(new FileMemoryStore(path)), path); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function coreFor(store: AsyncMemoryStore): SebastianCore {
  const dependencies = new CorePipelineBootstrap({
    buildCommandContextHydrator: () => new FileCommandContextHydrator(store),
    buildCommandResultMemoryWriter: () => new FileCommandResultMemoryWriter(store),
  }).compose({
    providers: [{ providerId: 'async-test', listRegistrations: () => [{
      descriptor: { id: 'cap.remember', name: 'Remember', version: '1.0.0', handlerId: 'handler.remember' },
      handler: () => ({ fact: 'persistir antes de confirmar' }),
    }] }],
    bindings: [{ commandType: 'remember', capabilityId: 'cap.remember' }],
  });
  const core = new SebastianCore('Async test', {}, undefined, dependencies);
  core.initialize();
  core.start();
  return core;
}

const command = { type: 'remember', input: { fact: input.output.fact }, generatedAt: input.commandGeneratedAt };

test('Core waits for the real file write before reporting success and another instance hydrates the result', async () => {
  await withFile(async (store, path) => {
    const gated = new GatedFileStore(store);
    const core = coreFor(gated);
    let settled = false;
    const pending = core.executeCommand(command).then((result) => { settled = true; return result; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    assert.deepEqual(await store.listRecords('command-results'), []);
    gated.release();
    assert.equal((await pending).status, 'succeeded');
    const reopened = new AsyncFileMemoryStore(new FileMemoryStore(path));
    const hydration = await new FileCommandContextHydrator(reopened).hydrate({ commandType: 'recall', generatedAt: input.resultGeneratedAt });
    assert.equal(hydration.status, 'hydrated');
    if (hydration.status === 'hydrated') assert.equal((hydration.context.temporary?.values.rememberedFacts as { content: string }[])[0]?.content, input.output.fact);
  });
});

test('Core propagates a delayed real disk failure instead of reporting a recorded command', async () => {
  await withFile(async (store, path) => {
    const gated = new GatedFileStore(store);
    const pending = coreFor(gated).executeCommand(command);
    const rejected = assert.rejects(pending, CoreCommandResultMemoryWriteBackError);
    await new Promise<void>((resolve) => setImmediate(resolve));
    // Reading succeeded; replace the destination with a directory before the pending write.
    mkdirSync(path);
    gated.release();
    await rejected;
  });
});

test('conversation creation remains pending until its file record is durable', async () => {
  await withFile(async (store, path) => {
    const gated = new GatedFileStore(store);
    const registry = new ConversationRegistry(gated, new FileCommandContextHydrator(gated));
    let settled = false;
    const pending = registry.create().then((value) => { settled = true; return value; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    assert.deepEqual(await store.listRecords('conversations'), []);
    gated.release();
    const created = await pending;
    const reopened = new AsyncFileMemoryStore(new FileMemoryStore(path));
    assert.deepEqual(await new ConversationRegistry(reopened, new FileCommandContextHydrator(reopened)).get(created.id), created);
  });
});

test('async file adapter preserves corruption errors and never replaces corrupt history', async () => {
  await withFile(async (store, path) => {
    writeFileSync(path, '{invalid json');
    await assert.rejects(new FileCommandContextHydrator(store).hydrate({ commandType: 'recall', generatedAt: input.resultGeneratedAt }));
    const outcome = await new FileCommandResultMemoryWriter(store).write(input);
    assert.equal(outcome.status, 'failed');
    await assert.rejects(store.listRecords('command-results'));
  });
});
