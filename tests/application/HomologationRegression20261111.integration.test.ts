import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOnlineSebastianApplication } from '../../application/OnlineSebastianApplication.js';
import { createConfiguredProjectContext } from '../../application/ProjectConfiguration.js';
import { decisionSchemaFor, normalizedIncludes, selectToolArguments } from '../../core/cognition/GeminiCognitiveModelProvider.js';
import type {
  CognitiveDecision,
  CognitiveDecisionRequest,
  CognitiveModelProvider,
  CognitiveToolDescriptor,
} from '../../core/cognition/index.js';
import type { Logger } from '../../core/logger.js';

/**
 * SPEC-051 regression: the 16 messages sent to production on 2026-11-11
 * (Test A: 10 requests, Test B: 3 attempts, Test C: 3 attempts), composed
 * exactly like production (createOnlineSebastianApplication + project
 * context, 4 registered projects, controlled writes enabled for LUMARKIS),
 * with only the network faked:
 *
 * - GitHub answers with the real state of financeiro-lumarkis observed that
 *   day (main = 5e63b45, PR #45 recovery; branch claude/login-mobile-rodape
 *   1 ahead / 80 behind).
 * - The cognitive provider is an "oracle": it makes the decision a competent
 *   model should make for each message. It can only send argument names the
 *   Tool menu actually advertised to it - exactly the information a real
 *   model receives - and its synthesis must quote real observation excerpts.
 *
 * What this measures is the harness, not the model: whether each message
 * reaches the model, whether a correct decision survives the guards,
 * whether evidence reaches the answer, and whether writes stay confined to
 * a sebastian/ branch. Failures are classified by layer.
 */

const PROJECTS = [
  { id: 'sebastiania', displayName: 'SebastianIA', aliases: ['Sebastian'], owner: 'gahsantosss16-dev', repository: 'SebastianIA', defaultBranch: 'main' },
  { id: 'lumarkis-financeiro', displayName: 'LUMARKIS Gestão Financeira', aliases: ['LUMARKIS', 'Financeiro LUMARKIS'], owner: 'gahsantosss16-dev', repository: 'financeiro-lumarkis', defaultBranch: 'main' },
  { id: 'lsb-service', displayName: 'LSB Service', aliases: ['LSB'], owner: 'gahsantosss16-dev', repository: 'lsb-service', defaultBranch: 'main' },
  { id: 'neuro-hub-pro', displayName: 'Neuro Hub Pro', aliases: ['Neuro'], owner: 'gahsantosss16-dev', repository: 'neuro-hub-pro', defaultBranch: 'main' },
];
const LUMARKIS = 'lumarkis-financeiro';
const REPO = '/repos/gahsantosss16-dev/financeiro-lumarkis';
const TASK_BRANCH = 'sebastian/teste-c-20261111';

// ---- Real LUMARKIS state on 2026-11-11 (abridged where noted) -------------
const COMMITS = [
  { sha: '5e63b45e0992ff8c236f4d4617eeb1469cdbb8bc', commit: { message: 'merge: recuperar aplicação Lumarkis completa na main (#45)', author: { name: 'gahsantosss16-dev', date: '2026-11-11T01:19:34Z' } } },
  { sha: 'b8a399522f1ddc772059ac6aff60a0b4e2b17bb5', commit: { message: 'docs: registrar conciliação e evidências da recuperação da main', author: { name: 'Gabriel', date: '2026-11-11T01:16:20Z' } } },
  { sha: '5273f38c0e07f38ad3fced3f091fae680efaa83a', commit: { message: 'Login no celular: rodapé legível e card no centro óptico', author: { name: 'Claude', date: '2026-11-06T01:50:39Z' } } },
  { sha: 'b22513eacb1f00000000000000000000000000000', commit: { message: 'Corrige a usabilidade mobile no iPhone (teclado, zoom de foco e abas do cadastro)', author: { name: 'Claude', date: '2026-11-06T00:54:38Z' } } },
];
const README = '# Gestão Financeira LUMARKIS — sistema financeiro (empresa cliente: ASSOCIAPEC)\n\n' +
  'Aplicação web (React + TypeScript + Supabase) para gestão financeira da ASSOCIAPEC, com estrutura\n' +
  'preparada para emissão de NFS-e em Campo Grande/MS. **Etapa 2 (operação financeira) em homologação.**\n';
