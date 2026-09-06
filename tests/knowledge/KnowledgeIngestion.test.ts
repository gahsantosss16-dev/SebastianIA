import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileMemoryStore } from '../../core/memory/FileMemoryStore.js';
import { KnowledgeStore } from '../../core/knowledge/KnowledgeStore.js';
import { deprecateSource, ingestSource } from '../../core/knowledge/KnowledgeIngestion.js';

const FIXTURE_MARKDOWN = `# Princípios de Design

## Inversão de Dependência

Módulos de alto nível não devem depender de módulos de baixo nível; ambos devem depender de abstrações.
Isso reduz o acoplamento entre componentes e facilita testes isolados.

## Responsabilidade Única

Cada módulo deve ter um, e somente um, motivo para mudar.
Misturar responsabilidades torna o código mais difícil de manter e testar ao longo do tempo.
`;

function withStore<T>(run: (store: KnowledgeStore, root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-knowledge-ingestion-'));
  try {
    const store = new KnowledgeStore(new FileMemoryStore(join(root, 'memory.json')));
    return run(store, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('ingesting a Markdown fixture produces chunks with correct section path, locator and hash', () => {
  withStore((store) => {
    const result = ingestSource(store, {
      sourceId: 'design-principles',
      title: 'Princípios de Design de Software',
      domain: 'programming',
      sourceType: 'internal-doc',
      authorityLevel: 'internal-doc',
      usageRights: 'uso interno autorizado',
      origin: 'fixture://design-principles.md',
      format: 'markdown',
      rawText: FIXTURE_MARKDOWN,
      ingestedAt: '2026-09-06T10:00:00.000Z',
    });

    assert.equal(result.sourceId, 'design-principles');
    assert.ok(result.chunksWritten > 0);
    assert.equal(result.chunksSkippedAsDuplicate, 0);

    const source = store.getSource('design-principles');
    assert.ok(source);
    assert.equal(source?.status, 'active');
    assert.match(source?.contentHash ?? '', /^[0-9a-f]{64}$/);

    const chunks = store.listChunks();
    assert.equal(chunks.length, result.chunksWritten);
    const dependencyChunk = chunks.find((chunk) => chunk.text.includes('Inversão de Dependência') || chunk.text.includes('abstrações'));
    assert.ok(dependencyChunk, 'expected a chunk covering the dependency-inversion section');
    assert.deepEqual(dependencyChunk?.sectionPath, ['Princípios de Design', 'Inversão de Dependência']);
    assert.match(dependencyChunk?.locator ?? '', /^linhas \d+-\d+$/);
    assert.match(dependencyChunk?.chunkHash ?? '', /^[0-9a-f]{64}$/);
    assert.equal(dependencyChunk?.sourceId, 'design-principles');
    assert.equal(dependencyChunk?.status, 'active');
  });
});

test('ingesting a TXT fixture produces a single flat section, not a Markdown-style heading tree', () => {
  withStore((store) => {
    const result = ingestSource(store, {
      sourceId: 'plain-notes',
      title: 'Notas Soltas',
      domain: 'programming',
      sourceType: 'internal-doc',
      authorityLevel: 'internal-doc',
      usageRights: 'uso interno autorizado',
      origin: 'fixture://notes.txt',
      format: 'txt',
      rawText: 'Uma nota simples sobre testes automatizados e cobertura de regressão.',
      ingestedAt: '2026-09-06T10:00:00.000Z',
    });

    assert.equal(result.chunksWritten, 1);
    const [chunk] = store.listChunks();
    assert.deepEqual(chunk?.sectionPath, []);
  });
});

test('re-ingesting identical content is idempotent and never duplicates chunks', () => {
  withStore((store) => {
    const first = ingestSource(store, {
      sourceId: 'design-principles', title: 'Princípios de Design de Software', domain: 'programming',
      sourceType: 'internal-doc', authorityLevel: 'internal-doc', usageRights: 'uso interno autorizado',
      origin: 'fixture://design-principles.md', format: 'markdown', rawText: FIXTURE_MARKDOWN,
      ingestedAt: '2026-09-06T10:00:00.000Z',
    });
    const chunkCountAfterFirst = store.listChunks().length;

    const second = ingestSource(store, {
      sourceId: 'design-principles', title: 'Princípios de Design de Software', domain: 'programming',
      sourceType: 'internal-doc', authorityLevel: 'internal-doc', usageRights: 'uso interno autorizado',
      origin: 'fixture://design-principles.md', format: 'markdown', rawText: FIXTURE_MARKDOWN,
      ingestedAt: '2026-09-06T11:00:00.000Z',
    });
    const chunkCountAfterSecond = store.listChunks().length;

    assert.equal(first.chunksWritten, second.chunksWritten);
    assert.equal(chunkCountAfterFirst, chunkCountAfterSecond, 'identical re-ingestion must not accumulate duplicate chunks');
  });
});

test('identical chunk content ingested under a second, different source is deduplicated - the first occurrence stays canonical', () => {
  withStore((store) => {
    ingestSource(store, {
      sourceId: 'source-a', title: 'Fonte A', domain: 'programming', sourceType: 'book', authorityLevel: 'book',
      usageRights: 'licenciado', origin: 'fixture://a.md', format: 'markdown',
      rawText: '# Único\n\nEste texto idêntico aparece em duas fontes fixture diferentes para testar deduplicação exata.',
      ingestedAt: '2026-09-06T10:00:00.000Z',
    });
    const afterFirst = store.listChunks().length;

    const secondResult = ingestSource(store, {
      sourceId: 'source-b', title: 'Fonte B', domain: 'programming', sourceType: 'book', authorityLevel: 'book',
      usageRights: 'licenciado', origin: 'fixture://b.md', format: 'markdown',
      rawText: '# Único\n\nEste texto idêntico aparece em duas fontes fixture diferentes para testar deduplicação exata.',
      ingestedAt: '2026-09-06T10:00:00.000Z',
    });
    const afterSecond = store.listChunks().length;

    assert.ok(secondResult.chunksSkippedAsDuplicate > 0);
    assert.equal(afterFirst, afterSecond, 'a byte-identical chunk from a second source must not create a second stored copy');
  });
});

test('a deprecated source is not deleted, only marked inactive, preserving provenance history', () => {
  withStore((store) => {
    ingestSource(store, {
      sourceId: 'old-guide', title: 'Guia Antigo', domain: 'programming', sourceType: 'book', authorityLevel: 'book',
      usageRights: 'licenciado', origin: 'fixture://old-guide.md', format: 'markdown',
      rawText: '# Guia\n\nConteúdo antigo mantido para fins de auditoria e proveniência.',
      ingestedAt: '2026-09-06T10:00:00.000Z',
    });

    deprecateSource(store, 'old-guide', 'new-guide');

    const source = store.getSource('old-guide');
    assert.equal(source?.status, 'deprecated');
    assert.equal(source?.supersededBy, 'new-guide');
    assert.ok(store.listChunks().length > 0, 'chunks must still exist on disk after deprecation, not be deleted');
  });
});
