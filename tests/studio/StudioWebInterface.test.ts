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
  STUDIO_MAX_CHARACTER_DESCRIPTION_LENGTH,
  STUDIO_MAX_CHARACTER_NAME_LENGTH,
  STUDIO_MAX_CHARACTERS,
  STUDIO_MAX_REQUEST_BYTES,
  STUDIO_VISUAL_EXCERPT_LENGTH,
  STUDIO_MAX_STORY_LENGTH,
  STUDIO_MAX_TITLE_LENGTH,
  STUDIO_PLAN_BUILDER_SOURCE,
  STUDIO_RENDER_PROTOCOL_SOURCE,
  STUDIO_WEB_HTML,
  STUDIO_WEB_SCRIPT,
  STUDIO_WEB_STYLES,
} from '../../application/StudioWebInterface.js';
import { validateStudioPlan, type StudioProductionPlan } from '../../studio/VideoProductionPlan.js';

interface StudioInput {
  readonly title?: unknown;
  readonly story?: unknown;
  readonly characters?: unknown;
  readonly style?: unknown;
  readonly format?: unknown;
  readonly durationSeconds?: unknown;
}

interface Outcome {
  readonly kind?: string;
  readonly reason?: string;
  readonly message?: string;
  readonly state?: string;
  readonly downloadUrl?: string;
  readonly fileName?: string;
  readonly statusUrl?: string;
  readonly stage?: string;
  readonly progress?: number | null;
  readonly queued?: boolean;
}

/** Runs the exact sources shipped to the browser in an isolated context; results cross back as JSON, like on the wire. */
function loadClient(): Readonly<Record<string, (...args: unknown[]) => unknown>> {
  const context = createContext({});
  runInContext(STUDIO_PLAN_BUILDER_SOURCE, context);
  runInContext(STUDIO_RENDER_PROTOCOL_SOURCE, context);
  const wrap = (name: string) => (...args: unknown[]): unknown => JSON.parse(JSON.stringify((context[name] as (...a: unknown[]) => unknown)(...args)));
  return Object.fromEntries(['buildStudioPlan', 'interpretRenderResponse', 'interpretJobStatus', 'interpretEngineStatus'].map((name) => [name, wrap(name)]));
}

const client = loadClient();
const buildStudioPlan = (input: StudioInput): StudioProductionPlan => client.buildStudioPlan!(input) as StudioProductionPlan;
const interpretRenderResponse = (status: number, body: unknown): Outcome => client.interpretRenderResponse!(status, body) as Outcome;
const interpretJobStatus = (status: number, body: unknown): Outcome => client.interpretJobStatus!(status, body) as Outcome;
const interpretEngineStatus = (status: number, body: unknown): Outcome => client.interpretEngineStatus!(status, body) as Outcome;

const baseInput = {
  title: 'O Robô que Entendeu Tudo Errado',
  story: 'Nina pediu ao robô Bolota para arrumar o quarto.\n\nBolota empilhou todos os brinquedos até o teto.\n\nNo fim, os dois riram e guardaram tudo juntos.',
  style: '3d_cartoon',
  format: '9:16',
  durationSeconds: 30,
};
const cast = 'Nina: menina de 8 anos, jardineira roxa\nBolota — robô redondo azul e branco';

function captureError(fn: () => unknown): Error {
  try { fn(); } catch (error) { return error as Error; }
  assert.fail('expected an error');
}

test('builds a plan the server contract accepts for every style, format and duration', () => {
  for (const style of ['3d_cartoon', 'cinematic', 'anime']) {
    for (const format of ['9:16', '16:9', '1:1']) {
      for (const durationSeconds of STUDIO_DURATION_OPTIONS_SECONDS) {
        for (const characters of ['', cast]) {
          const plan = buildStudioPlan({ ...baseInput, characters, style, format, durationSeconds });
          assert.equal(validateStudioPlan(plan), plan);
          assert.equal(plan.style, style);
          assert.equal(plan.format, format);
          assert.equal(plan.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0), durationSeconds);
        }
      }
    }
  }
});