const ROOT = ['.github', '.gitignore', '.nojekyll', 'CLAUDE.md', 'README.md', 'app', 'css', 'docs', 'index.html', 'js', 'scripts', 'supabase'];
const ROOT_DIRS = new Set(['.github', 'app', 'css', 'docs', 'js', 'scripts', 'supabase']);
const WORKFLOWS = ['backup-externo.yml', 'backup-monitor.yml', 'ci.yml', 'homologacao.yml', 'pages-lumarkis.yml', 'pages-preview.yml', 'pages.yml', 'publicacao.yml'];
const PAGES_YML = 'name: Publicar demonstração no GitHub Pages\n\non:\n  workflow_dispatch:\n\npermissions:\n  contents: read\n';
const CI_YML = 'name: CI\n\non:\n  push:\n    branches-ignore: [main]\n  pull_request:\n\njobs:\n  app:\n    steps:\n      - run: npm run typecheck\n      - run: npx vitest run\n      - run: npx playwright test\n';
// Abridged from docs/RECUPERACAO-MAIN-20261111.md (opening table + conciliation).
const RECOVERY_DOC = '# Recuperação da main — 11/11/2026\n\n## Origem e publicação confirmadas\n\n' +
  '| Referência | Commit | Situação |\n| --- | --- | --- |\n' +
  '| main antes da recuperação | c875ead82e571cd3c02a6da45ded462b6baa5864 | protótipo Recebe Fácil |\n' +
  '| ops/lumarkis-backend-conectado (PR #44) | 55451ae927a83b8fe31680b4f5387cb985f7a875 | aplicação completa, anterior à integração de segurança e ao acabamento da produção |\n\n' +
  '## Conciliação\n\nBranch: `recovery/lumarkis-main-20261111`. PR substituta: #45.\n\n' +
  '- Base na produção efetivamente publicada, preservando login em vidro, identidade LUMARKIS, densidade desktop, temas e contraste do CRM.\n';
const COMPARE = { status: 'diverged', ahead_by: 1, behind_by: 80, files: [{ filename: 'css/styles.css', status: 'modified', additions: 12, deletions: 4 }] };

const file = (path: string, content: string) => ({ type: 'file', path, encoding: 'base64', content: Buffer.from(content, 'utf8').toString('base64') });
const dir = (names: readonly string[], base: string, dirs: ReadonlySet<string> = new Set()) =>
  names.map((name) => ({ name, path: base === '' ? name : `${base}/${name}`, type: dirs.has(name) ? 'dir' : 'file' }));

interface RecordedRequest { readonly method: string; readonly url: string; readonly body?: Record<string, unknown> }

function githubFetch(requests: RecordedRequest[]) {
  const writes = { branchCreated: false };
  return (async (input: string | URL, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    requests.push({ method, url, ...(body === undefined ? {} : { body }) });
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    const { pathname } = new URL(url);
    if (!pathname.startsWith(REPO)) return json(404, { message: 'Not Found' });
    const path = decodeURIComponent(pathname.slice(REPO.length));
    if (method === 'GET' && path === '/commits') {
      const perPage = Number(new URL(url).searchParams.get('per_page') ?? COMMITS.length);
      return json(200, COMMITS.slice(0, perPage));
    }
    if (method === 'GET' && path === '/contents') return json(200, dir(ROOT, '', ROOT_DIRS));
    if (method === 'GET' && path === '/contents/.github/workflows') return json(200, dir(WORKFLOWS, '.github/workflows'));
    if (method === 'GET' && path === '/contents/README.md') return json(200, file('README.md', README));
    if (method === 'GET' && path === '/contents/.github/workflows/pages.yml') return json(200, file('.github/workflows/pages.yml', PAGES_YML));
    if (method === 'GET' && path === '/contents/.github/workflows/ci.yml') return json(200, file('.github/workflows/ci.yml', CI_YML));
    if (method === 'GET' && path === '/contents/docs/LONGO.md') return json(200, file('docs/LONGO.md', 'Linha de conteúdo real do documento. '.repeat(150)));
    if (method === 'GET' && path === '/contents/docs/RECUPERACAO-MAIN-20261111.md') return json(200, file('docs/RECUPERACAO-MAIN-20261111.md', RECOVERY_DOC));
    if (method === 'GET' && path === '/compare/main...claude/login-mobile-rodape') return json(200, COMPARE);
    if (method === 'GET' && path === '/git/ref/heads/main') return json(200, { object: { sha: COMMITS[0]!.sha } });
    if (method === 'POST' && path === '/git/refs') { writes.branchCreated = true; return json(201, { ref: body?.ref }); }
    if (method === 'GET' && path.startsWith('/contents/docs/teste-')) return json(404, { message: 'Not Found' });
    if (method === 'PUT' && path.startsWith('/contents/docs/teste-')) return json(201, { commit: { sha: 'feedc0de00000000000000000000000000000000' } });
    return json(404, { message: 'Not Found' });
  }) as typeof fetch;
}

// ---- Oracle model ----------------------------------------------------------
interface ToolStep { readonly toolId: string; readonly args: Readonly<Record<string, unknown>> }
interface Scenario {
  readonly id: string;
  readonly text: string;
  readonly plan: readonly ToolStep[];
  readonly answer: string;
  /** Exact excerpts the oracle quotes as evidence; each must appear in an observation. */
  readonly evidence: readonly string[];
  readonly mustInclude: readonly RegExp[];
  readonly mustNotInclude?: readonly RegExp[];
  /** Reproduces the observed production payload: with a multi-Tool menu, send another Tool's argument names. */
  readonly confuseArgumentsWithWideMenu?: boolean;
  /** Evidence the oracle attaches to its own concluding decision (SPEC-053). */
  readonly decisionEvidence?: readonly string[];
  /** Makes the oracle's synthesis cite something that is not in the observations. */
  readonly ungroundedSynthesis?: boolean;
}

