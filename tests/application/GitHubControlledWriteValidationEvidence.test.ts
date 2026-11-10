import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOnlineSebastianApplication } from '../../application/OnlineSebastianApplication.js';
import type { CognitiveDecision, CognitiveModelProvider } from '../../core/cognition/index.js';
import type { Logger } from '../../core/logger.js';

/**
 * Regression on the real online composition: an authorized GitHub write to
 * LUMARKIS must never be "validated" by SebastianIA's own `validation.test`
 * and must never answer "Corrigido"/"validação concluída". `globalThis.fetch`
 * is stubbed, so no request ever reaches GitHub.
 */

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const env: NodeJS.ProcessEnv = {
  SEBASTIAN_STORE_DRIVER: 'file',
  SEBASTIAN_GITHUB_TOKEN: 'read-token-test',
  SEBASTIAN_GITHUB_PROJECT_ID: 'lumarkis-financeiro',
  SEBASTIAN_GITHUB_PROJECT_NAME: 'LUMARKIS',
  SEBASTIAN_GITHUB_OWNER: 'gahsantosss16-dev',
  SEBASTIAN_GITHUB_REPOSITORY: 'financeiro-lumarkis',
  SEBASTIAN_GITHUB_DEFAULT_BRANCH: 'main',
  SEBASTIAN_GITHUB_WRITE_ENABLED: 'true',
  SEBASTIAN_GITHUB_WRITE_TOKEN: 'write-token-test',
};
const ARGS = { projectId: 'lumarkis-financeiro', branch: 'sebastian/readme', path: 'README.md', content: '# LUMARKIS\n', message: 'docs: readme' };

function input(text: string, second: number) {
  return { type: 'converse', input: { text }, generatedAt: `2026-11-10T12:00:${String(second).padStart(2, '0')}.000Z` };
}

function proposeWrite(): CognitiveDecision {
  return {
    intent: 'proposeFix', goal: 'editar arquivo', reasoningSummary: 'Proposta curta.', nextAction: 'invokeTool',
    requiresAuthorization: true, expectedEvidence: 'Commit registrado.', completionState: 'inProgress', confidence: 0.9,
    toolId: 'github.upsertFile', toolArguments: ARGS,
  };
}

async function runAuthorizedWrite(response: { ok: boolean; status: number; body: unknown }) {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-github-write-evidence-'));
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string }> = [];
  globalThis.fetch = (async (url: string, init: { method?: string }) => {
    requests.push({ url: String(url), method: init?.method ?? 'GET' });
    assert.ok(String(url).startsWith('https://api.github.com/repos/gahsantosss16-dev/financeiro-lumarkis/'), `unexpected fetch: ${url}`);
    if ((init?.method ?? 'GET') === 'GET') return { ok: false, status: 404, text: async () => '{}' };
    return { ok: response.ok, status: response.status, text: async () => JSON.stringify(response.body) };
  }) as unknown as typeof fetch;
  let decideCalls = 0;
  const provider: CognitiveModelProvider = {
    decide: async () => { decideCalls += 1; return { outcome: 'decided', decision: proposeWrite() }; },
  };
  try {
    const proposal = await createOnlineSebastianApplication(logger, provider, dataDir, env)
      .executeCommand(input('Edite o arquivo README.md da LUMARKIS na branch sebastian/readme.', 10));
    const authorized = await createOnlineSebastianApplication(logger, provider, dataDir, env).executeCommand(input('sim', 11));
    return { proposal: String(proposal.output.message), answer: String(authorized.output.message), requests, decideCalls };
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test('authorized LUMARKIS write reports the confirmed commit and never claims SebastianIA tests validated it', async () => {
  const { proposal, answer, requests } = await runAuthorizedWrite({ ok: true, status: 201, body: { content: { path: 'README.md' }, commit: { sha: 'abc1234def5678' } } });
  assert.match(proposal, /não executa testes do projeto alterado/);
  assert.doesNotMatch(proposal, /executar e validar/);
  assert.deepEqual(requests.map((request) => request.method), ['GET', 'PUT'], 'only the proposed write reaches GitHub');
  assert.match(answer, /Arquivo "README\.md" criado na branch "sebastian\/readme"; commit abc1234 registrado no GitHub\./);
  assert.match(answer, /não foi testada/);
  assert.doesNotMatch(answer, /Corrigido|validação foi concluída com sucesso|validação falhou/);
});

test('a GitHub rejection after authorization is reported as not done, with no false success and no local validation', async () => {
  const { answer, requests } = await runAuthorizedWrite({ ok: false, status: 409, body: { message: 'conflict' } });
  assert.deepEqual(requests.map((request) => request.method), ['GET', 'PUT']);
  assert.match(answer, /^A operação não foi concluída: O GitHub não confirmou a gravação de "README\.md".*HTTP 409/);
  assert.match(answer, /foram preservadas e não foram revertidas/);
  assert.doesNotMatch(answer, /Corrigido|validação foi concluída com sucesso|registrado no GitHub\./);
});