test('keeps the 3D animation objective, pt-BR narration and a zero estimate only for local rendering', () => {
  const plan = buildStudioPlan(baseInput);
  assert.equal(plan.language, 'pt-BR');
  assert.equal(plan.status, 'rendering');
  assert.equal(plan.estimatedCostUsd, 0);
  assert.equal(plan.budgetApproved, true);
  assert.deepEqual(plan.scenes.map((scene) => scene.id), ['cena-1', 'cena-2', 'cena-3']);
  assert.deepEqual(plan.characters.map((c) => c.id), ['narrador']);
  for (const scene of plan.scenes) {
    assert.match(scene.visualPrompt, /^Animação 3D/);
    assert.deepEqual(scene.characterIds, ['narrador']);
  }
  assert.ok(buildStudioPlan({ ...baseInput, style: 'cinematic' }).scenes[0]?.visualPrompt.startsWith('Animação 3D cinematográfica: '));
});

test('cast lines become consistent characters; "Nome: fala" lines are attributed, mentions put them on scene', () => {
  const plan = buildStudioPlan({
    ...baseInput,
    characters: cast,
    story: 'Nina pediu ao robô Bolota para arrumar o quarto.\nNina: Bolota, guarde tudo!\n\nBolota: Missão cumprida!\n\nO quarto ficou em silêncio.',
  });
  assert.equal(validateStudioPlan(plan), plan);
  assert.deepEqual(plan.characters.map((c) => [c.id, c.name, c.visualDescription]), [
    ['narrador', 'Narrador', 'Narrador em off: apenas voz, sem aparição obrigatória em cena'],
    ['nina', 'Nina', 'menina de 8 anos, jardineira roxa'],
    ['bolota', 'Bolota', 'robô redondo azul e branco'],
  ]);
  assert.deepEqual(plan.scenes.map((scene) => scene.characterIds), [['narrador', 'nina', 'bolota'], ['bolota'], ['narrador']]);
  assert.deepEqual(plan.scenes[0]?.dialogue, [
    { characterId: 'narrador', text: 'Nina pediu ao robô Bolota para arrumar o quarto.' },
    { characterId: 'nina', text: 'Bolota, guarde tudo!' },
  ]);
  assert.deepEqual(plan.scenes[1]?.dialogue, [{ characterId: 'bolota', text: 'Missão cumprida!' }]);
});

test('narrator is only cast when it speaks; accented names get ASCII ids; mentions need whole words', () => {
  const plan = buildStudioPlan({ ...baseInput, characters: 'Joãozinho: menino de boné\nAna: menina ruiva', story: 'Joãozinho: Olá!\n\nJoãozinho: Cadê a Ana?\n\nJoãozinho: Bananas!' });
  assert.deepEqual(plan.characters.map((c) => c.id), ['joaozinho', 'ana']);
  assert.deepEqual(plan.scenes.map((scene) => scene.characterIds), [['joaozinho'], ['joaozinho', 'ana'], ['joaozinho']]);
  // "Narrador: ..." in the cast customizes the narrator instead of duplicating it.
  const narrated = buildStudioPlan({ ...baseInput, characters: 'Narrador: avô contador de histórias' });
  assert.equal(narrated.characters[0]?.visualDescription, 'avô contador de histórias');
  assert.equal(narrated.characters.length, 1);
});

test('one scene per paragraph, single paragraph split by line then sentence, text preserved in order', () => {
  assert.deepEqual(buildStudioPlan(baseInput).scenes.map((scene) => scene.dialogue[0]?.text), [
    'Nina pediu ao robô Bolota para arrumar o quarto.',
    'Bolota empilhou todos os brinquedos até o teto.',
    'No fim, os dois riram e guardaram tudo juntos.',
  ]);
  const sentences = buildStudioPlan({ ...baseInput, story: 'Era uma vez um robô. Ele adorava dançar! Será que dançaria hoje?' });
  assert.deepEqual(sentences.scenes.map((scene) => scene.dialogue[0]?.text), ['Era uma vez um robô.', 'Ele adorava dançar!', 'Será que dançaria hoje?']);
  const lines = buildStudioPlan({ ...baseInput, story: 'Primeira linha.\nSegunda linha.' });
  assert.equal(lines.scenes.length, 2);
});

test('merges paragraphs instead of dropping text when there are more than the duration allows', () => {
  const story = Array.from({ length: 30 }, (_, i) => `Parágrafo ${i + 1}.`).join('\n\n');
  const long = buildStudioPlan({ ...baseInput, story, durationSeconds: 180 });
  assert.equal(long.scenes.length, 20);
  const short = buildStudioPlan({ ...baseInput, story, durationSeconds: 15 });
  assert.equal(short.scenes.length, 5);
  for (const plan of [long, short]) {
    assert.equal(validateStudioPlan(plan), plan);
    assert.equal(plan.scenes.flatMap((scene) => scene.dialogue.map((line) => line.text)).join(' '), story.split('\n\n').join(' '));
    assert.ok(plan.scenes.every((scene) => scene.durationSeconds >= 3));
  }
});

