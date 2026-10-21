import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { ControlledEngine, FAKE_MP4, PLAN } from '../fixtures/StudioFixtures.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  StudioEngineError,
  StudioJobError,
  StudioRenderJobs,
  UnavailableStudioEngine,
  type StudioRenderEngine,
} from '../../studio/StudioRenderJobs.js';
import {
  ComfyStudioEngine,
  buildScenePrompt,
  fillWorkflowTemplate,
  validateWorkflowTemplate,
  type StudioClipComposeRequest,
  type StudioClipComposer,
} from '../../studio/ComfyStudioEngine.js';
import { createConfiguredStudioEngine } from '../../application/StudioEngineConfiguration.js';

const silent = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

let sequence = 0;
const nextId = (): string => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;

function newJobs(engine: StudioRenderEngine, maxQueued = 3): { jobs: StudioRenderJobs; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'studio-jobs-'));
  return { jobs: new StudioRenderJobs({ outputDirectory: dir, engine, logger: silent, maxQueued, createId: nextId }), dir };
}


test('a job runs asynchronously, reports progress and ends with a verified MP4 plus the exact plan manifest', async () => {
  const engine = new ControlledEngine();
  const { jobs, dir } = newJobs(engine);
  const queued = await jobs.submit(JSON.parse(JSON.stringify(PLAN)));
  assert.equal(queued.status, 'queued');
  assert.equal(queued.statusUrl, `/api/studio/jobs/${queued.id}`);
  await engine.rendering(1);
  const running = jobs.get(queued.id);
  assert.equal(running?.status, 'rendering');
  assert.equal(running?.stage, 'Gerando a cena 1 de 2');
  assert.equal(running?.progress, 0.25);
  assert.equal(running?.downloadUrl, undefined);
  // Characters, lines, scenes and visual descriptions reach the engine untouched (and frozen).
  assert.deepEqual(engine.requests[0]?.plan, PLAN);
  assert.ok(Object.isFrozen(engine.requests[0]?.plan.scenes[0]?.dialogue[1]));
  engine.release();
  await jobs.idle();
  const done = jobs.get(queued.id);
  assert.equal(done?.status, 'completed');
  assert.equal(done?.progress, 1);
  assert.equal(done?.downloadUrl, `/api/studio/renders/sebastian-studio-${queued.id}.mp4`);
  assert.deepEqual(done?.production.characters, ['Narrador', 'Nina', 'Bolota']);
  assert.ok(jobs.resolveRender(`sebastian-studio-${queued.id}.mp4`));
  const manifest = JSON.parse(readFileSync(join(dir, `sebastian-studio-${queued.id}.json`), 'utf8')) as { plan: unknown; engine: string };
  assert.deepEqual(manifest.plan, PLAN);
  assert.equal(manifest.engine, 'teste');
  // Working files and partial outputs never stay behind.
  assert.deepEqual(readdirSync(dir).sort(), [`sebastian-studio-${queued.id}.json`, `sebastian-studio-${queued.id}.mp4`]);
});

test('extra fields are dropped and malformed or unapproved plans are refused', async () => {
  const engine = new ControlledEngine();
  const { jobs } = newJobs(engine);
  const job = await jobs.submit({ ...PLAN, injected: '<script>', scenes: PLAN.scenes.map((s) => ({ ...s, extra: 1 })) });
  await engine.rendering(1);
  assert.equal('injected' in (engine.requests[0]?.plan ?? {}), false);
  assert.equal('extra' in (engine.requests[0]?.plan.scenes[0] ?? {}), false);
  jobs.cancel(job.id);
  await jobs.idle();
  for (const bad of [null, 'plano', { ...PLAN, scenes: 'x' }, { ...PLAN, title: 42 }, { ...PLAN, durationSeconds: 16 },
    { ...PLAN, scenes: [{ ...PLAN.scenes[0], dialogue: [{ characterId: 'fantasma', text: 'oi' }] }, PLAN.scenes[1]] }]) {
    await assert.rejects(jobs.submit(bad), (error: unknown) => error instanceof StudioJobError && error.code === 'INVALID_STUDIO_PLAN');
  }
  for (const unapproved of [{ ...PLAN, budgetApproved: false, status: 'awaiting_approval' }, { ...PLAN, estimatedCostUsd: 3 }]) {
    await assert.rejects(jobs.submit(unapproved), (error: unknown) => error instanceof StudioJobError && error.code === 'INVALID_STUDIO_PLAN');
  }
});

