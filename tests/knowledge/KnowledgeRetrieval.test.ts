import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileMemoryStore } from '../../core/memory/FileMemoryStore.js';
import { KnowledgeStore } from '../../core/knowledge/KnowledgeStore.js';
import { deprecateSource, ingestSource } from '../../core/knowledge/KnowledgeIngestion.js';
import { searchKnowledge } from '../../core/knowledge/KnowledgeRetrieval.js';

function withStore<T>(run: (store: KnowledgeStore) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-knowledge-retrieval-'));
  try {
    const store = new KnowledgeStore(new FileMemoryStore(join(root, 'memory.json')));
    return run(store);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function ingestFixture(store: KnowledgeStore, overrides: Partial<Parameters<typeof ingestSource>[1]> & { readonly sourceId: string; readonly rawText: string }) {
  ingestSource(store, {
    title: overrides.sourceId, domain: 'programming', sourceType: 'book', authorityLevel: 'book',
    usageRights: 'licenciado', origin: `fixture://${overrides.sourceId}.md`, format: 'markdown',
    ingestedAt: '2026-09-06T10:00:00.000Z',
    ...overrides,
  });
}

test('BM25 recovers the chunk whose terms actually match the query, not an unrelated one', () => {
  withStore((store) => {
    ingestFixture(store, {
      sourceId: 'testing-guide',
      rawText: '# Testes\n\nTestes automatizados com cobertura de regressão previnem bugs recorrentes em produção.',
    });
    ingestFixture(store, {
      sourceId: 'deploy-guide',
      rawText: '# Deploy\n\nEstratégias de implantação contínua e rollback seguro em produção.',
    });

    const hits = searchKnowledge(store, { query: 'cobertura de testes automatizados' });

    assert.ok(hits.length > 0);
    assert.equal(hits[0]?.source.sourceId, 'testing-guide');
  });
});

test('a source marked deprecated no longer appears in retrieval results', () => {
  withStore((store) => {
    ingestFixture(store, {
      sourceId: 'legacy-patterns',
      rawText: '# Padrões\n\nSingleton global é o padrão recomendado para configuração compartilhada.',
    });

    const before = searchKnowledge(store, { query: 'singleton configuração compartilhada' });
    assert.ok(before.length > 0);

    deprecateSource(store, 'legacy-patterns');

    const after = searchKnowledge(store, { query: 'singleton configuração compartilhada' });
    assert.equal(after.length, 0);
  });
});

test('a domain filter excludes chunks from a different domain', () => {
  withStore((store) => {
    ingestFixture(store, {
      sourceId: 'programming-source', domain: 'programming',
      rawText: '# Arquitetura\n\nCamadas de aplicação bem definidas reduzem acoplamento entre módulos.',
    });
    ingestFixture(store, {
      sourceId: 'security-source', domain: 'security',
      rawText: '# Camadas\n\nCamadas de defesa em profundidade reduzem superfície de ataque.',
    });

    const hits = searchKnowledge(store, { query: 'camadas reduzem', domain: 'programming' });

    assert.ok(hits.every((hit) => hit.source.domain === 'programming'));
    assert.ok(hits.some((hit) => hit.source.sourceId === 'programming-source'));
    assert.ok(!hits.some((hit) => hit.source.sourceId === 'security-source'));
  });
});

test('diversity cap limits how many chunks from the same source appear in one result set', () => {
  withStore((store) => {
    const longDocument = Array.from({ length: 6 }, (_, index) =>
      `## Seção ${index + 1}\n\nRefatoração de código legado exige testes de regressão automatizados antes de qualquer mudança estrutural relevante neste capítulo específico ${index + 1}.`,
    ).join('\n\n');
    ingestFixture(store, { sourceId: 'refactoring-book', rawText: `# Refatoração\n\n${longDocument}` });

    const hits = searchKnowledge(store, { query: 'refatoração testes de regressão automatizados' }, { maxPerSource: 2, topK: 5 });

    const fromSameSource = hits.filter((hit) => hit.source.sourceId === 'refactoring-book').length;
    assert.ok(fromSameSource <= 2, `expected at most 2 chunks from the same source, got ${fromSameSource}`);
  });
});

test('an empty or whitespace-only query returns no results instead of throwing', () => {
  withStore((store) => {
    ingestFixture(store, { sourceId: 'any-source', rawText: '# Título\n\nConteúdo qualquer.' });
    assert.deepEqual(searchKnowledge(store, { query: '   ' }), []);
  });
});