test('longer scenes get proportionally more time', () => {
  const plan = buildStudioPlan({ ...baseInput, story: `Curta.\n\n${'Uma cena bem mais longa com muitos detalhes visuais. '.repeat(6)}`, durationSeconds: 60 });
  assert.ok((plan.scenes[1]?.durationSeconds ?? 0) > (plan.scenes[0]?.durationSeconds ?? 0));
});

test('rejects invalid input with pt-BR messages before calling the server', () => {
  const tooManyCast = Array.from({ length: STUDIO_MAX_CHARACTERS + 1 }, (_, i) => `P${i}: pessoa ${i}`).join('\n');
  const cases: readonly [StudioInput, RegExp][] = [
    [{ ...baseInput, title: '   ' }, /título/],
    [{ ...baseInput, title: 'x'.repeat(STUDIO_MAX_TITLE_LENGTH + 1) }, /título/],
    [{ ...baseInput, story: '' }, /história/],
    [{ ...baseInput, story: 'x'.repeat(STUDIO_MAX_STORY_LENGTH + 1) }, /história/],
    [{ ...baseInput, style: 'slides' }, /estilo/],
    [{ ...baseInput, style: 'toString' }, /estilo/],
    [{ ...baseInput, format: '4:3' }, /formato/],
    [{ ...baseInput, format: 'constructor' }, /formato/],
    [{ ...baseInput, durationSeconds: 7 }, /duração/],
    [{ ...baseInput, characters: 'Nina' }, /aparência de Nina/],
    [{ ...baseInput, characters: 'Nina: menina\nnina: outra' }, /mais de uma vez/],
    [{ ...baseInput, characters: tooManyCast }, /no máximo 6 personagens/],
    [{ ...baseInput, characters: `${'N'.repeat(STUDIO_MAX_CHARACTER_NAME_LENGTH + 1)}: alguém` }, /caracteres/],
    [{ ...baseInput, characters: `Nina: ${'a'.repeat(STUDIO_MAX_CHARACTER_DESCRIPTION_LENGTH + 1)}` }, /descrição de Nina/],
  ];
  for (const [input, message] of cases) {
    const error = captureError(() => buildStudioPlan(input));
    assert.equal(error.name, 'StudioInputError');
    assert.match(error.message, message);
  }
});

test('a full production fits the server request body limit; an oversized one fails before sending', () => {
  assert.equal(STUDIO_MAX_REQUEST_BYTES, MAX_HTTP_BODY_BYTES);
  const fullCast = Array.from({ length: STUDIO_MAX_CHARACTERS }, (_, i) =>
    `${String.fromCharCode(65 + i)}${'a'.repeat(STUDIO_MAX_CHARACTER_NAME_LENGTH - 1)}: ${'aparência detalhada '.repeat(10).slice(0, STUDIO_MAX_CHARACTER_DESCRIPTION_LENGTH)}`).join('\n');
  // Typical Portuguese prose at the maximum story length, with the maximum cast.
  const prose = 'O robô atravessou a cidade à noite, procurando a menina que ele prometera proteger.';
  const story = Array.from({ length: 60 }, () => prose).join('\n\n').slice(0, STUDIO_MAX_STORY_LENGTH);
  const plan = buildStudioPlan({ ...baseInput, story, characters: fullCast, durationSeconds: 180 });
  assert.equal(validateStudioPlan(plan), plan);
  assert.ok(Buffer.byteLength(JSON.stringify({ plan })) < MAX_HTTP_BODY_BYTES);
  // The full text is never truncated: it travels in the dialogue.
  assert.equal(plan.scenes.flatMap((scene) => scene.dialogue.map((line) => line.text)).join(' '), story.split('\n\n').map((p) => p.trim()).join(' '));
  assert.ok(plan.scenes.every((scene) => scene.visualPrompt.length <= 'Animação 3D estilo cartoon: '.length + STUDIO_VISUAL_EXCERPT_LENGTH));

  const heavyCast = Array.from({ length: STUDIO_MAX_CHARACTERS }, (_, i) =>
    `${String.fromCharCode(65 + i)}${'ç'.repeat(STUDIO_MAX_CHARACTER_NAME_LENGTH - 1)}: ${'é'.repeat(STUDIO_MAX_CHARACTER_DESCRIPTION_LENGTH)}`).join('\n');
  const accented = Array.from({ length: 600 }, () => 'çãõ éê').join('\n').slice(0, STUDIO_MAX_STORY_LENGTH);
  const error = captureError(() => buildStudioPlan({ ...baseInput, title: 'Ç'.repeat(STUDIO_MAX_TITLE_LENGTH), story: accented, characters: heavyCast, durationSeconds: 180 }));
  assert.equal(error.name, 'StudioInputError');
  assert.match(error.message, /grande demais/);
});

