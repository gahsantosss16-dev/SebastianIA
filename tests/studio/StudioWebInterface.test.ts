import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Script, createContext, runInContext } from 'node:vm';
import { ConversationRegistry, FileCommandContextHydrator, FileMemoryStore } from '../../core/memory/index.js';
import { MAX_HTTP_BODY_BYTES, SebastianHttpServer } from '../../application/SebastianHttpServer.js';
import {
  STUDIO_CONTENT_SECURITY_POLICY,
  STUDIO_DURATION_OPTIONS_SECONDS,
  STUDIO_MAX_STORY_LENGTH,
  STUDIO_MAX_TITLE_LENGTH,
  STUDIO_PLAN_BUILDER_SOURCE,
  STUDIO_WEB_HTML,
  STUDIO_WEB_SCRIPT,
  STUDIO_WEB_STYLES,
} from '../../application/StudioWebInterface.js';
import { validateStudioPlan, type StudioProductionPlan } from '../../studio/VideoProductionPlan.js';

interface StudioInput {
  readonly title?: unknown;
  readonly story?: unknown;
  readonly style?: unknown;
  readonly format?: unknown;
  readonly durationSeconds?: unknown;
}

/** Runs the exact source shipped to the browser in an isolated context. */
function loadBuilder(): (input: StudioInput) => StudioProductionPlan {
  const context = createContext({});
  runInContext(STUDIO_PLAN_BUILDER_SOURCE, context);
  const build = context.buildStudioPlan as (input: StudioInput) => unknown;
  // Round-trip through JSON: the plan crosses the wire exactly like this.
  return (input) => JSON.parse(JSON.stringify(build(input))) as StudioProductionPlan;
}

const buildStudioPlan = loadBuilder();
const baseInput = {
  title: 'O Robô que Entendeu Tudo Errado',
  story: 'Nina pediu ao robô Bolota para arrumar o quarto.\n\nBolota empilhou todos os brinquedos até o teto.\n\nNo fim, os dois riram e guardaram tudo juntos.',
  style: '3d_cartoon',
  format: '9:16',
  durationSeconds: 30,
};

function captureError(fn: () => unknown): Error {
  try { fn(); } catch (error) { return error as Error; }
  assert.fail('expected an error');
}

test('builds a plan the server contract accepts for every style, format and duration', () => {
  for (const style of ['3d_cartoon', 'cinematic', 'anime']) {
    for (const format of ['9:16', '16:9', '1:1']) {
      for (const durationSeconds of STUDIO_DURATION_OPTIONS_SECONDS) {
        const plan = buildStudioPlan({ ...baseInput, style, format, durationSeconds });
        assert.equal(validateStudioPlan(plan), plan);
        assert.equal(plan.style, style);
        assert.equal(plan.format, format);
        assert.equal(plan.durationSeconds, durationSeconds);
        assert.equal(plan.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0), durationSeconds);
      }
    }
  }
});

test('keeps the 3D animation objective, local zero-cost rendering and pt-BR narration', () => {
  const plan = buildStudioPlan(baseInput);
  assert.equal(plan.language, 'pt-BR');
  assert.equal(plan.status, 'rendering');
  assert.equal(plan.estimatedCostUsd, 0);
  assert.equal(plan.budgetApproved, true);
  assert.deepEqual(plan.scenes.map((scene) => scene.id), ['cena-1', 'cena-2', 'cena-3']);
  for (const scene of plan.scenes) {
    assert.match(scene.visualPrompt, /^Animação 3D/);
    assert.deepEqual(scene.characterIds, ['narrador']);
  }
  assert.equal(buildStudioPlan({ ...baseInput, style: 'cinematic' }).scenes[0]?.visualPrompt.startsWith('Animação 3D cinematográfica: '), true);
});

test('one scene per paragraph, single paragraph split by sentence, text preserved in order', () => {
  const paragraphs = buildStudioPlan(baseInput);
  assert.deepEqual(paragraphs.scenes.map((scene) => scene.dialogue[0]?.text), [
    'Nina pediu ao robô Bolota para arrumar o quarto.',
    'Bolota empilhou todos os brinquedos até o teto.',
    'No fim, os dois riram e guardaram tudo juntos.',
  ]);
  const sentences = buildStudioPlan({ ...baseInput, story: 'Era uma vez um robô. Ele adorava dançar! Será que dançaria hoje?' });
  assert.deepEqual(sentences.scenes.map((scene) => scene.dialogue[0]?.text), ['Era uma vez um robô.', 'Ele adorava dançar!', 'Será que dançaria hoje?']);
});

test('merges paragraphs instead of dropping text when there are more than the duration allows', () => {
  const story = Array.from({ length: 30 }, (_, i) => `Parágrafo ${i + 1}.`).join('\n\n');
  const long = buildStudioPlan({ ...baseInput, story, durationSeconds: 180 });
  assert.equal(long.scenes.length, 20);
  const short = buildStudioPlan({ ...baseInput, story, durationSeconds: 15 });
  assert.equal(short.scenes.length, 5);
  for (const plan of [long, short]) {
    assert.equal(validateStudioPlan(plan), plan);
    assert.equal(plan.scenes.map((scene) => scene.dialogue[0]?.text).join(' '), story.split('\n\n').join(' '));
    assert.ok(plan.scenes.every((scene) => scene.durationSeconds >= 3));
  }
});