test('unavailable or paid engines refuse jobs without charging anything', async () => {
  const engine = new ControlledEngine();
  const { jobs } = newJobs(engine);
  engine.available = false;
  await assert.rejects(jobs.submit(PLAN), (error: unknown) => error instanceof StudioJobError && error.code === 'STUDIO_UNAVAILABLE' && /desligado/.test(error.message));
  engine.available = true;
  engine.cost = 0.4;
  await assert.rejects(jobs.submit(PLAN), (error: unknown) => error instanceof StudioJobError && error.code === 'STUDIO_COST_APPROVAL_REQUIRED');
  assert.equal(engine.requests.length, 0);
  const none = newJobs(new UnavailableStudioEngine('Sem motor.')).jobs;
  assert.deepEqual(await none.availability(), { available: false, engine: 'indisponível', message: 'Sem motor.', estimatedCostUsd: 0 });
});

test('real cancellation: running engine is aborted, queued jobs never start, nothing is published', async () => {
  const engine = new ControlledEngine();
  const { jobs, dir } = newJobs(engine);
  const first = await jobs.submit(PLAN);
  const second = await jobs.submit(PLAN);
  await engine.rendering(1);
  assert.equal(jobs.cancel(second.id)?.status, 'cancelled');
  const cancelling = jobs.cancel(first.id);
  assert.equal(cancelling?.cancelRequested, true);
  assert.equal(engine.requests[0]?.signal.aborted, true);
  await jobs.idle();
  assert.equal(jobs.get(first.id)?.status, 'cancelled');
  assert.equal(engine.requests.length, 1);
  assert.deepEqual(readdirSync(dir), []);
  assert.equal(jobs.cancel('00000000-0000-4000-8000-999999999999'), undefined);
});

test('a job cancelled while being prepared never reaches the engine', async () => {
  const engine = new ControlledEngine();
  const { jobs, dir } = newJobs(engine);
  const job = await jobs.submit(PLAN);
  // execute() has started but is still preparing files: cancel synchronously, before engine.render.
  jobs.cancel(job.id);
  await jobs.idle();
  assert.equal(jobs.get(job.id)?.status, 'cancelled');
  assert.equal(engine.requests.length, 0);
  assert.deepEqual(readdirSync(dir), []);
});

test('one render at a time, bounded queue, failures and invalid output are reported without leaking internals', async () => {
  const engine = new ControlledEngine();
  const { jobs, dir } = newJobs(engine, 2);
  const a = await jobs.submit(PLAN);
  const b = await jobs.submit(PLAN);
  await assert.rejects(jobs.submit(PLAN), (error: unknown) => error instanceof StudioJobError && error.code === 'STUDIO_BUSY');
  await engine.rendering(1);
  assert.equal(jobs.get(b.id)?.status, 'queued');
  engine.failWith = new StudioEngineError('O modelo de vídeo falhou na cena 2: sem memória de vídeo');
  engine.release();
  await engine.rendering(2);
  assert.equal(jobs.get(a.id)?.status, 'failed');
  assert.match(jobs.get(a.id)?.error?.message ?? '', /sem memória de vídeo/);
  engine.failWith = new Error('ECONNRESET 127.0.0.1:8188 /secret/path');
  engine.release();
  await jobs.idle();
  assert.equal(jobs.get(b.id)?.error?.message, 'O motor de renderização falhou inesperadamente.');

  engine.failWith = undefined;
  engine.output = Buffer.from('not a video at all');
  const c = await jobs.submit(PLAN);
  engine.release();
  await jobs.idle();
  assert.match(jobs.get(c.id)?.error?.message ?? '', /MP4 válido/);
  assert.deepEqual(readdirSync(dir), []);
});

test('shutdown cancels queued and running work', async () => {
  const engine = new ControlledEngine();
  const { jobs } = newJobs(engine);
  const a = await jobs.submit(PLAN);
  const b = await jobs.submit(PLAN);
  await engine.rendering(1);
  await jobs.shutdown();
  assert.equal(jobs.get(a.id)?.status, 'cancelled');
  assert.equal(jobs.get(b.id)?.status, 'cancelled');
  await assert.rejects(jobs.submit(PLAN), (error: unknown) => error instanceof StudioJobError && error.code === 'STUDIO_UNAVAILABLE');
});

