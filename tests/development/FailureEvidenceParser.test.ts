import test from 'node:test';
import assert from 'node:assert/strict';
import { extractImportedRelativePaths, parseFailureEvidence } from '../../core/development/FailureEvidenceParser.js';

const REAL_NODE_TEST_FAILURE_OUTPUT = `
✖ calculateTotal adds two numbers (2.1422ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1

✖ failing tests:

test at calc.test.js:5:1
✖ calculateTotal adds two numbers (2.1422ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  5 !== 4

      at TestContext.<anonymous> (C:\\fixture\\calc.test.js:6:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 5,
    expected: 4,
    operator: 'strictEqual',
    diff: 'simple'
  }
`;

test('parseFailureEvidence extracts actual/expected and the test file from a real node --test failure', () => {
  const evidence = parseFailureEvidence(REAL_NODE_TEST_FAILURE_OUTPUT);

  assert.deepEqual(evidence, { actualLiteral: '5', expectedLiteral: '4', testFilePath: 'calc.test.js' });
});

test('parseFailureEvidence extracts quoted string literals', () => {
  const output = `
test at strings.test.js:3:1
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  'foo' !== 'bar'

  {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 'foo',
    expected: 'bar',
    operator: 'strictEqual',
    diff: 'simple'
  }
`;

  const evidence = parseFailureEvidence(output);

  assert.equal(evidence.actualLiteral, "'foo'");
  assert.equal(evidence.expectedLiteral, "'bar'");
  assert.equal(evidence.testFilePath, 'strings.test.js');
});

test('parseFailureEvidence falls back to the simple "actual !== expected" line when the structured dump is absent', () => {
  const output = `
test at simple.test.js:2:1
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  7 !== 8
`;

  const evidence = parseFailureEvidence(output);

  assert.equal(evidence.actualLiteral, '7');
  assert.equal(evidence.expectedLiteral, '8');
});

test('parseFailureEvidence ignores unusable literals (undefined/null/NaN/booleans)', () => {
  for (const [actual, expected] of [
    ['undefined', '4'],
    ['4', 'null'],
    ['NaN', '4'],
    ['true', 'false'],
  ]) {
    const output = `test at x.test.js:1:1\n    actual: ${actual},\n    expected: ${expected},\n`;
    const evidence = parseFailureEvidence(output);
    assert.equal(evidence.actualLiteral, undefined, `expected no usable literal for actual="${actual}"`);
  }
});

test('parseFailureEvidence ignores a multi-line/object diff instead of guessing', () => {
  const output = `
test at obj.test.js:4:1
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:

  actual: {
    a: 1
  },
  expected: {
    a: 2
  },
`;

  const evidence = parseFailureEvidence(output);

  assert.equal(evidence.actualLiteral, undefined);
  assert.equal(evidence.expectedLiteral, undefined);
  assert.equal(evidence.testFilePath, 'obj.test.js');
});

test('parseFailureEvidence returns an empty object for output with no recognizable failure shape', () => {
  const evidence = parseFailureEvidence('validation succeeded, nothing to see here');

  assert.deepEqual(evidence, {});
});

test('parseFailureEvidence never treats an equal actual/expected pair as usable evidence', () => {
  const output = 'test at x.test.js:1:1\n    actual: 5,\n    expected: 5,\n';

  const evidence = parseFailureEvidence(output);

  assert.equal(evidence.actualLiteral, undefined);
  assert.equal(evidence.expectedLiteral, undefined);
});

test('extractImportedRelativePaths resolves require() and import-from relative paths against the test file directory', () => {
  const content = `
const { calculateTotal } = require('./calc.js');
const other = require('../shared/util.js');
import { helper } from './helper.js';
const pkg = require('node:assert');
const bare = require('some-package');
`;

  const paths = extractImportedRelativePaths(content, 'tests/calc.test.js');

  assert.deepEqual(paths, ['tests/calc.js', 'shared/util.js', 'tests/helper.js']);
});

test('extractImportedRelativePaths returns no candidates when the test file imports nothing relative', () => {
  const content = `const assert = require('node:assert/strict');\nconst test = require('node:test');\n`;

  const paths = extractImportedRelativePaths(content, 'calc.test.js');

  assert.deepEqual(paths, []);
});

test('extractImportedRelativePaths deduplicates repeated imports', () => {
  const content = `require('./calc.js');\nrequire('./calc.js');\n`;

  const paths = extractImportedRelativePaths(content, 'calc.test.js');

  assert.deepEqual(paths, ['calc.js']);
});
