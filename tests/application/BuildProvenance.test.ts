import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuildProvenance } from '../../application/BuildProvenance.js';

test('build provenance prefers an automatically supplied deployment SHA', () => {
  assert.deepEqual(
    resolveBuildProvenance({ RENDER_GIT_COMMIT: 'ABCDEF1234567890' }, () => '1111111'),
    { sha: 'abcdef1234567890', source: 'environment' },
  );
});

test('build provenance resolves local Git HEAD without hardcoding a SHA', () => {
  assert.deepEqual(resolveBuildProvenance({}, () => '2c27fafbcee283e4fc38d2083e1be052e4cb7e8d\n'), {
    sha: '2c27fafbcee283e4fc38d2083e1be052e4cb7e8d',
    source: 'git',
  });
});

test('build provenance fails explicitly to unknown when neither source is trustworthy', () => {
  assert.deepEqual(resolveBuildProvenance({ SOURCE_VERSION: 'not-a-sha' }, () => { throw new Error('git unavailable'); }), {
    sha: 'unknown',
    source: 'unknown',
  });
});
