import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText } from '../../core/knowledge/KnowledgeChunker.js';

test('normalizeText strips structural Liquid tags (conditional/comment scaffolding) while keeping every word of the wrapped content', () => {
  const raw = [
    '   > [!WARNING]',
    '   > Treat your access token like a password.',
    '   {%- ifversion fpt or ghec %}',
    '   >',
    '   You can also store your token as a secret.',
    '   {%- endif %}',
  ].join('\n');

  const normalized = normalizeText(raw);

  assert.doesNotMatch(normalized, /ifversion|endif|\{%/);
  assert.match(normalized, /Treat your access token like a password\./);
  assert.match(normalized, /You can also store your token as a secret\./);
});

test('normalizeText deliberately leaves inline Liquid value-substitution tags in place - stripping them would delete real words', () => {
  const raw = 'Create a {% data variables.product.pat_generic %} or a {% data variables.product.prodname_github_app %} user access token.';

  const normalized = normalizeText(raw);

  // Documented Fase 1 limitation, not a bug: resolving these to their real
  // value would require parsing the source repo's separate data/variables
  // files (a new dependency), and blindly deleting them would corrupt the
  // sentence ("Create a or a user access token."). The literal tag stays
  // visible instead - harmless, honest markup noise.
  assert.match(normalized, /\{% data variables\.product\.pat_generic %\}/);
  assert.match(normalized, /user access token\./);
});

test('normalizeText is a no-op for sources that never contain Liquid markers', () => {
  const raw = '# Título\n\nTexto normal sem nenhum marcador de template.';
  assert.equal(normalizeText(raw), raw);
});