test('longer scenes get proportionally more time', () => {
  const plan = buildStudioPlan({ ...baseInput, story: `Curta.\n\n${'Uma cena bem mais longa com muitos detalhes visuais. '.repeat(6)}`, durationSeconds: 60 });
  assert.ok((plan.scenes[1]?.durationSeconds ?? 0) > (plan.scenes[0]?.durationSeconds ?? 0));
});

test('rejects invalid input with pt-BR messages before calling the server', () => {
  const cases: readonly [StudioInput, RegExp][] = [
    [{ ...baseInput, title: '   ' }, /título/],
    [{ ...baseInput, title: 'x'.repeat(STUDIO_MAX_TITLE_LENGTH + 1) }, /título/],
    [{ ...baseInput, story: '' }, /história/],
    [{ ...baseInput, story: 'x'.repeat(STUDIO_MAX_STORY_LENGTH + 1) }, /história/],
    [{ ...baseInput, style: 'slides' }, /estilo/],
    [{ ...baseInput, style: 'toString' }, /estilo/],
    [{ ...baseInput, format: '4:3' }, /formato/],
    [{ ...baseInput, durationSeconds: 7 }, /duração/],
  ];
  for (const [input, message] of cases) {
    const error = captureError(() => buildStudioPlan(input));
    assert.equal(error.name, 'StudioInputError');
    assert.match(error.message, message);
  }
});

test('the largest accepted story still fits the server request body limit', () => {
  const story = Array.from({ length: 40 }, () => 'ação çãõ éê '.repeat(8).trim()).join('\n\n').slice(0, STUDIO_MAX_STORY_LENGTH);
  const plan = buildStudioPlan({ ...baseInput, title: 'Ç'.repeat(STUDIO_MAX_TITLE_LENGTH), story, durationSeconds: 180 });
  assert.ok(Buffer.byteLength(JSON.stringify({ plan })) < MAX_HTTP_BODY_BYTES);
});

test('page is CSP-safe and every element the script uses exists', () => {
  assert.doesNotThrow(() => new Script(STUDIO_WEB_SCRIPT));
  assert.doesNotMatch(STUDIO_WEB_HTML, /<script(?![^>]*\bsrc=)/);
  assert.doesNotMatch(STUDIO_WEB_HTML, /\sstyle=|\son[a-z]+=/i);
  assert.doesNotMatch(STUDIO_WEB_SCRIPT, /innerHTML|outerHTML|insertAdjacentHTML|eval\(/);
  const ids = [...STUDIO_WEB_SCRIPT.matchAll(/\$\('#([a-z-]+)'\)/g)].map((match) => match[1] ?? '');
  assert.ok(ids.length > 10);
  for (const id of ids) assert.match(STUDIO_WEB_HTML, new RegExp(`id="${id}"`), id);
  assert.match(STUDIO_WEB_SCRIPT, /fetch\('\/api\/studio\/render'/);
  assert.match(STUDIO_WEB_SCRIPT, /fetch\('\/api\/web\/session'/);
  assert.match(STUDIO_WEB_STYLES, /@media \(max-width: 520px\)/);
  assert.match(STUDIO_WEB_HTML, /name="viewport" content="width=device-width, initial-scale=1"/);
});

async function startStudioServer(): Promise<{ readonly baseUrl: string; readonly close: () => Promise<void> }> {
  const store = new FileMemoryStore(join(mkdtempSync(join(tmpdir(), 'sebastian-studio-ui-')), 'memory.json'));
  const http = new SebastianHttpServer({
    application: { executeCommand: async () => ({ status: 'succeeded', commandId: 'c', data: {} }) as never, shutdown: () => undefined },
    apiToken: 'studio-test-only-token',
    conversationRegistry: new ConversationRegistry(store, new FileCommandContextHydrator(store)),
    logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    requestId: () => 'request-test-id',
  });
  const started = await http.listen(0, '127.0.0.1');
  return { baseUrl: `http://127.0.0.1:${started.port}`, close: started.close };
}

test('serves /studio and its assets with hardened headers allowing same-origin video only', async () => {
  const server = await startStudioServer();
  try {
    const page = await fetch(`${server.baseUrl}/studio`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(page.headers.get('content-security-policy'), STUDIO_CONTENT_SECURITY_POLICY);
    assert.match(STUDIO_CONTENT_SECURITY_POLICY, /media-src 'self'/);
    assert.match(STUDIO_CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(await page.text(), STUDIO_WEB_HTML);

    const script = await fetch(`${server.baseUrl}/assets/studio.js`);
    assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(await script.text(), STUDIO_WEB_SCRIPT);
    const styles = await fetch(`${server.baseUrl}/assets/studio.css`);
    assert.equal(styles.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(await styles.text(), STUDIO_WEB_STYLES);

    const post = await fetch(`${server.baseUrl}/studio`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET');

    // The main interface keeps its original policy (no media-src).
    const home = await fetch(`${server.baseUrl}/`);
    assert.doesNotMatch(home.headers.get('content-security-policy') ?? '', /media-src/);
    await home.text();
  } finally {
    await server.close();
  }
});

test('studio session check is unauthenticated without a valid cookie', async () => {
  const server = await startStudioServer();
  try {
    const anonymous = await fetch(`${server.baseUrl}/api/web/session`, { headers: { cookie: 'sebastian_session=forged' } });
    assert.deepEqual(await anonymous.json(), { authenticated: false });
  } finally {
    await server.close();
  }
});
