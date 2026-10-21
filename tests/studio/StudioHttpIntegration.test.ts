import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { ConversationRegistry, FileCommandContextHydrator, FileMemoryStore } from '../../core/memory/index.js';
import { SebastianHttpServer } from '../../application/SebastianHttpServer.js';
import { STUDIO_PLAN_BUILDER_SOURCE, STUDIO_RENDER_PROTOCOL_SOURCE } from '../../application/StudioWebInterface.js';
import { StudioRenderJobs, UnavailableStudioEngine, type StudioRenderEngine } from '../../studio/StudioRenderJobs.js';
import type { StudioProductionPlan } from '../../studio/VideoProductionPlan.js';
import { ControlledEngine, FAKE_MP4 } from '../fixtures/StudioFixtures.js';

const TOKEN = 'studio-integration-test-token';
const silent = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

interface Outcome { readonly kind?: string; readonly reason?: string; readonly state?: string; readonly statusUrl?: string; readonly downloadUrl?: string; readonly stage?: string; readonly progress?: number | null }

/** The exact browser code of the Studio page (plan builder + response interpretation). */
const ui = (() => {
  const context = createContext({});
  runInContext(STUDIO_PLAN_BUILDER_SOURCE, context);
  runInContext(STUDIO_RENDER_PROTOCOL_SOURCE, context);
  const call = <T>(name: string, ...args: unknown[]): T => JSON.parse(JSON.stringify((context[name] as (...a: unknown[]) => unknown)(...args))) as T;
  return {
    buildPlan: (input: Record<string, unknown>) => call<StudioProductionPlan>('buildStudioPlan', input),
    render: (status: number, body: unknown) => call<Outcome>('interpretRenderResponse', status, body),
    job: (status: number, body: unknown) => call<Outcome>('interpretJobStatus', status, body),
    engine: (status: number, body: unknown) => call<Outcome>('interpretEngineStatus', status, body),
  };
})();

const STORY = {
  title: 'O Robô que Entendeu Tudo Errado',
  story: 'Nina pediu ao robô Bolota para arrumar o quarto.\nNina: Bolota, guarde tudo!\n\nBolota: Missão cumprida!\n\nNo fim, os dois riram.',
  characters: 'Nina: menina de 8 anos, jardineira roxa\nBolota: robô redondo azul e branco',
  style: '3d_cartoon',
  format: '9:16',
  durationSeconds: 30,
};

interface Harness {
  readonly base: string;
  readonly cookie: string;
  readonly jobs: StudioRenderJobs;
  readonly close: () => Promise<void>;
  api(path: string, init?: RequestInit & { readonly origin?: string | null; readonly auth?: boolean }): Promise<Response>;
}

