/** Explicit integration validation. Every query reaches a real PostgreSQL server.
 * Use a development connection URL, or an operator-serviced SQL bridge directory.
 * The bridge transports requests/results; it never implements or simulates SQL.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createSupabaseMemoryStore } from '../core/memory/PostgresMemoryStoreConfiguration.js';
import { PostgresMemoryStore, type SqlQueryable } from '../core/memory/PostgresMemoryStore.js';
import { AsyncPostgresMemoryStore, type AsyncMemoryStore } from '../core/memory/AsyncMemoryStore.js';
import { ConversationRegistry, FileCommandContextHydrator, FileCommandResultMemoryWriter } from '../core/memory/index.js';
import { createOnlineSebastianApplication } from '../application/OnlineSebastianApplication.js';
import { SebastianHttpServer } from '../application/SebastianHttpServer.js';
import { ProjectRegistry } from '../core/project/ProjectRegistry.js';
import { ProjectConversationContext } from '../core/project/ProjectConversationContext.js';
import { ProjectTaskOrchestrator } from '../core/project/ProjectTaskOrchestrator.js';
import { ClaudeCliProjectTaskExecutor } from '../core/project/ClaudeCliProjectTaskExecutor.js';
import { KnowledgeStore, ingestSource, searchKnowledge } from '../core/knowledge/index.js';
import type { Logger } from '../core/logger.js';

const options = new Map(process.argv.slice(2).map((arg) => { const split = arg.indexOf('='); return [arg.slice(0, split), arg.slice(split + 1)]; }));
const phase = options.get('--phase');
const runId = options.get('--run-id') ?? '';
const stateDir = options.get('--state-dir') ?? '';
if (!['write', 'read', 'isolation'].includes(phase ?? '') || !/^validation-[a-z0-9-]{1,64}$/.test(runId) || !stateDir) {
  throw new Error('Supply --phase=write|read|isolation --run-id=validation-<unique-id> --state-dir=<private-test-directory>.');
}
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const bridgeDir = options.get('--sql-bridge-dir');
let sequence = 0;
const database: SqlQueryable | undefined = bridgeDir === undefined ? undefined : {
  async query<Row extends Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<{ rows: readonly Row[] }> {
    mkdirSync(bridgeDir, { recursive: true, mode: 0o700 });
    const id = `${phase}-${sequence++}`;
    writeFileSync(join(bridgeDir, `${id}.request.json`), JSON.stringify({ id, text, values }), { mode: 0o600 });
    const responsePath = join(bridgeDir, `${id}.response.json`);
    const deadline = Date.now() + 120_000;
    while (!existsSync(responsePath)) {
      if (Date.now() > deadline) throw new Error('SQL bridge timed out; no query result was fabricated.');
      await delay(30);
    }
    const response = JSON.parse(readFileSync(responsePath, 'utf8')) as { rows?: Row[]; error?: string };
    if (response.error !== undefined) throw new Error(response.error);
    if (!Array.isArray(response.rows)) throw new Error('SQL bridge returned an invalid result.');
    return { rows: response.rows };
  },
};
const postgres = database === undefined
  ? createSupabaseMemoryStore(process.env)
  : new PostgresMemoryStore(database);
const driver = new AsyncPostgresMemoryStore(postgres);
// Synthetic namespaces never collide with the application's operational namespaces.
const store: AsyncMemoryStore = {
  listRecords: (namespace) => driver.listRecords(`${runId}:${namespace}`),
  writeRecord: (namespace, key, value) => driver.writeRecord(`${runId}:${namespace}`, key, value),
};
const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const registry = new ConversationRegistry(store, new FileCommandContextHydrator(store));
const projectRoot = join(stateDir, 'project');
mkdirSync(projectRoot, { recursive: true });
writeFileSync(join(projectRoot, 'CLAUDE.md'), '# Synthetic validation\nOnly this temporary checkout is permitted.');
const projects = new ProjectRegistry({ readOnly: true, entries: [{
  id: 'validation-project', displayName: 'Validation Project', aliases: ['Validation'], resourceKind: 'github-repository',
  remoteRepository: { owner: 'synthetic', repository: 'validation', defaultBranch: 'main' }, permissions: { access: 'read-only' },
  workspace: {
    root: projectRoot, environment: { id: 'validation', platform: process.platform as 'linux', label: 'Validation' },
    policySources: [{ path: 'CLAUDE.md', required: true, topics: [] }], validations: [],
    localWrite: { enabled: false }, close: { enabled: false, remoteName: 'origin', tagging: 'disabled' }, migrations: { paths: [] },
  },
}] });
const context = new ProjectConversationContext(projects, store, 'validation');
const tasks = new ProjectTaskOrchestrator(projects, store, new ClaudeCliProjectTaskExecutor(), 'validation');
const application = createOnlineSebastianApplication(logger, {
  decide: async () => ({ outcome: 'unavailable', reason: 'validation uses conversational replies only' }),
  respond: async (request) => ({ outcome: 'responded', answer: `Synthetic reply: ${request.text}` }),
}, undefined, { SEBASTIAN_STORE_DRIVER: 'supabase' }, context, tasks, store);
const server = new SebastianHttpServer({ application, apiToken: 'synthetic-validation-only-api-token', conversationRegistry: registry, sessionStore: store, logger, projectContext: context, projectTaskOrchestrator: tasks });
const manifestPath = join(stateDir, 'manifest.json');
interface Manifest { conversationA: string; conversationB: string; cookieA: string; cookieB: string; }
let running: Awaited<ReturnType<typeof server.listen>> | undefined;
let checks = 0;
try {
  await postgres.ready();
  running = await server.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${running.port}`;
  const call = async (path: string, cookie?: string, body?: Record<string, unknown>, method = body === undefined ? 'GET' : 'POST') => fetch(baseUrl + path, {
    method, headers: { ...(cookie === undefined ? {} : { Cookie: cookie }), Origin: baseUrl, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const login = async () => {
    const response = await call('/api/web/session', undefined, { token: 'synthetic-validation-only-api-token' });
    assert.equal(response.status, 201);
    return response.headers.get('set-cookie')!.split(';')[0]!;
  };
  if (phase === 'isolation') {
    const isolated: AsyncMemoryStore = {
      listRecords: (namespace) => driver.listRecords(`${runId}:collision:${namespace}`),
      writeRecord: (namespace, key, value) => driver.writeRecord(`${runId}:collision:${namespace}`, key, value),
    };
    const writer = new FileCommandResultMemoryWriter(isolated);
    await Promise.all(['conversation-a', 'conversation-b'].map((conversationId) => writer.write({
      executionId: 'same-command:same-timestamp', commandType: 'converse', commandGeneratedAt: '2026-11-08T00:00:00.000Z',
      resultGeneratedAt: '2026-11-08T00:00:01.000Z', resultStatus: 'succeeded', metadata: { conversationId },
      output: { conversationTurn: { requestText: conversationId, summary: 'Synthetic answer', kind: 'conversation' } },
    }).then((outcome) => { assert.equal(outcome.status, 'recorded'); })));
    assert.equal((await isolated.listRecords('command-results')).length, 2);
    const turns = new FileCommandContextHydrator(isolated);
    assert.deepEqual((await turns.listConversationTurns('conversation-a')).map((turn) => turn.requestText), ['conversation-a']);
    assert.deepEqual((await turns.listConversationTurns('conversation-b')).map((turn) => turn.requestText), ['conversation-b']);
    checks = 5;
  } else if (phase === 'write') {
    assert.deepEqual(await registry.list(), [], 'always use a unique validation run id');
    const cookieA = await login();
    const cookieB = await login();
    const a = await registry.create();
    const b = await registry.create();
    for (const [id, message] of [[a.id, 'Explique a marca sintética Aurora.'], [b.id, 'Explique a marca sintética Boreal.']]) {
      const response = await call('/api/web/converse', cookieA, { message, conversationId: id });
      assert.equal(response.status, 200, await response.text());
    }
    await application.executeCommand({ type: 'remember', input: { text: 'Synthetic permanent fact Aurora' }, generatedAt: new Date().toISOString() });
    const selected = await context.handle(a.id, 'Use Validation', 'validation-selection', new Date().toISOString());
    assert.equal(selected?.project?.id, 'validation-project');
    await store.writeRecord('project-tasks', a.id, { conversationId: a.id, taskId: 'synthetic-task', projectId: 'validation-project', status: 'completed', summary: 'Synthetic persisted task' });
    await ingestSource(new KnowledgeStore(store), {
      sourceId: 'validation-source', title: 'Synthetic Aurora', domain: 'validation', sourceType: 'internal-doc',
      authorityLevel: 'internal-doc', usageRights: 'synthetic test fixture', origin: 'validation',
      format: 'txt', rawText: 'Aurora persistence validates recovery across independent processes.', ingestedAt: new Date().toISOString(),
    });
    // Different keys, parallel real upserts; then overwrite one natural key.
    await Promise.all(Array.from({ length: 6 }, (_, i) => store.writeRecord('concurrency', `key-${i}`, { i })));
    await store.writeRecord('concurrency', 'key-0', { i: 99 });
    await assert.rejects(driver.writeRecord(`${runId}:failures`, 'invalid-array', [] as never));
    assert.deepEqual(await driver.listRecords(`${runId}:failures`), []);
    writeFileSync(manifestPath, JSON.stringify({ conversationA: a.id, conversationB: b.id, cookieA, cookieB } satisfies Manifest), { mode: 0o600 });
    checks = 10;
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    for (const cookie of [manifest.cookieA, manifest.cookieB]) {
      const response = await call('/api/web/session', cookie);
      assert.deepEqual(await response.json(), { authenticated: true });
    }
    const conversations = await registry.list();
    assert.equal(conversations.length, 2);
    assert.equal((await registry.get(manifest.conversationA))?.title, 'Explique a marca sintética Aurora.');
    const turnsA = (await registry.listTurns(manifest.conversationA))!;
    const turnsB = (await registry.listTurns(manifest.conversationB))!;
    assert.equal(turnsA.length, 1);
    assert.equal(turnsB.length, 1);
    assert.match(turnsA[0]!.requestText, /Aurora/);
    assert.equal(turnsA.some((turn) => turn.requestText.includes('Boreal')), false);
    assert.match(turnsB[0]!.requestText, /Boreal/);
    const facts = await new FileCommandContextHydrator(store).hydrate({ commandType: 'recall', generatedAt: new Date().toISOString() });
    assert.equal(facts.status, 'hydrated');
    if (facts.status === 'hydrated') assert.match(JSON.stringify(facts.context.temporary?.values.rememberedFacts), /Synthetic permanent fact Aurora/);
    assert.equal((await context.active(manifest.conversationA))?.id, 'validation-project');
    assert.equal(await context.active(manifest.conversationB), null);
    assert.equal((await tasks.currentTask(manifest.conversationA))?.taskId, 'synthetic-task');
    const hits = await searchKnowledge(new KnowledgeStore(store), { query: 'Aurora persistence', domain: 'validation' });
    assert.equal(hits[0]?.source.sourceId, 'validation-source');
    const rows = await store.listRecords('concurrency');
    assert.equal(rows.length, 6);
    assert.ok(rows.some((row) => row.i === 99));
    const logout = await call('/api/web/session', manifest.cookieA, undefined, 'DELETE');
    assert.equal(logout.status, 200);
    assert.deepEqual(await (await call('/api/web/session', manifest.cookieA)).json(), { authenticated: false });
    assert.deepEqual(await (await call('/api/web/session', manifest.cookieB)).json(), { authenticated: true });
    checks = 18;
  }
  assert.equal(existsSync(join(stateDir, 'memory.json')), false);
  console.log(JSON.stringify({ phase, runId, transport: bridgeDir === undefined ? 'pg.Pool' : 'operator SQL bridge', checks, status: 'passed' }));
} finally {
  if (running !== undefined) await running.close();
  else application.shutdown();
  await postgres.close();
}