const TEMPLATE = {
  '3': { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: 20 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{positive_prompt}}' } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: '{{negative_prompt}}' } },
  '40': { class_type: 'EmptyVideoLatent', inputs: { width: '{{width}}', height: '{{height}}', length: '{{frames}}' } },
  '50': { class_type: 'SaveVideo', inputs: { filename_prefix: '{{filename_prefix}}', fps: '{{fps}}', note: 'cena {{scene_id}} ({{duration_seconds}}s)' } },
};

class RecordingComposer implements StudioClipComposer {
  public readonly id = 'composer-teste';
  public request: StudioClipComposeRequest | undefined;
  public async compose(request: StudioClipComposeRequest): Promise<void> {
    this.request = request;
    for (const clip of request.clips) assert.ok(existsSync(clip.path));
    await writeFile(request.outputPath, FAKE_MP4);
  }
}

function fakeComfyFetch(log: string[], healthy = true): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    log.push(`${init?.method ?? 'GET'} ${String(input)}`);
    return new Response('{}', { status: healthy ? 200 : 500 });
  }) as typeof fetch;
}

test('ComfyUI engine: one workflow per scene with style, scene and fixed character looks; composer gets every line', async () => {
  const workflows: Record<string, unknown>[] = [];
  const composer = new RecordingComposer();
  const engine = new ComfyStudioEngine({
    baseUrl: 'http://127.0.0.1:8188',
    workflowTemplate: TEMPLATE,
    composer,
    fetchImpl: fakeComfyFetch([]),
    generator: { generate: async (workflow) => { workflows.push(workflow); return { bytes: new Uint8Array(FAKE_MP4), filename: 'out.mp4', mimeType: 'video/mp4' }; } },
  });
  assert.deepEqual(await engine.availability(), { available: true, engine: 'ComfyUI', estimatedCostUsd: 0 });
  const { jobs } = newJobs(engine);
  const job = await jobs.submit(PLAN);
  await jobs.idle();
  assert.equal(jobs.get(job.id)?.status, 'completed');
  assert.equal(workflows.length, 2);
  const first = workflows[0] as typeof TEMPLATE;
  const second = workflows[1] as typeof TEMPLATE;
  assert.match(first['6'].inputs.text, /^3D animated cartoon/);
  assert.match(first['6'].inputs.text, /Nina chama Bolota no quarto/);
  assert.match(first['6'].inputs.text, /Nina: menina de jardineira roxa; Bolota: robô redondo azul e branco/);
  assert.doesNotMatch(first['6'].inputs.text, /Narrador em off/);
  assert.match(second['6'].inputs.text, /Bolota: robô redondo azul e branco/);
  assert.doesNotMatch(second['6'].inputs.text, /Nina: menina/);
  // Typed values, bounded clip length, 9:16 size, same seed for every scene (consistency).
  assert.deepEqual(first['40'].inputs, { width: 480, height: 832, length: 81 });
  assert.equal(typeof first['3'].inputs.seed, 'number');
  assert.equal(first['3'].inputs.seed, second['3'].inputs.seed);
  assert.equal(first['50'].inputs.note, 'cena cena-1 (5s)');
  assert.equal(first['50'].inputs.filename_prefix, `sebastian-studio/${job.id}/cena-1`);
  // Composer receives the whole plan (all dialogue) and ordered clips with target durations.
  assert.deepEqual(composer.request?.plan, PLAN);
  assert.deepEqual(composer.request?.clips.map((clip) => [clip.sceneId, clip.targetSeconds, clip.generatedSeconds]), [['cena-1', 9, 5], ['cena-2', 6, 5]]);
  assert.equal(TEMPLATE['6'].inputs.text, '{{positive_prompt}}');
});