async function start(engine: StudioRenderEngine, maxQueued = 3): Promise<Harness> {
  const store = new FileMemoryStore(join(mkdtempSync(join(tmpdir(), 'studio-http-')), 'memory.json'));
  const jobs = new StudioRenderJobs({ outputDirectory: mkdtempSync(join(tmpdir(), 'studio-renders-')), engine, logger: silent, maxQueued });
  const server = new SebastianHttpServer({
    application: { executeCommand: async () => ({ status: 'succeeded', commandId: 'c', data: {} }) as never, shutdown: () => undefined },
    apiToken: TOKEN,
    conversationRegistry: new ConversationRegistry(store, new FileCommandContextHydrator(store)),
    logger: silent,
    requestId: () => 'request-test-id',
    studioJobs: jobs,
  });
  const started = await server.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${started.port}`;
  const session = await fetch(`${base}/api/web/session`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: TOKEN, remember: false }),
  });
  assert.equal(session.status, 201);
  const cookie = (session.headers.get('set-cookie') ?? '').split(';', 1)[0] ?? '';
  return {
    base, cookie, jobs, close: started.close,
    api: (path, init = {}) => {
      const headers = new Headers(init.headers);
      if (init.auth !== false) headers.set('Cookie', cookie);
      const origin = init.origin === undefined ? base : init.origin;
      if (origin !== null) headers.set('Origin', origin);
      return fetch(`${base}${path}`, { ...init, headers });
    },
  };
}

const postPlan = (h: Harness, plan: unknown, extra: { readonly origin?: string | null; readonly auth?: boolean } = {}): Promise<Response> =>
  h.api('/api/studio/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }), ...extra });

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

test('end to end: the Studio page plan becomes an async job, is polled, and the MP4 streams with Range', async () => {
  const engine = new ControlledEngine();
  const h = await start(engine);
  try {
    const status = await h.api('/api/studio/status');
    assert.equal(ui.engine(status.status, await json(status)).state, 'available');

    const plan = ui.buildPlan(STORY);
    const accepted = await postPlan(h, plan);
    assert.equal(accepted.status, 202);
    const acceptedBody = await json(accepted);
    const pending = ui.render(accepted.status, acceptedBody);
    assert.equal(pending.kind, 'pending');
    assert.equal(accepted.headers.get('location'), pending.statusUrl);
    await engine.rendering(1);
    // Characters, lines, scenes and visual descriptions reach the engine exactly as the page built them.
    assert.deepEqual(engine.requests[0]?.plan, plan);
    assert.deepEqual(engine.requests[0]?.plan.scenes[0]?.dialogue, [
      { characterId: 'narrador', text: 'Nina pediu ao robô Bolota para arrumar o quarto.' },
      { characterId: 'nina', text: 'Bolota, guarde tudo!' },
    ]);

    const polled = await h.api(pending.statusUrl ?? '');
    const progress = ui.job(polled.status, await json(polled));
    assert.deepEqual([progress.kind, progress.stage, progress.progress], ['pending', 'Gerando a cena 1 de 2', 0.25]);

    engine.release();
    await h.jobs.idle();
    const finished = await h.api(pending.statusUrl ?? '');
    const done = ui.job(finished.status, await json(finished));
    assert.equal(done.kind, 'completed');
    const url = done.downloadUrl ?? '';

    const full = await h.api(url, { origin: null });
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'video/mp4');
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(full.headers.get('content-length'), String(FAKE_MP4.length));
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), FAKE_MP4);

    const cases: readonly [string, number, string, Buffer][] = [
      ['bytes=0-99', 206, `bytes 0-99/${FAKE_MP4.length}`, FAKE_MP4.subarray(0, 100)],
      ['bytes=1000-', 206, `bytes 1000-${FAKE_MP4.length - 1}/${FAKE_MP4.length}`, FAKE_MP4.subarray(1000)],
      ['bytes=-24', 206, `bytes ${FAKE_MP4.length - 24}-${FAKE_MP4.length - 1}/${FAKE_MP4.length}`, FAKE_MP4.subarray(-24)],
      ['bytes=10-999999', 206, `bytes 10-${FAKE_MP4.length - 1}/${FAKE_MP4.length}`, FAKE_MP4.subarray(10)],
    ];
    for (const [range, code, contentRange, bytes] of cases) {
      const partial = await h.api(url, { origin: null, headers: { Range: range } });
      assert.equal(partial.status, code, range);
      assert.equal(partial.headers.get('content-range'), contentRange, range);
      assert.equal(partial.headers.get('content-length'), String(bytes.length), range);
      assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes, range);
    }
    for (const range of ['bytes=5000-', 'bytes=-0', 'bytes=50-10']) {
      const unsatisfiable = await h.api(url, { origin: null, headers: { Range: range } });
      assert.equal(unsatisfiable.status, 416, range);
      assert.equal(unsatisfiable.headers.get('content-range'), `bytes */${FAKE_MP4.length}`);
      await unsatisfiable.arrayBuffer();
    }
    const multi = await h.api(url, { origin: null, headers: { Range: 'bytes=0-1,5-6' } });
    assert.equal(multi.status, 200);
    await multi.arrayBuffer();
    const head = await h.api(url, { method: 'HEAD', origin: null, headers: { Range: 'bytes=0-9' } });
    assert.equal(head.status, 206);
    assert.equal(head.headers.get('content-length'), '10');
  } finally {
    await h.close();
  }
});

test('security: every Studio route requires a valid session; changes require same origin', async () => {
  const engine = new ControlledEngine();
  const h = await start(engine);
  try {
    const plan = ui.buildPlan(STORY);
    const routes: readonly [string, string][] = [
      ['GET', '/api/studio/status'], ['POST', '/api/studio/render'], ['GET', '/api/studio/jobs/00000000-0000-4000-8000-000000000001'],
      ['DELETE', '/api/studio/jobs/00000000-0000-4000-8000-000000000001'], ['GET', '/api/studio/renders/sebastian-studio-00000000-0000-4000-8000-000000000001.mp4'],
      ['GET', '/api/studio/anything'],
    ];
    for (const [method, path] of routes) {
      for (const headers of [{}, { Cookie: 'sebastian_session=v1.9999999999999.forged.sig' }]) {
        const response = await h.api(path, { method, auth: false, headers });
        assert.equal(response.status, 401, `${method} ${path}`);
        await response.arrayBuffer();
      }
    }
    for (const origin of [null, 'https://evil.example']) {
      const forged = await postPlan(h, plan, { origin });
      assert.equal(forged.status, 403);
      await forged.arrayBuffer();
    }
    assert.equal(engine.requests.length, 0);

    const accepted = await json(await postPlan(h, plan));
    const crossCancel = await h.api(String(accepted.statusUrl), { method: 'DELETE', origin: 'https://evil.example' });
    assert.equal(crossCancel.status, 403);
    await crossCancel.arrayBuffer();
    await engine.rendering(1);
    assert.equal(engine.requests[0]?.signal.aborted, false);

    // Only exact generated file names are served; no traversal, no other files (e.g. the plan manifest).
    for (const path of ['/api/studio/renders/..%2F..%2Fweb-session.json', '/api/studio/renders/../../etc/passwd', `/api/studio/renders/sebastian-studio-${String(accepted.id)}.json`, '/api/studio/renders/x.mp4']) {
      const response = await h.api(path, { origin: null });
      assert.ok([404].includes(response.status), `${path} -> ${response.status}`);
      await response.arrayBuffer();
    }
    const wrongType = await h.api('/api/studio/render', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(wrongType.status, 415);
    await wrongType.arrayBuffer();
    const wrongMethod = await h.api('/api/studio/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(wrongMethod.status, 405);
    await wrongMethod.arrayBuffer();
    const oversized = await h.api('/api/studio/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, pad: 'x'.repeat(20_000) }) });
    assert.equal(oversized.status, 413);
    await oversized.arrayBuffer();
    engine.release();
  } finally {
    await h.close();
  }
});

test('real cancellation through the page flow: DELETE aborts the engine and the job reports cancelled', async () => {
  const engine = new ControlledEngine();
  const h = await start(engine);
  try {
    const accepted = ui.render(202, await json(await postPlan(h, ui.buildPlan(STORY))));
    await engine.rendering(1);
    const cancel = await h.api(accepted.statusUrl ?? '', { method: 'DELETE' });
    assert.ok(cancel.ok);
    assert.equal((await json(cancel)).cancelRequested, true);
    assert.equal(engine.requests[0]?.signal.aborted, true);
    await h.jobs.idle();
    const after = await h.api(accepted.statusUrl ?? '');
    assert.equal(ui.job(after.status, await json(after)).kind, 'cancelled');

    // A job still waiting in the queue is cancelled for good: the engine never sees it.
    const running = ui.render(202, await json(await postPlan(h, ui.buildPlan(STORY))));
    await engine.rendering(2);
    const queued = ui.render(202, await json(await postPlan(h, ui.buildPlan(STORY))));
    const dropped = await h.api(queued.statusUrl ?? '', { method: 'DELETE' });
    assert.equal((await json(dropped)).status, 'cancelled');
    engine.release();
    await h.jobs.idle();
    const runningAfter = await h.api(running.statusUrl ?? '');
    assert.equal(ui.job(runningAfter.status, await json(runningAfter)).kind, 'completed');
    assert.equal(engine.requests.length, 2);
  } finally {
    await h.close();
  }
});

test('failures reach the page as clear outcomes: unavailable, paid, invalid, busy, lost job, engine error', async () => {
  const unavailable = await start(new UnavailableStudioEngine('O motor generativo de vídeo ainda não foi configurado neste servidor.'));
  try {
    const status = await unavailable.api('/api/studio/status');
    const engineState = ui.engine(status.status, await json(status));
    assert.equal(engineState.state, 'unavailable');
    const refused = await postPlan(unavailable, ui.buildPlan(STORY));
    assert.equal(refused.status, 503);
    assert.equal(ui.render(refused.status, await json(refused)).reason, 'engine_unavailable');
  } finally {
    await unavailable.close();
  }

  const engine = new ControlledEngine();
  const h = await start(engine, 1);
  try {
    engine.cost = 1.5;
    const paidStatus = await h.api('/api/studio/status');
    assert.equal(ui.engine(paidStatus.status, await json(paidStatus)).state, 'paid');
    const paid = await postPlan(h, ui.buildPlan(STORY));
    assert.equal(paid.status, 402);
    assert.equal(ui.render(paid.status, await json(paid)).reason, 'cost_approval');
    engine.cost = 0;

    const invalid = await postPlan(h, { ...ui.buildPlan(STORY), durationSeconds: 31 });
    assert.equal(invalid.status, 400);
    assert.equal(ui.render(invalid.status, await json(invalid)).reason, 'invalid_plan');

    const first = ui.render(202, await json(await postPlan(h, ui.buildPlan(STORY))));
    const busy = await postPlan(h, ui.buildPlan(STORY));
    assert.equal(busy.status, 429);
    assert.equal(ui.render(busy.status, await json(busy)).reason, 'busy');

    engine.failWith = new Error('stack trace with /internal/paths');
    engine.release();
    await h.jobs.idle();
    const failed = await h.api(first.statusUrl ?? '');
    const failedBody = await json(failed);
    assert.equal(ui.job(failed.status, failedBody).reason, 'render_failed');
    assert.doesNotMatch(JSON.stringify(failedBody), /internal\/paths/);

    const lost = await h.api('/api/studio/jobs/00000000-0000-4000-8000-00000000dead');
    assert.equal(ui.job(lost.status, await json(lost)).reason, 'job_lost');
  } finally {
    await h.close();
  }
});

test('closing the server cancels running renders', async () => {
  const engine = new ControlledEngine();
  const h = await start(engine);
  const accepted = await json(await postPlan(h, ui.buildPlan(STORY)));
  await engine.rendering(1);
  await h.close();
  assert.equal(engine.requests[0]?.signal.aborted, true);
  assert.equal(h.jobs.get(String(accepted.id))?.status, 'cancelled');
});