function oracle(scenarios: readonly Scenario[], calls: { decide: number; synthesize: number; respond: number }): CognitiveModelProvider {
  const byText = new Map(scenarios.map((scenario) => [scenario.text, scenario]));
  const advertised = (tools: readonly CognitiveToolDescriptor[], toolId: string): ReadonlySet<string> => {
    const tool = tools.find((entry) => entry.toolId === toolId);
    return new Set([...(tool?.requiredArguments ?? []), ...(tool?.optionalArguments ?? []), ...(tool?.optionalNumberArguments ?? [])]);
  };
  const concluded = (answer: string): CognitiveDecision => ({
    intent: 'conclude', goal: 'responder', reasoningSummary: 'Evidência suficiente.', nextAction: 'concludeCompleted',
    requiresAuthorization: false, expectedEvidence: 'observações', completionState: 'completed', confidence: 0.9, finalAnswer: answer,
  });
  return {
    async decide(request: CognitiveDecisionRequest) {
      calls.decide += 1;
      const scenario = byText.get(request.objective);
      if (!scenario) return { outcome: 'decided', decision: concluded('Resposta direta.') };
      const done = request.recentObservations.filter((observation) => !observation.stepId.startsWith('operational:correction')).length;
      const step = scenario.plan[done];
      if (!step) {
        const decision = concluded(scenario.answer);
        return { outcome: 'decided', decision: scenario.decisionEvidence === undefined ? decision : { ...decision, evidence: scenario.decisionEvidence } };
      }
      const allowed = advertised(request.availableTools, step.toolId);
      const wideMenu = new Set(request.availableTools.map((tool) => tool.toolId)).size > 1;
      const toolArguments = scenario.confuseArgumentsWithWideMenu === true && wideMenu
        ? { projectId: LUMARKIS, content: 'README', message: 'ler o arquivo' }
        : Object.fromEntries(Object.entries(step.args).filter(([name]) => allowed.has(name)));
      return {
        outcome: 'decided',
        decision: {
          intent: 'investigate', goal: 'obter evidência', reasoningSummary: 'Consultar a ferramenta adequada.', nextAction: 'invokeTool',
          toolId: step.toolId, toolArguments, requiresAuthorization: step.toolId.startsWith('github.create') || step.toolId.startsWith('github.upsert'),
          expectedEvidence: 'observação da ferramenta', completionState: 'inProgress', confidence: 0.9,
        },
      };
    },
    async synthesize(request) {
      calls.synthesize += 1;
      const scenario = byText.get(request.objective);
      const collapse = (value: string): string => value.replace(/\s+/g, ' ');
      const corpus = collapse(request.observations.map((observation) => observation.summary).join('\n'));
      if (!scenario || scenario.ungroundedSynthesis === true || !scenario.evidence.every((excerpt) => corpus.includes(collapse(excerpt)))) {
        return { outcome: 'invalidResponse', reason: 'ungrounded' };
      }
      return { outcome: 'synthesized', answer: scenario.answer };
    },
    async respond() {
      calls.respond += 1;
      return { outcome: 'responded', answer: 'Resposta conversacional sem ferramentas.' };
    },
  };
}

// ---- Scenarios (gabarito) ----------------------------------------------------
const LIST_PROJECTS: ToolStep = { toolId: 'github.listProjects', args: {} };
const LAST_COMMIT: ToolStep = { toolId: 'github.listCommits', args: { projectId: LUMARKIS, limit: 1 } };
const PROJECTS_ANSWER = 'Tenho acesso a 4 projetos: SebastianIA, LUMARKIS Gestão Financeira, LSB Service e Neuro Hub Pro.';
const LAST_COMMIT_ANSWER = 'O último commit da main do LUMARKIS é 5e63b45 (merge: recuperar aplicação Lumarkis completa na main (#45)), de gahsantosss16-dev em 2026-11-11.';
const WRITE_TEXT_C1 = "Sebastian, no LUMARKIS, cria uma branch de teste isolada e adiciona nela um arquivo docs/teste-sebastian.md com o texto 'Teste C do Sebastian - alteração inofensiva'. Não mexe na main e não abre PR.";
const WRITE_TEXT_C2 = "Cria no GitHub uma branch de teste isolada no projeto LUMARKIS e adiciona nela o arquivo docs/teste-sebastian.md com o texto 'Teste C do Sebastian - alteração inofensiva'. Não mexe na main e não abre PR.";
const WRITE_TEXT_C3 = "Quero uma alteração inofensiva no projeto LUMARKIS e ela deve ficar numa branch nova: criar docs/teste-c.md contendo 'Teste C - alteracao inofensiva', sem PR e sem tocar na main.";
const CREATE_BRANCH: ToolStep = { toolId: 'github.createBranch', args: { projectId: LUMARKIS, branch: TASK_BRANCH } };
const WRITE_ANSWER = 'Proponho criar a branch sebastian/teste-c-20261111 no LUMARKIS.';