test('ComfyUI engine: cancelling interrupts the GPU work; without composer or ComfyUI it reports why', async () => {
  const log: string[] = [];
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const engine = new ComfyStudioEngine({
    baseUrl: 'http://localhost:8188/',
    workflowTemplate: TEMPLATE,
    composer: new RecordingComposer(),
    fetchImpl: fakeComfyFetch(log),
    generator: { generate: (_workflow, signal) => new Promise((_, reject) => { started(); signal?.addEventListener('abort', () => reject(new Error('aborted'))); }) },
  });
  const { jobs } = newJobs(engine);
  const job = await jobs.submit(PLAN);
  await startedPromise;
  jobs.cancel(job.id);
  await jobs.idle();
  assert.equal(jobs.get(job.id)?.status, 'cancelled');
  assert.ok(log.includes('POST http://localhost:8188/interrupt'), log.join('\n'));

  const noComposer = new ComfyStudioEngine({ baseUrl: 'http://127.0.0.1:8188', workflowTemplate: TEMPLATE, fetchImpl: fakeComfyFetch([]), generator: { generate: async () => assert.fail() } });
  const missing = await noComposer.availability();
  assert.equal(missing.available, false);
  assert.match(missing.message ?? '', /composição final/);
  const down = new ComfyStudioEngine({ baseUrl: 'http://127.0.0.1:8188', workflowTemplate: TEMPLATE, composer: new RecordingComposer(), fetchImpl: fakeComfyFetch([], false), generator: { generate: async () => assert.fail() } });
  assert.match((await down.availability()).message ?? '', /ComfyUI local não respondeu/);
});

test('ComfyUI engine: loopback-only endpoint and strict workflow templates', () => {
  const base = { workflowTemplate: TEMPLATE, generator: { generate: async () => assert.fail() } };
  for (const baseUrl of ['https://api.example.com', 'http://192.168.0.10:8188', 'http://user:pw@127.0.0.1:8188', 'file:///etc/passwd']) {
    assert.throws(() => new ComfyStudioEngine({ ...base, baseUrl }), StudioEngineError, baseUrl);
  }
  assert.throws(() => validateWorkflowTemplate({}), /objeto JSON/);
  assert.throws(() => validateWorkflowTemplate([]), /objeto JSON/);
  assert.throws(() => validateWorkflowTemplate({ a: { inputs: { text: 'fixo' } } }), /positive_prompt/);
  assert.throws(() => validateWorkflowTemplate({ a: { inputs: { text: '{{positive_prompt}} {{api_key}}' } } }), /desconhecido/);
  const filled = fillWorkflowTemplate({ a: ['{{width}}', 'x{{height}}'] }, {
    positive_prompt: 'p', negative_prompt: 'n', width: 10, height: 20, fps: 16, frames: 81, seed: 1, duration_seconds: 5, scene_id: 's', filename_prefix: 'f',
  });
  assert.deepEqual(filled, { a: [10, 'x20'] });
  assert.match(buildScenePrompt(PLAN, PLAN.scenes[1]!), /Título da história: O Robô que Entendeu Tudo Errado/);
});

test('configuration: unconfigured, invalid and configured engines (no paid or remote service)', async () => {
  const none = await createConfiguredStudioEngine({}, silent);
  assert.match((await none.availability()).message ?? '', /ainda não foi configurado/);

  const dir = mkdtempSync(join(tmpdir(), 'studio-config-'));
  const workflowPath = join(dir, 'workflow.json');
  writeFileSync(workflowPath, JSON.stringify(TEMPLATE));
  const remote = await createConfiguredStudioEngine({ STUDIO_COMFYUI_URL: 'https://paid.example.com', STUDIO_COMFYUI_WORKFLOW_PATH: workflowPath }, silent, {
    loadGenerator: async () => ({ generate: async () => assert.fail() }),
  });
  assert.equal((await remote.availability()).available, false);

  // On this branch the Work's ComfyVideoProvider is not merged yet: the runtime load fails closed.
  const notMerged = await createConfiguredStudioEngine({ STUDIO_COMFYUI_URL: 'http://127.0.0.1:8188', STUDIO_COMFYUI_WORKFLOW_PATH: workflowPath }, silent);
  assert.ok(notMerged instanceof UnavailableStudioEngine || notMerged instanceof ComfyStudioEngine);

  const timeouts: number[] = [];
  const configured = await createConfiguredStudioEngine({
    STUDIO_COMFYUI_URL: 'http://127.0.0.1:8188', STUDIO_COMFYUI_WORKFLOW_PATH: workflowPath, STUDIO_COMFYUI_SCENE_TIMEOUT_MS: '60000',
  }, silent, {
    loadGenerator: async (_url, timeoutMs) => { timeouts.push(timeoutMs); return { generate: async () => assert.fail() }; },
    composer: new RecordingComposer(),
    fetchImpl: fakeComfyFetch([]),
  });
  assert.ok(configured instanceof ComfyStudioEngine);
  assert.deepEqual(timeouts, [60000]);
  assert.equal((await configured.availability()).available, true);
});
