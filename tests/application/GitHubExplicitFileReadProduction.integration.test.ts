import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_OPERATIONAL_DECISIONS, MAX_OPERATIONAL_DECIDE_TIMEOUT_RETRIES } from '../../core/cognition/CognitiveOperationalOrchestrator.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOnlineSebastianApplication } from '../../application/OnlineSebastianApplication.js';
import type { CognitiveModelProvider } from '../../core/cognition/index.js';

/**
 * Production regression (2026-11-09): the exact authenticated request below
 * answered `Não encontrei "js/app.js no GitHub. Localize ..."` because the
 * local "leia o arquivo" marker claimed it as a LOCAL path (rest of the
 * sentence included) and no GitHub call was ever made. Composed exactly like
 * production (createOnlineSebastianApplication + SEBASTIAN_GITHUB_PROJECTS,
 * SebastianIA aliased "Sebastian"), with only the HTTP layer faked.
 */
const REQUEST = 'Sebastian, no projeto LUMARKIS Gestão Financeira, leia o arquivo js/app.js no GitHub. Localize o botão Salvar cliente, informe sua classe CSS atual e proponha alterar somente a cor de fundo para verde. Não modifique nenhum arquivo ainda.';
const BUTTON_LINE = "      foot: `<button class=\"btn\" type=\"button\" data-action=\"close-modal\">Cancelar</button><button class=\"btn primary\" type=\"submit\">${ic('check')} Salvar cliente</button>`";
// Like the real js/app.js (109 KB, button at ~80 KB): beyond the 64 KiB preview cap.
const APP_JS = `${'// filler line for size\n'.repeat(3_400)}${BUTTON_LINE}\n${'// tail\n'.repeat(1_000)}`;

const PROJECTS = [
  { id: 'sebastiania', displayName: 'SebastianIA', aliases: ['Sebastian'], owner: 'gahsantosss16-dev', repository: 'SebastianIA', defaultBranch: 'main' },
  { id: 'lumarkis-financeiro', displayName: 'LUMARKIS Gestão Financeira', aliases: ['LUMARKIS'], owner: 'gahsantosss16-dev', repository: 'financeiro-lumarkis', defaultBranch: 'main' },
  { id: 'lsb-service', displayName: 'LSB Service', aliases: ['LSB'], owner: 'o', repository: 'lsb', defaultBranch: 'main' },
  { id: 'neuro-hub-pro', displayName: 'Neuro Hub Pro', aliases: ['Neuro'], owner: 'o', repository: 'neuro', defaultBranch: 'main' },
];

async function run(status: 200 | 404, synthesize?: CognitiveModelProvider['synthesize']) {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-explicit-file-'));
  const urls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    urls.push(String(url));
    const body = status === 200
      ? { type: 'file', encoding: 'base64', content: Buffer.from(APP_JS, 'utf8').toString('base64'), path: 'js/app.js' }
      : { message: 'Not Found' };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  let decideCalls = 0;
  const provider: CognitiveModelProvider = {
    decide: async () => { decideCalls += 1; return { outcome: 'unavailable', reason: 'not expected in this test' }; },
    respond: async () => ({ outcome: 'responded', answer: 'Não encontrei js/app.js no GitHub.' }),
    ...(synthesize === undefined ? {} : { synthesize }),
  };
  try {
    const env = { SEBASTIAN_GITHUB_TOKEN: 'test-token', SEBASTIAN_GITHUB_PROJECTS: JSON.stringify(PROJECTS), SEBASTIAN_STORE_DRIVER: 'file', SEBASTIAN_GITHUB_WRITE_ENABLED: 'true' };
    const app = createOnlineSebastianApplication(undefined, provider, dataDir, env);
    const result = await app.executeCommand({ type: 'converse', input: { text: REQUEST }, generatedAt: '2026-11-09T23:50:00.000Z' });
    return { answer: String(result.output.message), urls, decideCalls };
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test('production request reads js/app.js from financeiro-lumarkis and synthesis receives the real button line', async () => {
  const seen: string[] = [];
  const { answer, urls, decideCalls } = await run(200, async (request) => {
    seen.push(...request.observations.map((observation) => observation.summary));
    const line = /linha (\d+): .*class="(btn primary)"/u.exec(request.observations[0]!.summary);
    return { outcome: 'synthesized', answer: `Linha ${line?.[1]}: o botão Salvar cliente usa class="${line?.[2]}".` };
  });
  assert.deepEqual(urls.map((url) => new URL(url).pathname), ['/repos/gahsantosss16-dev/financeiro-lumarkis/contents/js/app.js']);
  assert.ok(decideCalls >= 1 && decideCalls <= MAX_OPERATIONAL_DECISIONS + MAX_OPERATIONAL_DECIDE_TIMEOUT_RETRIES, 'SPEC-051: the model interprets first, bounded by the decision budget; the deterministic route only supplies evidence when the model cannot');
  assert.equal(seen.length, 1);
  assert.match(seen[0]!, /^Trechos de "js\/app\.js" que contêm "Salvar cliente"/u);
  assert.ok(seen[0]!.includes(BUTTON_LINE.trim()), 'the button line beyond the 64 KiB preview must reach synthesis');
  assert.equal(answer, 'Linha 3401: o botão Salvar cliente usa class="btn primary".');
});

test('without synthesis the evidence fallback is the located excerpt, never a local "Não encontrei" echo', async () => {
  const { answer } = await run(200);
  assert.match(answer, /linha 3401: .*class="btn primary".*Salvar cliente/u);
  assert.doesNotMatch(answer, /Conteúdo de|filler line/u);
  assert.doesNotMatch(answer, /Localize o botão|Não modifique/u);
});

test('a real 404 in the named project is reported honestly with project and path, without echoing the request', async () => {
  const { answer, urls, decideCalls } = await run(404);
  assert.equal(urls.length, 1);
  assert.ok(decideCalls >= 1 && decideCalls <= MAX_OPERATIONAL_DECISIONS + MAX_OPERATIONAL_DECIDE_TIMEOUT_RETRIES, 'SPEC-051: the model interprets first, bounded by the decision budget; the deterministic route only supplies evidence when the model cannot');
  assert.match(answer, /^Não consegui ler "js\/app\.js" no projeto LUMARKIS Gestão Financeira \(repositório autorizado gahsantosss16-dev\/financeiro-lumarkis, branch main\)/u);
  assert.doesNotMatch(answer, /Localize o botão|Não modifique/u);
});