test('visual prompt carries a short narration excerpt for the 3D scene', () => {
  const story = `Nina: ${'Fala longa da Nina. '.repeat(3)}\nO quarto ${'muito '.repeat(60)}bagunçado.`;
  const plan = buildStudioPlan({ ...baseInput, characters: cast, story: `${story}\n\nFim.` });
  const prompt = plan.scenes[0]?.visualPrompt ?? '';
  assert.match(prompt, /^Animação 3D estilo cartoon: O quarto muito/);
  assert.doesNotMatch(prompt, /Fala longa/);
  assert.ok(prompt.endsWith('…'));
});

test('render responses: synchronous MP4, optional job, and clear failures', () => {
  assert.deepEqual(interpretRenderResponse(201, { ok: true, fileName: 'sebastian-studio-1.mp4', downloadUrl: '/api/studio/renders/sebastian-studio-1.mp4' }), {
    kind: 'completed', downloadUrl: '/api/studio/renders/sebastian-studio-1.mp4', fileName: 'sebastian-studio-1.mp4',
  });
  // Never follows a URL outside the Studio render path, nor trusts an odd file name.
  for (const downloadUrl of ['https://evil.example/x.mp4', '/api/studio/renders/../secret.mp4', 'javascript:alert(1)', '/api/studio/renders/a.mp4?x']) {
    assert.equal(interpretRenderResponse(201, { downloadUrl }).reason, 'invalid_response', downloadUrl);
  }
  assert.equal(interpretRenderResponse(201, { downloadUrl: '/api/studio/renders/a.mp4', fileName: '"><x.mp4' }).fileName, 'a.mp4');

  assert.deepEqual(interpretRenderResponse(202, { statusUrl: '/api/studio/jobs/abc-1', status: 'queued' }), {
    kind: 'pending', queued: true, stage: '', progress: null, statusUrl: '/api/studio/jobs/abc-1',
  });
  assert.equal(interpretRenderResponse(202, { statusUrl: '//evil.example/jobs/1' }).reason, 'invalid_response');

  assert.equal(interpretRenderResponse(401, {}).kind, 'locked');
  const reasons: readonly [number, unknown, string][] = [
    [404, null, 'engine_unavailable'],
    [405, null, 'engine_unavailable'],
    [503, { error: { code: 'STUDIO_UNAVAILABLE', message: 'sem Blender' } }, 'engine_unavailable'],
    [503, { error: { code: 'STUDIO_BUSY', message: 'ocupado' } }, 'busy'],
    [402, null, 'cost_approval'],
    [400, { error: { code: 'INVALID_STUDIO_PLAN', message: 'Invalid style' } }, 'invalid_plan'],
    [413, null, 'too_large'],
    [504, null, 'gateway_timeout'],
    [500, { error: { message: 'falha interna' } }, 'unexpected'],
    [500, null, 'unexpected'],
  ];
  for (const [status, body, reason] of reasons) {
    const outcome = interpretRenderResponse(status, body);
    assert.equal(outcome.kind, 'failed');
    assert.equal(outcome.reason, reason, String(status));
    assert.ok((outcome.message ?? '').length > 10);
  }
  assert.match(interpretRenderResponse(503, { error: { code: 'STUDIO_UNAVAILABLE', message: 'sem Blender' } }).message ?? '', /não está disponível.*sem Blender/);
  assert.match(interpretRenderResponse(402, null).message ?? '', /Nada foi cobrado/);
});

