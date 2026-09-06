import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRequestedQuantity } from '../../application/OnlineSebastianApplication.js';

const COMMITS = /commits?/i;

test('extractRequestedQuantity resolves "últimos N" even when the number is not immediately adjacent to the counted noun', () => {
  // Regression for a real bug found while measuring latency for this fix:
  // plain `\b` in JavaScript does not recognize accented letters as word
  // characters, so `\búltimos\b` silently never matches "últimos" at all.
  // This phrasing deliberately has no "N commits" adjacency, so it can only
  // pass through the "últimos N" branch, not the "N commits" one.
  assert.equal(extractRequestedQuantity('me mostre os últimos 4, por favor', COMMITS), 4);
  assert.equal(extractRequestedQuantity('quero ver os últimos 7 no repositório', COMMITS), 7);
});

test('extractRequestedQuantity resolves "N commits" adjacency', () => {
  assert.equal(extractRequestedQuantity('quais os últimos 3 commits?', COMMITS), 3);
  assert.equal(extractRequestedQuantity('me mostra os últimos 5 commits', COMMITS), 5);
  assert.equal(extractRequestedQuantity('últimos 10 commits no github', COMMITS), 10);
});

test('extractRequestedQuantity resolves an unambiguous singular reference as exactly 1', () => {
  assert.equal(extractRequestedQuantity('qual o último commit?', COMMITS), 1);
  assert.equal(extractRequestedQuantity('qual foi o último commit no github?', COMMITS), 1);
  assert.equal(extractRequestedQuantity('último commit trouxe um bug', COMMITS), 1);
});

test('extractRequestedQuantity returns undefined when no quantity is expressed', () => {
  assert.equal(extractRequestedQuantity('quais foram os últimos commits no github?', COMMITS), undefined);
  assert.equal(extractRequestedQuantity('verifique o projeto no github', COMMITS), undefined);
});

test('extractRequestedQuantity never mistakes an unrelated number for the requested quantity', () => {
  assert.equal(extractRequestedQuantity('em 2026, na build 16, quais foram os commits recentes?', COMMITS), undefined);
  assert.equal(extractRequestedQuantity('verifique o projeto SebastianIA2 e me diga os commits', COMMITS), undefined);
});
