import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { ConversationRegistry, FileCommandContextHydrator, FileMemoryStore } from '../../core/memory/index.js';
import { SebastianHttpServer } from '../../application/SebastianHttpServer.js';
import { STUDIO_PLAN_BUILDER_SOURCE, STUDIO_RENDER_PROTOCOL_SOURCE } from '../../application/StudioWebInterface.js';
import { RemoteStudioEngine, type RemoteStudioEngineOptions } from '../../studio/RemoteStudioEngine.js';
import { StudioGpuWorker } from '../../studio/StudioGpuWorker.js';
import { StudioRenderJobs, type StudioRenderEngine } from '../../studio/StudioRenderJobs.js';
import type { StudioProductionPlan } from '../../studio/VideoProductionPlan.js';
import { ControlledEngine, FAKE_MP4 } from '../fixtures/StudioFixtures.js';

const USER_TOKEN = 'studio-remote-user-access-key';
const WORKER_TOKEN = 'worker-token-0123456789abcdef0123456789abcdef';
const silent = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

interface Outcome { readonly kind?: string; readonly reason?: string; readonly state?: string; readonly statusUrl?: string; readonly downloadUrl?: string; readonly stage?: string }

const ui = (() => {
  const context = createContext({});
  runInContext(STUDIO_PLAN_BUILDER_SOURCE, context);
  runInContext(STUDIO_RENDER_PROTOCOL_SOURCE, context);
  const call = <T>(name: string, ...args: unknown[]): T => JSON.parse(JSON.stringify((context[name] as (...a: unknown[]) => unknown)(...args))) as T;
  return {
    plan: () => call<StudioProductionPlan>('buildStudioPlan', {
      title: 'O Robô que Entendeu Tudo Errado',
      story: 'Nina pediu ao robô Bolota para arrumar o quarto.\nNina: Bolota, guarde tudo!\n\nBolota: Missão cumprida!',
      characters: 'Nina: menina de 8 anos, jardineira roxa\nBolota: robô redondo azul e branco',
      style: '3d_cartoon', format: '9:16', durationSeconds: 15,
    }),
    render: (status: number, body: unknown) => call<Outcome>('interpretRenderResponse', status, body),
    job: (status: number, body: unknown) => call<Outcome>('interpretJobStatus', status, body),
    engine: (status: number, body: unknown) => call<Outcome>('interpretEngineStatus', status, body),
  };
})();

interface Harness {
  readonly base: string;
  readonly jobs: StudioRenderJobs;
  readonly remote: RemoteStudioEngine;
  readonly close: () => Promise<void>;
  user(path: string, init?: RequestInit): Promise<Response>;
  worker(path: string, init?: RequestInit, token?: string): Promise<Response>;
}

