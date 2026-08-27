import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCognitiveDecision, MAX_REASONING_SUMMARY_CHARS } from '../../core/cognition/CognitiveDecisionValidator.js';

function validRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intent: 'proposeFix',
    goal: 'corrigir o teste',
    reasoningSummary: 'lendo o arquivo candidato',
    nextAction: 'invokeTool',
    toolId: 'fs.readFile',
    toolArguments: { path: 'a.js' },
    requiresAuthorization: false,
    expectedEvidence: 'o conteúdo do arquivo',
    completionState: 'inProgress',
    confidence: 0.8,
    ...overrides,
  };
}

test('accepts a fully valid decision and preserves its fields', () => {
  const decision = parseCognitiveDecision(validRaw());
  assert.ok(decision);
  assert.equal(decision?.intent, 'proposeFix');
  assert.equal(decision?.toolId, 'fs.readFile');
  assert.deepEqual(decision?.toolArguments, { path: 'a.js' });
  assert.equal(decision?.confidence, 0.8);
});

test('accepts a non-invokeTool decision without toolId/toolArguments', () => {
  const decision = parseCognitiveDecision(
    validRaw({ nextAction: 'concludeFailed', toolId: undefined, toolArguments: undefined }),
  );
  assert.ok(decision);
  assert.equal(decision?.toolId, undefined);
});

test('rejects a non-object payload', () => {
  assert.equal(parseCognitiveDecision(null), null);
  assert.equal(parseCognitiveDecision('not an object'), null);
  assert.equal(parseCognitiveDecision([1, 2, 3]), null);
  assert.equal(parseCognitiveDecision(undefined), null);
});

test('rejects an unrecognized intent', () => {
  assert.equal(parseCognitiveDecision(validRaw({ intent: 'daydream' })), null);
});

test('rejects an unrecognized nextAction', () => {
  assert.equal(parseCognitiveDecision(validRaw({ nextAction: 'doWhateverIWant' })), null);
});

test('rejects an unrecognized completionState', () => {
  assert.equal(parseCognitiveDecision(validRaw({ completionState: 'basicallyDone' })), null);
});

test('rejects invokeTool without a toolId', () => {
  assert.equal(parseCognitiveDecision(validRaw({ toolId: undefined })), null);
});

test('rejects invokeTool with a non-object toolArguments', () => {
  assert.equal(parseCognitiveDecision(validRaw({ toolArguments: 'path=a.js' })), null);
});

test('rejects a missing or empty goal/reasoningSummary/expectedEvidence', () => {
  assert.equal(parseCognitiveDecision(validRaw({ goal: '' })), null);
  assert.equal(parseCognitiveDecision(validRaw({ reasoningSummary: '   ' })), null);
  assert.equal(parseCognitiveDecision(validRaw({ expectedEvidence: undefined })), null);
});

test('rejects a non-boolean requiresAuthorization', () => {
  assert.equal(parseCognitiveDecision(validRaw({ requiresAuthorization: 'yes' })), null);
});

test('rejects confidence outside [0, 1] or non-numeric', () => {
  assert.equal(parseCognitiveDecision(validRaw({ confidence: 1.5 })), null);
  assert.equal(parseCognitiveDecision(validRaw({ confidence: -0.1 })), null);
  assert.equal(parseCognitiveDecision(validRaw({ confidence: Number.NaN })), null);
  assert.equal(parseCognitiveDecision(validRaw({ confidence: '0.9' })), null);
});

test('accepts confidence at the exact boundaries 0 and 1', () => {
  assert.ok(parseCognitiveDecision(validRaw({ confidence: 0 })));
  assert.ok(parseCognitiveDecision(validRaw({ confidence: 1 })));
});

test('truncates an overlong reasoningSummary rather than rejecting the decision - never a chain-of-thought dump', () => {
  const longSummary = 'x'.repeat(MAX_REASONING_SUMMARY_CHARS + 500);
  const decision = parseCognitiveDecision(validRaw({ reasoningSummary: longSummary }));
  assert.ok(decision);
  assert.equal(decision?.reasoningSummary.length, MAX_REASONING_SUMMARY_CHARS);
});

test('rejects extra malformed top-level shapes (arrays where objects expected, numbers where strings expected)', () => {
  assert.equal(parseCognitiveDecision(validRaw({ goal: 42 })), null);
  assert.equal(parseCognitiveDecision(validRaw({ toolArguments: [1, 2] })), null);
});
