import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOnlineSebastianApplication } from '../../application/OnlineSebastianApplication.js';
import type { CognitiveConversationRequest, CognitiveDecisionRequest, CognitiveModelProvider } from '../../core/cognition/index.js';
import type { Logger } from '../../core/logger.js';
import { AsyncFileMemoryStore, AsyncPostgresMemoryStore, type AsyncMemoryStore } from '../../core/memory/AsyncMemoryStore.js';
import { FileMemoryStore } from '../../core/memory/FileMemoryStore.js';
import { PostgresMemoryStore, type SqlQueryable } from '../../core/memory/PostgresMemoryStore.js';

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** Stand-in for sebastian.memory_records honouring the list/upsert SQL used at runtime. */
function postgresLikeStore(): AsyncMemoryStore {
  const rows = new Map<string, Map<string, string>>();
  const database: SqlQueryable = {
    query: async (text: string, values: readonly unknown[] = []) => {
      const [namespace, key, json] = values as string[];
      if (text.includes('on conflict (namespace, record_key) do update')) {
        if (!rows.has(namespace!)) rows.set(namespace!, new Map());
        rows.get(namespace!)!.set(key!, json!);
        return { rows: [] };
      }
      if (text.includes('where namespace = $1 order by record_key asc')) {
        const records = [...(rows.get(namespace!) ?? new Map<string, string>()).entries()].sort(([a], [b]) => a.localeCompare(b));
        return { rows: records.map(([, value_json]) => ({ value_json })) as never[] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return new AsyncPostgresMemoryStore(new PostgresMemoryStore(database));
}

function recordingProvider() {
  const respondRequests: CognitiveConversationRequest[] = [];
  const decideRequests: CognitiveDecisionRequest[] = [];
  const provider: CognitiveModelProvider = {
    decide: async (request) => { decideRequests.push(request); return { outcome: 'unavailable', reason: 'test' }; },
    respond: async (request) => {
      respondRequests.push(request);
      const facts = request.relevantFacts ?? [];
      return { outcome: 'responded', answer: facts.length === 0 ? 'Sem fatos.' : `Fatos: ${facts.map((fact) => fact.content).join(' | ')}` };
    },
  };
  return { provider, respondRequests, decideRequests };
}

let second = 0;
function command(text: string) {
  second += 1;
  const at = new Date(Date.UTC(2026, 10, 9, 1, 0, 0) + second * 1_000).toISOString();
  return { type: 'converse', input: { text }, generatedAt: at };
}

const stores: readonly [string, () => { store: AsyncMemoryStore; dataDir: string }][] = [
  ['file', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-facts-'));
    return { dataDir, store: new AsyncFileMemoryStore(new FileMemoryStore(join(dataDir, 'memory.json'))) };
  }],
  ['postgres', () => ({ dataDir: mkdtempSync(join(tmpdir(), 'sebastian-facts-')), store: postgresLikeStore() })],
];

for (const [driver, create] of stores) {
  test(`[${driver}] a fact saved with "lembra que" reaches the cognitive provider after a restart`, async () => {
    const { store, dataDir } = create();
    const first = createOnlineSebastianApplication(logger, recordingProvider().provider, dataDir, {}, undefined, undefined, store);
    const saved = await first.executeCommand(command('lembra que o código de homologação da memória é JABUTI-2611'));
    assert.equal(saved.output.memoryRecordKind, 'sebastian.memory.fact');

    // New application instance over the same persisted store: simulates restart/deploy.
    const { provider, respondRequests } = recordingProvider();
    const restarted = createOnlineSebastianApplication(logger, provider, dataDir, {}, undefined, undefined, store);
    const answer = await restarted.executeCommand(command('qual código JABUTI eu te pedi para lembrar?'));
    assert.match(String(answer.output.message), /JABUTI-2611/);
    assert.deepEqual(respondRequests.at(-1)?.relevantFacts?.map((fact) => fact.content), ['o código de homologação da memória é JABUTI-2611']);
  });

  test(`[${driver}] unrelated questions receive no facts`, async () => {
    const { store, dataDir } = create();
    const app = createOnlineSebastianApplication(logger, recordingProvider().provider, dataDir, {}, undefined, undefined, store);
    await app.executeCommand(command('lembra que o código de homologação da memória é JABUTI-2611'));
    const { provider, respondRequests } = recordingProvider();
    const next = createOnlineSebastianApplication(logger, provider, dataDir, {}, undefined, undefined, store);
    await next.executeCommand(command('explique a diferença entre TCP e UDP'));
    assert.equal(respondRequests.at(-1)?.relevantFacts, undefined);
  });

  test(`[${driver}] duplicated facts are sent once and a memory question is bounded to five facts`, async () => {
    const { store, dataDir } = create();
    const app = createOnlineSebastianApplication(logger, recordingProvider().provider, dataDir, {}, undefined, undefined, store);
    await app.executeCommand(command('lembra que minha cor favorita é verde-água'));
    await app.executeCommand(command('lembra que minha cor favorita é verde-água'));
    for (let index = 1; index <= 6; index += 1) await app.executeCommand(command(`lembra que o item ${index} da lista é ${index * 11}`));

    const { provider, respondRequests, decideRequests } = recordingProvider();
    const next = createOnlineSebastianApplication(logger, provider, dataDir, {}, undefined, undefined, store);
    await next.executeCommand(command('qual é minha cor favorita?'));
    assert.deepEqual(respondRequests.at(-1)?.relevantFacts?.map((fact) => fact.content), ['minha cor favorita é verde-água']);

    // ("o que você lembra?" keeps its existing deterministic recall; this phrasing reaches the model.)
    await next.executeCommand(command('quais coisas eu te pedi para lembrar?'));
    const facts = respondRequests.at(-1)?.relevantFacts ?? [];
    assert.equal(facts.length, 5);
    assert.equal(new Set(facts.map((fact) => fact.content)).size, 5);
    assert.equal(facts[0]?.content, 'o item 6 da lista é 66', 'most recent facts first');
    for (const request of decideRequests) assert.ok(request.relevantMemory.length <= 5 + 4);
  });
}