test('job polling: progress, completion, cancellation, failure and lost jobs', () => {
  assert.deepEqual(interpretJobStatus(200, { status: 'rendering', stage: 'Animando cena 2 de 5', progress: 0.4 }), {
    kind: 'pending', queued: false, stage: 'Animando cena 2 de 5', progress: 0.4,
  });
  assert.equal(interpretJobStatus(200, { status: 'rendering', progress: 7 }).progress, null);
  assert.equal(interpretJobStatus(200, { status: 'completed', downloadUrl: '/api/studio/renders/v.mp4' }).kind, 'completed');
  assert.equal(interpretJobStatus(200, { status: 'cancelled' }).kind, 'cancelled');
  assert.match(interpretJobStatus(200, { status: 'failed', error: { message: 'Blender travou' } }).message ?? '', /falhou.*Blender travou/);
  assert.equal(interpretJobStatus(404, null).reason, 'job_lost');
  assert.equal(interpretJobStatus(401, null).kind, 'locked');
  assert.equal(interpretJobStatus(200, { status: 'weird' }).reason, 'invalid_response');
});

test('engine status: available, unavailable, paid (blocked) and not reported', () => {
  assert.equal(interpretEngineStatus(200, { available: true, engine: 'Blender 4.2' }).state, 'available');
  assert.match(interpretEngineStatus(200, { available: true }).message ?? '', /sem cobrança prevista/);
  const down = interpretEngineStatus(200, { available: false, message: 'Blender não instalado' });
  assert.equal(down.state, 'unavailable');
  assert.match(down.message ?? '', /indisponível: Blender não instalado/);
  assert.equal(interpretEngineStatus(200, { available: true, estimatedCostUsd: 0.5 }).state, 'paid');
  assert.equal(interpretEngineStatus(200, { available: true, costPolicy: 'paid' }).state, 'paid');
  assert.equal(interpretEngineStatus(404, null).state, 'unknown');
  assert.equal(interpretEngineStatus(500, null).state, 'unknown');
  assert.equal(interpretEngineStatus(200, { available: 'yes' }).state, 'unknown');
  assert.equal(interpretEngineStatus(401, null).state, 'locked');
});

test('page is CSP-safe, honest about cost, and every element the script uses exists', () => {
  assert.doesNotThrow(() => new Script(STUDIO_WEB_SCRIPT));
  assert.doesNotMatch(STUDIO_WEB_HTML, /<script(?![^>]*\bsrc=)/);
  assert.doesNotMatch(STUDIO_WEB_HTML, /\sstyle=|\son[a-z]+=/i);
  assert.doesNotMatch(STUDIO_WEB_SCRIPT, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/);
  const ids = [...STUDIO_WEB_SCRIPT.matchAll(/\$\('#([a-z-]+)'\)/g)].map((match) => match[1] ?? '');
  assert.ok(ids.length > 20);
  for (const id of ids) assert.match(STUDIO_WEB_HTML, new RegExp(`id="${id}"`), id);
  for (const endpoint of ['/api/studio/render', '/api/studio/status', '/api/web/session']) assert.ok(STUDIO_WEB_SCRIPT.includes(`'${endpoint}'`), endpoint);
  // Cost: local generation is free today, but never promised as permanent.
  assert.doesNotMatch(STUDIO_WEB_HTML, /sem créditos|grátis para sempre|sempre gratuito/i);
  assert.match(STUDIO_WEB_HTML, /não há cobrança prevista para este plano/);
  assert.match(STUDIO_WEB_HTML, /no futuro.*processamento pago.*aprovação/);
  // Cancel and long-running states exist.
  assert.match(STUDIO_WEB_HTML, /id="studio-cancel"/);
  assert.match(STUDIO_WEB_SCRIPT, /AbortController/);
  assert.match(STUDIO_WEB_SCRIPT, /beforeunload/);
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

test('without the render engine on main, Studio APIs are absent (the page reports it) and session stays closed', async () => {
  const server = await startStudioServer();
  try {
    const anonymous = await fetch(`${server.baseUrl}/api/web/session`, { headers: { cookie: 'sebastian_session=forged' } });
    assert.deepEqual(await anonymous.json(), { authenticated: false });
    for (const [method, path] of [['GET', '/api/studio/status'], ['POST', '/api/studio/render']] as const) {
      const response = await fetch(`${server.baseUrl}${path}`, { method });
      await response.text();
      assert.ok([401, 404, 405].includes(response.status), `${method} ${path} -> ${response.status}`);
      assert.notEqual(interpretRenderResponse(response.status, null).kind, 'completed');
    }
  } finally {
    await server.close();
  }
});