const TEST_A: readonly Scenario[] = [
  { id: 'A1', text: 'Quais projetos do GitHub você consegue acessar?', plan: [LIST_PROJECTS], answer: PROJECTS_ANSWER, evidence: ['LUMARKIS Gestão Financeira'], mustInclude: [/SebastianIA/, /LUMARKIS/, /LSB/, /Neuro/], mustNotInclude: [/desconhecido ou amb[ií]guo/i] },
  { id: 'A2', text: 'me mostra aí os repo que tu tem acesso', plan: [LIST_PROJECTS], answer: PROJECTS_ANSWER, evidence: ['LUMARKIS Gestão Financeira'], mustInclude: [/SebastianIA/, /LUMARKIS/, /LSB/, /Neuro/] },
  { id: 'A3', text: 'Qual foi o último commit do projeto LUMARKIS?', plan: [LAST_COMMIT], answer: LAST_COMMIT_ANSWER, evidence: ['5e63b45'], mustInclude: [/5e63b45/], mustNotInclude: [/não pôde ser identificado/i] },
  { id: 'A4', text: 'oq mudou por ultimo no financeiro lumarkis', plan: [LAST_COMMIT], answer: LAST_COMMIT_ANSWER, evidence: ['5e63b45'], mustInclude: [/5e63b45/], mustNotInclude: [/Identifiquei o projeto e suas regras/] },
  { id: 'A5', text: 'Lê o README do Lumarkis e me diz em 2 frases do que se trata o sistema', plan: [{ toolId: 'github.readFile', args: { projectId: LUMARKIS, path: 'README.md' } }], answer: 'É o sistema de gestão financeira da ASSOCIAPEC, uma aplicação web em React, TypeScript e Supabase. Está preparado para emitir NFS-e em Campo Grande/MS e a operação financeira está em homologação.', evidence: ['gestão financeira da ASSOCIAPEC', 'React + TypeScript + Supabase'], mustInclude: [/gestão financeira/i, /ASSOCIAPEC/] },
  { id: 'A6', text: 'quais pastas e arquivos tem na raiz do repositório do lumarkis?', plan: [{ toolId: 'github.listTree', args: { projectId: LUMARKIS, path: '' } }], answer: 'Na raiz há as pastas .github, app, css, docs, js, scripts e supabase, e os arquivos README.md, CLAUDE.md, index.html, .gitignore e .nojekyll.', evidence: ['supabase', 'index.html'], mustInclude: [/app/, /supabase/, /README\.md/] },
  { id: 'A7', text: 'e no workflow do github actions dele, quando o deploy roda?', plan: [{ toolId: 'github.listTree', args: { projectId: LUMARKIS, path: '.github/workflows' } }, { toolId: 'github.readFile', args: { projectId: LUMARKIS, path: '.github/workflows/pages.yml' } }], answer: 'O workflow pages.yml só roda manualmente (workflow_dispatch); não há deploy automático por push nele.', evidence: ['pages.yml', 'workflow_dispatch'], mustInclude: [/workflow_dispatch|manual/i] },
  { id: 'A8', text: 'A branch claude/login-mobile-rodape do Lumarkis tem commits que não estão na main?', plan: [{ toolId: 'github.compareBranch', args: { projectId: LUMARKIS, ref: 'claude/login-mobile-rodape' } }], answer: 'Sim: a branch está 1 commit à frente da main (e 80 atrás), com 1 arquivo alterado.', evidence: ['1 commit(s) à frente'], mustInclude: [/1 commit/], mustNotInclude: [/5273f38/, /b22513e/] },
  { id: 'A9', text: 'Sebastian, dá uma olhada no projeto de gestão financeira e me fala quem fez a última alteração e quando', plan: [LAST_COMMIT], answer: 'A última alteração foi feita por gahsantosss16-dev em 2026-11-11 (commit 5e63b45, merge do PR #45).', evidence: ['gahsantosss16-dev', '2026-11-11'], mustInclude: [/gahsantosss16-dev/, /2026-11-11/], mustNotInclude: [/desconhecido ou amb[ií]guo/i] },
  { id: 'A10', text: 'verifica se o Lumarkis tem algum teste automatizado configurado', plan: [{ toolId: 'github.readFile', args: { projectId: LUMARKIS, path: '.github/workflows/ci.yml' } }], answer: 'Sim. O workflow CI roda typecheck, Vitest e Playwright em push fora da main e em pull requests.', evidence: ['vitest', 'branches-ignore: [main]'], mustInclude: [/Sim/, /CI/] },
];
const TEST_B: readonly Scenario[] = [
  { id: 'B1', text: 'Sebastian, a main do LUMARKIS mudou bastante hoje. Investiga o que aconteceu e me explica a causa, sem chutar.', plan: [{ toolId: 'github.listCommits', args: { projectId: LUMARKIS, limit: 5 } }, { toolId: 'github.readFile', args: { projectId: LUMARKIS, path: 'docs/RECUPERACAO-MAIN-20261111.md' } }], answer: 'A main recebeu o merge do PR #45 (5e63b45), que a recuperou: antes ela só continha o protótipo Recebe Fácil (c875ead); agora traz a aplicação completa, conciliada com a produção publicada.', evidence: ['(#45)', 'protótipo Recebe Fácil'], mustInclude: [/#45/, /Recebe Fácil/], mustNotInclude: [/desconhecido ou amb[ií]guo/i] },
  { id: 'B2', text: 'Olha os commits mais recentes da main do LUMARKIS e me diz qual foi o último e o que ele fez.', plan: [LAST_COMMIT], answer: 'O último foi 5e63b45: o merge do PR #45, que recuperou a aplicação Lumarkis completa na main.', evidence: ['5e63b45', 'recuperar aplicação Lumarkis completa'], mustInclude: [/5e63b45/, /recuper/i] },
  { id: 'B3', text: 'Lê o arquivo docs/RECUPERACAO-MAIN-20261111.md do LUMARKIS e me resume por que a main foi recuperada.', plan: [{ toolId: 'github.readFile', args: { projectId: LUMARKIS, path: 'docs/RECUPERACAO-MAIN-20261111.md' } }], answer: 'Porque a main só tinha o protótipo Recebe Fácil; a recuperação trouxe a aplicação completa, partindo da produção publicada e preservando suas correções.', evidence: ['protótipo Recebe Fácil', 'Base na produção efetivamente publicada'], mustInclude: [/Recebe Fácil/], mustNotInclude: [/\| Referência \|/] },
];
const WRITE_SCENARIO = (id: string, text: string): Scenario => ({ id, text, plan: [CREATE_BRANCH], answer: WRITE_ANSWER, evidence: [], mustInclude: [/Proponho/, /sebastian\/teste-c-20261111/], mustNotInclude: [/Não consegui ler/, /desconhecido ou amb[ií]guo/i] });
const UPSERT_TEXT = 'Pode seguir: grava agora o arquivo nessa branch.';
const UPSERT: Scenario = {
  id: 'C1-arquivo', text: UPSERT_TEXT,
  plan: [{ toolId: 'github.upsertFile', args: { projectId: LUMARKIS, branch: TASK_BRANCH, path: 'docs/teste-sebastian.md', content: 'Teste C do Sebastian - alteração inofensiva\n', message: 'docs: teste C do Sebastian (alteração inofensiva)' } }],
  answer: 'Proponho gravar docs/teste-sebastian.md na branch.', evidence: [], mustInclude: [/Proponho/, /docs\/teste-sebastian\.md/],
};
const TEST_C: readonly Scenario[] = [WRITE_SCENARIO('C1', WRITE_TEXT_C1), WRITE_SCENARIO('C2', WRITE_TEXT_C2), WRITE_SCENARIO('C3', WRITE_TEXT_C3)];

// ---- Harness -----------------------------------------------------------------
type Layer = 'ok' | 'bloqueadoAntesDoModelo' | 'roteamentoDeterministico' | 'argumentosInvalidos' | 'declaracaoFalsa' | 'respostaIncorreta';
interface Outcome { readonly id: string; readonly layer: Layer; readonly answer: string; readonly decideCalls: number; readonly modelCalls: number; readonly toolIds: readonly string[] }

function captureLogger(lines: Array<{ readonly message: string; readonly metadata?: Record<string, unknown> }>): Logger {
  const record = (message: string, metadata?: Record<string, unknown>) => { lines.push({ message, ...(metadata === undefined ? {} : { metadata }) }); };
  return { debug: record, info: record, warn: record, error: record };
}

async function session(scenarios: readonly Scenario[], override: Partial<CognitiveModelProvider> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-homologation-'));
  const requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = githubFetch(requests);
  const calls = { decide: 0, synthesize: 0, respond: 0 };
  const logs: Array<{ readonly message: string; readonly metadata?: Record<string, unknown> }> = [];
  const env = {
    SEBASTIAN_GITHUB_TOKEN: 'test-read-token', SEBASTIAN_GITHUB_WRITE_TOKEN: 'test-write-token', SEBASTIAN_GITHUB_WRITE_ENABLED: 'true',
    SEBASTIAN_GITHUB_PROJECTS: JSON.stringify(PROJECTS), SEBASTIAN_STORE_DRIVER: 'file',
  };
  const provider: CognitiveModelProvider = { ...oracle([...scenarios, UPSERT], calls), ...override };
  const projectContext = createConfiguredProjectContext(dataDir, env);
  const app = createOnlineSebastianApplication(captureLogger(logs), provider, dataDir, env, projectContext);
  let second = 0;
  const send = async (scenario: Scenario | string): Promise<Outcome> => {
    const text = typeof scenario === 'string' ? scenario : scenario.text;
    const before = { decide: calls.decide, model: calls.decide + calls.synthesize + calls.respond, logs: logs.length };
    second += 1;
    const result = await app.executeCommand({ type: 'converse', input: { text }, generatedAt: `2026-11-11T02:00:${String(second).padStart(2, '0')}.000Z` });
    const answer = String(result.output.message ?? '');
    const turnLogs = logs.slice(before.logs);
    const decideCalls = calls.decide - before.decide;
    const toolIds = turnLogs.flatMap((line) => typeof line.metadata?.toolId === 'string' && line.metadata.toolInvoked === true ? [line.metadata.toolId] : []);
    if (typeof scenario === 'string') return { id: text, layer: 'ok', answer, decideCalls, modelCalls: calls.decide + calls.synthesize + calls.respond - before.model, toolIds };
    let layer: Layer = 'ok';
    if (/desconhecido ou amb[ií]guo|Identifiquei o projeto e suas regras/i.test(answer) && decideCalls === 0) layer = 'bloqueadoAntesDoModelo';
    else if (turnLogs.some((line) => line.metadata?.reason === 'cognitiveInvalidToolArguments')) layer = 'argumentosInvalidos';
    else if (scenario.mustNotInclude?.some((pattern) => pattern.test(answer))) layer = 'declaracaoFalsa';
    else if (!scenario.mustInclude.every((pattern) => pattern.test(answer))) layer = decideCalls === 0 ? 'roteamentoDeterministico' : 'respostaIncorreta';
    return { id: scenario.id, layer, answer, decideCalls, modelCalls: calls.decide + calls.synthesize + calls.respond - before.model, toolIds };
  };
  const close = () => { globalThis.fetch = originalFetch; rmSync(dataDir, { recursive: true, force: true }); };
  return { send, requests, close, calls };
}

const report: Outcome[] = [];
function record(outcome: Outcome): Outcome {
  report.push(outcome);
  return outcome;
}

test.after(() => {
  const summary = report.map(({ id, layer, decideCalls, modelCalls, toolIds, answer }) => ({ id, layer, decideCalls, modelCalls, toolIds, answer: answer.slice(0, 160) }));
  if (process.env.SEBASTIAN_HOMOLOGATION_REPORT) writeFileSync(process.env.SEBASTIAN_HOMOLOGATION_REPORT, JSON.stringify(summary, null, 2));
});

test('SPEC-051 Test A: the 10 natural GitHub requests reach the model and are answered from real evidence', async () => {
  const { send, close } = await session(TEST_A);
  try {
    const outcomes: Outcome[] = [];
    for (const scenario of TEST_A) outcomes.push(record(await send(scenario)));
    assert.deepEqual(outcomes.filter((outcome) => outcome.layer !== 'ok').map(({ id, layer, answer }) => ({ id, layer, answer })), []);
  } finally { close(); }
});

test('SPEC-051 Test B: diagnosing the LUMARKIS main recovery is explained from evidence, never as a raw file dump', async () => {
  const { send, close } = await session(TEST_B);
  try {
    const outcomes: Outcome[] = [];
    for (const scenario of TEST_B) outcomes.push(record(await send(scenario)));
    assert.deepEqual(outcomes.filter((outcome) => outcome.layer !== 'ok').map(({ id, layer, answer }) => ({ id, layer, answer })), []);
  } finally { close(); }
});

test('SPEC-051 Test C: every phrasing of the harmless write request becomes a sebastian/ branch proposal, never a read or a write to main', async () => {
  for (const scenario of TEST_C) {
    const { send, requests, close } = await session(TEST_C);
    try {
      const outcome = record(await send(scenario));
      assert.equal(outcome.layer, 'ok', `${scenario.id}: ${outcome.answer}`);
      assert.deepEqual(requests.filter((request) => request.method !== 'GET'), [], `${scenario.id}: a proposal must not write`);
    } finally { close(); }
  }
});

test('SPEC-051 Test C (flow): after explicit authorizations the file is committed only on the sebastian/ task branch', async () => {
  const { send, requests, close } = await session(TEST_C);
  try {
    assert.equal(record(await send(TEST_C[0]!)).layer, 'ok');
    const branch = await send('sim, pode executar');
    assert.match(branch.answer, /sebastian\/teste-c-20261111/);
    const proposal = record(await send(UPSERT));
    assert.equal(proposal.layer, 'ok', proposal.answer);
    const committed = await send('pode executar');
    assert.match(committed.answer, /commit/i);

    const writes = requests.filter((request) => request.method !== 'GET');
    assert.deepEqual(writes.map((request) => request.method), ['POST', 'PUT']);
    assert.equal(writes[0]!.body?.ref, `refs/heads/${TASK_BRANCH}`);
    assert.equal(writes[1]!.body?.branch, TASK_BRANCH);
    assert.ok(writes.every((request) => !/refs\/heads\/main|\/merges|\/pulls/.test(request.url) && request.body?.branch !== 'main'));
  } finally { close(); }
});

test('SPEC-052: the Gemini decision schema gives every Tool its own argument object with its required names', () => {
  const schema = decisionSchemaFor([
    { toolId: 'github.readFile', description: 'Lê arquivo.', requiresAuthorization: false, requiredArguments: ['projectId', 'path'] },
    { toolId: 'github.listCommits', description: 'Lista commits.', requiresAuthorization: false, requiredArguments: ['projectId'], optionalNumberArguments: ['limit'] },
  ]) as { properties: { toolArgumentsByTool: { properties: Record<string, unknown> } } };
  assert.deepEqual(schema.properties.toolArgumentsByTool.properties, {
    github_readFile: { type: 'object', properties: { projectId: { type: 'string' }, path: { type: 'string' } }, required: ['projectId', 'path'] },
    github_listCommits: { type: 'object', properties: { projectId: { type: 'string' }, limit: { type: 'integer' } }, required: ['projectId'] },
  });
});

test('SPEC-052: only the chosen Tool\'s argument object is used; other Tools\' arguments are discarded', () => {
  const picked = selectToolArguments({
    toolId: 'github.readFile',
    toolArgumentsByTool: { github_readFile: { projectId: 'lumarkis-financeiro', path: 'README.md' }, github_upsertFile: { content: 'x', message: 'y' } },
  }) as Record<string, unknown>;
  assert.deepEqual(picked.toolArguments, { projectId: 'lumarkis-financeiro', path: 'README.md' });
  assert.equal('toolArgumentsByTool' in picked, false);
});

test('SPEC-052: evidence grounding ignores only formatting, never wording', () => {
  const observed = '| main antes da recuperação | c875ead | **protótipo Recebe Fácil** |';
  assert.equal(normalizedIncludes(observed, 'main antes da recuperação c875ead protótipo Recebe Fácil'), true);
  assert.equal(normalizedIncludes(observed, 'a main tinha apenas um protótipo'), false);
  assert.equal(normalizedIncludes(observed, 'c8'), false, 'trivial excerpts never ground an answer');
});

test('SPEC-051 production round 2: a model that mixes other Tools\' arguments into readFile recovers once the menu is narrowed to its own Tool', async () => {
  // With the full menu the oracle sends the observed production payload
  // {projectId, content, message}; with a menu narrowed to the chosen Tool it
  // sends that Tool's real arguments.
  const scenario: Scenario = { ...TEST_A[4]!, id: 'A5-round2', confuseArgumentsWithWideMenu: true };
  const { send, close } = await session([scenario]);
  try {
    const outcome = await send(scenario);
    assert.equal(outcome.answer.includes('ASSOCIAPEC'), true, outcome.answer);
    assert.deepEqual(outcome.toolIds, ['github.readFile']);
  } finally { close(); }
});

test('SPEC-051: a decision schema narrowed to one Tool makes its required arguments mandatory', () => {
  const schema = decisionSchemaFor([
    { toolId: 'github.readFile', description: 'Lê arquivo.', requiresAuthorization: false, requiredArguments: ['projectId', 'path'] },
  ]) as { properties: { toolArguments: { required?: readonly string[] } } };
  assert.deepEqual(schema.properties.toolArguments.required, ['projectId', 'path']);
  const wide = decisionSchemaFor([
    { toolId: 'github.readFile', description: 'Lê arquivo.', requiresAuthorization: false, requiredArguments: ['projectId', 'path'] },
    { toolId: 'github.upsertFile', description: 'Grava.', requiresAuthorization: true, requiredArguments: ['projectId', 'branch', 'path', 'content', 'message'] },
  ]) as { properties: { toolArguments: { required?: readonly string[] } } };
  assert.equal(wide.properties.toolArguments.required, undefined);
});

test('SPEC-052: with Gemini rate-limited (429) and a project active, Sebastian states the limitation and invents nothing', async () => {
  let respondCalls = 0;
  const { send, close } = await session(TEST_A, {
    decide: async () => ({ outcome: 'unavailable', reason: 'HTTP 429' }),
    respond: async () => { respondCalls += 1; return { outcome: 'responded', answer: 'A última alteração foi realizada por mim, Sebastian.' }; },
  });
  try {
    await send('Use o LUMARKIS');
    const outcome = await send(TEST_A[8]!.text); // A9
    assert.doesNotMatch(outcome.answer, /por mim|Sebastian\./);
    assert.match(outcome.answer, /não vou afirmar nada sobre o projeto/);
    assert.equal(respondCalls, 0, 'the tool-less conversational path is never consulted for project facts');
  } finally { close(); }
});

test('SPEC-052: a model conclusion without evidence is kept; the deterministic route only adds an observation and never swaps the operation', async () => {
  const modelAnswer = 'A branch de teste já foi criada antes; não vou criar outra nem alterar nada sem um novo pedido explícito.';
  const scenario: Scenario = { id: 'C2-round2', text: WRITE_TEXT_C2, plan: [], answer: modelAnswer, evidence: [], mustInclude: [/já foi criada/] };
  const { send, requests, close } = await session([scenario]);
  try {
    const outcome = await send(scenario);
    assert.equal(outcome.answer, modelAnswer);
    assert.doesNotMatch(outcome.answer, /Não consegui ler/);
    assert.deepEqual(requests.filter((request) => request.method !== 'GET'), []);
  } finally { close(); }
});

test('SPEC-052: "cancela" or "pode executar" with nothing pending never claims a cancellation or an execution', async () => {
  const { send, requests, close } = await session(TEST_C);
  try {
    assert.match((await send('cancela')).answer, /Não há nenhuma proposta pendente para cancelar; nada foi alterado/);
    assert.match((await send('pode executar')).answer, /Não há nenhuma proposta pendente para executar; nada foi executado/);
    assert.deepEqual(requests.filter((request) => request.method !== 'GET'), []);
  } finally { close(); }
});

test('SPEC-052: a combined affirmative authorizes, but any extra instruction or negation never does', async () => {
  for (const reply of ['não pode executar', 'sim, mas cria na main', 'talvez pode executar']) {
    const { send, requests, close } = await session(TEST_C);
    try {
      assert.match((await send(TEST_C[0]!)).answer, /Proponho/);
      await send(reply);
      assert.deepEqual(requests.filter((request) => request.method !== 'GET'), [], reply);
    } finally { close(); }
  }
});

test('SPEC-053: a concluding decision with grounded evidence is answered directly - no separate synthesis call', async () => {
  const scenario: Scenario = { ...TEST_A[4]!, id: 'A5-grounded', decisionEvidence: ['gestão financeira da ASSOCIAPEC'] };
  const { send, close, calls } = await session([scenario]);
  try {
    const outcome = await send(scenario);
    assert.equal(outcome.answer, scenario.answer);
    assert.equal(calls.synthesize, 0);
  } finally { close(); }
});

test('SPEC-053: an invented decision excerpt is never shown; synthesis is the second grounded attempt', async () => {
  const scenario: Scenario = { ...TEST_A[4]!, id: 'A5-invented', decisionEvidence: ['o sistema tem 40 módulos e IA própria'] };
  const { send, close, calls } = await session([scenario]);
  try {
    const outcome = await send(scenario);
    assert.equal(calls.synthesize, 1);
    assert.match(outcome.answer, /ASSOCIAPEC/);
  } finally { close(); }
});

test('SPEC-053: when neither the decision nor the synthesis is grounded, the answer is labelled and bounded, never a raw dump', async () => {
  const scenario: Scenario = { ...TEST_B[2]!, id: 'B3-ungrounded', decisionEvidence: ['texto que não existe no documento'], ungroundedSynthesis: true };
  const { send, close } = await session([scenario]);
  try {
    const outcome = await send(scenario);
    // The fixture document is short (< 900 chars), so the evidence itself is
    // returned; anything longer is labelled and cut (the real file is ~4.5 KB).
    assert.ok(outcome.answer.length < 1100, `bounded: ${outcome.answer.length}`);
    assert.ok(outcome.answer.length <= 900 || /^Consultei a fonte, mas não consegui produzir um resumo verificável agora/.test(outcome.answer));
    assert.doesNotMatch(outcome.answer, /texto que não existe no documento/);
  } finally { close(); }
});

test('SPEC-053: evidence gathered before the decision budget runs out is used, not discarded (A7/A10)', async () => {
  const step = (path: string): ToolStep => ({ toolId: 'github.readFile', args: { projectId: LUMARKIS, path } });
  const scenario: Scenario = {
    id: 'A10-budget', text: TEST_A[9]!.text,
    plan: [{ toolId: 'github.listTree', args: { projectId: LUMARKIS, path: '.github/workflows' } }, step('.github/workflows/ci.yml'), step('.github/workflows/pages.yml'), step('README.md'), step('README.md')],
    answer: TEST_A[9]!.answer, evidence: ['vitest', 'branches-ignore: [main]'], mustInclude: [/Sim/],
  };
  const { send, close } = await session([scenario]);
  try {
    const outcome = await send(scenario);
    assert.doesNotMatch(outcome.answer, /Não consegui concluir/);
    assert.match(outcome.answer, /Sim/);
  } finally { close(); }
});

test('SPEC-053: a long document that cannot be summarised verifiably is labelled and cut, not dumped', async () => {
  const scenario: Scenario = { ...TEST_B[2]!, id: 'B3-long', text: 'Lê o arquivo docs/LONGO.md do LUMARKIS e me resume.', plan: [{ toolId: 'github.readFile', args: { projectId: LUMARKIS, path: 'docs/LONGO.md' } }], decisionEvidence: ['inventado'], ungroundedSynthesis: true };
  const { send, close } = await session([scenario]);
  try {
    const outcome = await send(scenario);
    assert.match(outcome.answer, /^Consultei a fonte, mas não consegui produzir um resumo verificável agora/);
    assert.ok(outcome.answer.length < 1100, `bounded: ${outcome.answer.length}`);
  } finally { close(); }
});

test('SPEC-053: after a failed Tool, an ungrounded model conclusion is never shown as fact', async () => {
  const scenario: Scenario = { ...TEST_B[2]!, id: 'B3-missing', text: 'Lê o arquivo docs/NAO-EXISTE.md do LUMARKIS e me resume.', plan: [{ toolId: 'github.readFile', args: { projectId: LUMARKIS, path: 'docs/NAO-EXISTE.md' } }] };
  const { send, close } = await session([scenario]);
  try {
    const outcome = await send(scenario);
    assert.doesNotMatch(outcome.answer, /Recebe Fácil/, 'the invented summary of an unread file must not appear');
    assert.match(outcome.answer, /^Não posso confirmar isso com evidência/);
  } finally { close(); }
});

test('SPEC-053: a registered project named anywhere in the request becomes active; quoted content and double mentions do not', async () => {
  const commitsAnswer: Scenario = { id: 'S2-lumarkis', text: 'Grava direto na main do LUMARKIS o arquivo docs/teste-main.md com o texto oi.', plan: [{ toolId: 'github.listCommits', args: { projectId: LUMARKIS, limit: 1 } }], answer: LAST_COMMIT_ANSWER, evidence: ['5e63b45'], mustInclude: [/5e63b45/] };
  const { send, requests, close } = await session([commitsAnswer]);
  try {
    await send('Use o Neuro');
    await send(commitsAnswer);
    // The GitHub call went to financeiro-lumarkis, not to the previously active Neuro Hub Pro.
    assert.ok(requests.some((request) => request.url.includes('/repos/gahsantosss16-dev/financeiro-lumarkis/commits')), JSON.stringify(requests.map((request) => request.url)));
    assert.equal(requests.some((request) => request.url.includes('/neuro-hub-pro/')), false);
  } finally { close(); }
});