async function start(options: Partial<RemoteStudioEngineOptions> = {}, engine?: StudioRenderEngine): Promise<Harness> {
  const remote = new RemoteStudioEngine({ workerToken: WORKER_TOKEN, claimWaitMs: 300, ...options });
  const store = new FileMemoryStore(join(mkdtempSync(join(tmpdir(), 'studio-remote-')), 'memory.json'));
  const jobs = new StudioRenderJobs({ outputDirectory: mkdtempSync(join(tmpdir(), 'studio-remote-renders-')), engine: engine ?? remote, logger: silent });
  const server = new SebastianHttpServer({
    application: { executeCommand: async () => ({ status: 'succeeded', commandId: 'c', data: {} }) as never, shutdown: () => undefined },
    apiToken: USER_TOKEN,
    conversationRegistry: new ConversationRegistry(store, new FileCommandContextHydrator(store)),
    logger: silent,
    requestId: () => 'request-test-id',
    studioJobs: jobs,
  });
  const started = await server.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${started.port}`;
  const session = await fetch(`${base}/api/web/session`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: USER_TOKEN }) });
  const cookie = (session.headers.get('set-cookie') ?? '').split(';', 1)[0] ?? '';
  return {
    base, jobs, remote,
    close: async () => { await started.close(); remote.dispose(); },
    user: (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { Cookie: cookie, Origin: base, ...(init.headers as Record<string, string> | undefined) } }),
    worker: (path, init = {}, token = WORKER_TOKEN) => fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) } }),
  };
}

const submit = (h: Harness, plan: StudioProductionPlan): Promise<Response> =>
  h.user('/api/studio/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) });

const claimBody = (status: Record<string, unknown> = { available: true, engine: 'ComfyUI', estimatedCostUsd: 0 }): RequestInit =>
  ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(status) });

function newWorker(h: Harness, local: StudioRenderEngine): { worker: StudioGpuWorker; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'studio-gpu-'));
  return { worker: new StudioGpuWorker({ serverUrl: h.base, workerToken: WORKER_TOKEN, engine: local, workDirectory: dir, logger: silent, progressIntervalMs: 30 }), dir };
}

async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('remote GPU: the page plan travels to the worker, progress comes back, the MP4 is uploaded, verified and streamed', async () => {
  const h = await start();
  const local = new ControlledEngine();
  const { worker, dir } = newWorker(h, local);
  try {
    const before = await h.user('/api/studio/status');
    const offline = ui.engine(before.status, await before.json());
    assert.equal(offline.state, 'unavailable');
    const refused = await submit(h, ui.plan());
    assert.equal(ui.render(refused.status, await refused.json()).reason, 'engine_unavailable');

    // The worker connects (outbound long poll) and the engine becomes available.
    const cycle = worker.runOnce();
    await until(async () => (await (await h.user('/api/studio/status')).json() as { available?: boolean }).available === true, 'worker heartbeat');
    const plan = ui.plan();
    const accepted = ui.render(202, await (await submit(h, plan)).json());
    await local.rendering(1);
    // Every character, line, scene and visual description reaches the GPU machine untouched.
    assert.deepEqual(local.requests[0]?.plan, plan);

    await until(async () => (await (await h.user(accepted.statusUrl ?? '')).json() as { stage?: string }).stage === 'Gerando a cena 1 de 2', 'worker progress');
    local.release();
    assert.equal(await cycle, 'completed');
    await h.jobs.idle();
    const finished = await h.user(accepted.statusUrl ?? '');
    const done = ui.job(finished.status, await finished.json());
    assert.equal(done.kind, 'completed');
    const video = await h.user(done.downloadUrl ?? '', { headers: { Range: 'bytes=0-15' } });
    assert.equal(video.status, 206);
    assert.deepEqual(Buffer.from(await video.arrayBuffer()), FAKE_MP4.subarray(0, 16));
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    await h.close();
  }
});

test('remote GPU: cancelling in the page stops the worker and its upload is refused', async () => {
  const h = await start();
  const local = new ControlledEngine();
  const { worker, dir } = newWorker(h, local);
  try {
    const cycle = worker.runOnce();
    await until(() => h.remote.availability().then((a) => a.available), 'worker heartbeat');
    const accepted = ui.render(202, await (await submit(h, ui.plan())).json());
    await local.rendering(1);
    const cancel = await h.user(accepted.statusUrl ?? '', { method: 'DELETE' });
    assert.ok(cancel.ok);
    await cancel.arrayBuffer();
    assert.equal(await cycle, 'cancelled');
    assert.equal(local.requests[0]?.signal.aborted, true);
    await h.jobs.idle();
    const after = await h.user(accepted.statusUrl ?? '');
    assert.equal(ui.job(after.status, await after.json()).kind, 'cancelled');
    const lateUpload = await h.worker(`/api/studio/worker/jobs/${String(accepted.statusUrl).split('/').pop()}/result`, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: FAKE_MP4 });
    assert.equal(lateUpload.status, 409);
    await lateUpload.arrayBuffer();
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    await h.close();
  }
});

test('remote GPU security: worker token and user session are separate; nothing works without them', async () => {
  const h = await start();
  try {
    for (const [path, init] of [['/api/studio/worker/claim', claimBody()], ['/api/studio/worker/jobs/00000000-0000-4000-8000-000000000001/progress', claimBody()]] as const) {
      for (const token of ['', 'wrong-token-wrong-token-wrong-token-wrong']) {
        const response = await h.worker(path, init, token);
        assert.equal(response.status, 401, `${path} token=${token}`);
        await response.arrayBuffer();
      }
      // A browser session (cookie + same origin) never opens worker routes.
      const asUser = await h.user(path, init);
      assert.equal(asUser.status, 401);
      await asUser.arrayBuffer();
    }
    // The worker token never opens user routes.
    for (const path of ['/api/studio/status', '/api/studio/render']) {
      const asWorker = await h.worker(path, path.endsWith('render') ? claimBody() : {});
      assert.equal(asWorker.status, 401, path);
      await asWorker.arrayBuffer();
    }
    const unknownUpload = await h.worker('/api/studio/worker/jobs/00000000-0000-4000-8000-000000000001/result', { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: FAKE_MP4 });
    assert.equal(unknownUpload.status, 404);
    await unknownUpload.arrayBuffer();
    const badStatus = await h.worker('/api/studio/worker/claim', claimBody({ available: 'yes' }));
    assert.equal(badStatus.status, 400);
    await badStatus.arrayBuffer();
    assert.throws(() => new StudioGpuWorker({ serverUrl: 'http://sebastian.example.com', workerToken: WORKER_TOKEN, engine: new ControlledEngine(), workDirectory: tmpdir() }), /HTTPS/);
    assert.throws(() => new RemoteStudioEngine({ workerToken: 'short' }), /32 caracteres/);
  } finally {
    await h.close();
  }

  // Without a remote engine the worker routes do not exist at all.
  const local = await start({}, new ControlledEngine());
  try {
    const response = await local.worker('/api/studio/worker/claim', claimBody());
    assert.equal(response.status, 404);
    await response.arrayBuffer();
  } finally {
    await local.close();
  }
});

test('remote GPU: a worker announcing a cost blocks generation (no unapproved charges)', async () => {
  const h = await start();
  try {
    const claim = await h.worker('/api/studio/worker/claim', claimBody({ available: true, engine: 'GPU alugada', estimatedCostUsd: 0.75 }));
    assert.equal(claim.status, 204);
    const status = await h.user('/api/studio/status');
    assert.equal(ui.engine(status.status, await status.json()).state, 'paid');
    const refused = await submit(h, ui.plan());
    assert.equal(refused.status, 402);
    assert.equal(ui.render(refused.status, await refused.json()).reason, 'cost_approval');
  } finally {
    await h.close();
  }
});

test('remote GPU: silent worker loses the lease; oversized, wrong-type and non-mobile uploads are refused', async () => {
  let now = 1_000_000;
  const h = await start({ leaseTimeoutMs: 60_000, maxResultBytes: 4096, now: () => now });
  try {
    await (await h.worker('/api/studio/worker/claim', claimBody())).arrayBuffer();
    const silentJob = ui.render(202, await (await submit(h, ui.plan())).json());
    const claimed = await (await h.worker('/api/studio/worker/claim', claimBody())).json() as { job: { id: string; plan: StudioProductionPlan } };
    assert.equal(`/api/studio/jobs/${claimed.job.id}`, silentJob.statusUrl);
    now += 61_000;
    h.remote.checkLeases();
    await h.jobs.idle();
    const lost = await h.user(silentJob.statusUrl ?? '');
    const lostBody = await lost.json() as { error?: { message?: string } };
    assert.match(lostBody.error?.message ?? '', /parou de responder/);

    await (await h.worker('/api/studio/worker/claim', claimBody())).arrayBuffer();
    const second = ui.render(202, await (await submit(h, ui.plan())).json());
    const job = (await (await h.worker('/api/studio/worker/claim', claimBody())).json() as { job: { id: string } }).job.id;
    const result = `/api/studio/worker/jobs/${job}/result`;
    const wrongType = await h.worker(result, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
    assert.equal(wrongType.status, 415);
    await wrongType.arrayBuffer();
    const tooLarge = await h.worker(result, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: Buffer.alloc(5000) });
    assert.equal(tooLarge.status, 413);
    await tooLarge.arrayBuffer();
    // A buggy worker uploading an MP4 without audio: the server's own check refuses it.
    const mute = Buffer.from(FAKE_MP4);
    mute.write('mp4b', mute.indexOf('mp4a'), 'latin1');
    const upload = await h.worker(result, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: mute });
    assert.equal(upload.status, 204);
    await h.jobs.idle();
    const refused = await h.user(second.statusUrl ?? '');
    const refusedBody = await refused.json() as { status?: string; error?: { message?: string } };
    assert.equal(refusedBody.status, 'failed');
    assert.match(refusedBody.error?.message ?? '', /navegadores móveis: áudio em mp4b, não AAC/);
  } finally {
    await h.close();
  }
});

test('remote GPU: a job waiting while the worker is disconnected fails clearly', async () => {
  let now = 5_000_000;
  const h = await start({ heartbeatTimeoutMs: 30_000, now: () => now });
  try {
    await (await h.worker('/api/studio/worker/claim', claimBody())).arrayBuffer();
    const waiting = ui.render(202, await (await submit(h, ui.plan())).json());
    const id = String(waiting.statusUrl).split('/').pop() ?? '';
    await until(() => h.jobs.get(id)?.stage === 'Aguardando o processador de GPU', 'job parked for the worker');
    now += 31_000;
    h.remote.checkLeases();
    await h.jobs.idle();
    const after = await h.user(waiting.statusUrl ?? '');
    assert.match((await after.json() as { error?: { message?: string } }).error?.message ?? '', /desconectado/);
  } finally {
    await h.close();
  }
});
