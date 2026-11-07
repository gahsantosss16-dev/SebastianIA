import { invokeVideoStoryboard } from '../../application/VideoStudioCapabilityProvider.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVideoPlan } from '../../video-studio/storyboard.js';
import { createSebastianApplication } from '../../application/SebastianApplication.js';
import { VideoStudioService } from '../../studio/VideoStudioService.js';
import { SebastianHttpServer } from '../../application/SebastianHttpServer.js';
import { ConversationRegistry, FileCommandContextHydrator, FileMemoryStore } from '../../core/memory/index.js';

const temp = () => mkdtempSync(join(tmpdir(), 'video-studio-'));
test('storyboard has actual Portuguese dialogue, integral durations and zero external cost', () => {
  const plan = createVideoPlan('Um robô atrapalhado', 31);
  assert.equal(plan.scenes.reduce((n, s) => n + s.durationSeconds, 0), 31);
  assert.equal(plan.estimatedCostUsd, 0);
  assert.ok(plan.scenes[0]!.narration.includes('Um robô atrapalhado'));
  for (const idea of ['', null, 45, 'a'.repeat(241), 'a\nb']) assert.throws(() => createVideoPlan(idea));
  for (const duration of [NaN, 15.5, 0, 61, '30']) assert.throws(() => createVideoPlan('teste', duration));
});
test('registered storyboard capability works alongside the personal memory pipeline', async () => {
  const dataDir = temp();
  const app = createSebastianApplication({ dataDir });
  try {
    const plan = invokeVideoStoryboard({ idea: 'Café para a planta' });
    assert.equal(plan.estimatedCostUsd, 0);
    const remember = await app.executeCommand({ type: 'remember', input: { text: 'Meu nome é Gabriel' }, generatedAt: new Date().toISOString() });
    assert.equal(remember.status, 'succeeded');
    const recall = await app.executeCommand({ type: 'recall', input: {}, generatedAt: new Date().toISOString() });
    assert.match(JSON.stringify(recall.output), /Gabriel/);
  } finally { app.shutdown(); rmSync(dataDir, { recursive: true, force: true }); }
});
test('approval, idempotency, serialized queue, progress and restart recovery', async () => {
  const root = temp(); let calls = 0; let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const service = new VideoStudioService(root, { render: async (_p, _d, progress) => { calls++; progress(2); await gate; } });
  try {
    const a = service.create({ idea: 'Teste' });
    assert.throws(() => service.approve(a.id, false));
    assert.throws(() => service.artifact(a.id, 'video.mp4'));
    service.approve(a.id, true); service.approve(a.id, true);
    const b = service.create({ idea: 'Outro' }); service.approve(b.id, true);
    assert.equal(calls, 1); assert.equal(service.get(b.id).status, 'queued');
    assert.equal(service.get(a.id).scene, 2);
    const recovered = new VideoStudioService(root);
    assert.equal(recovered.get(a.id).status, 'failed');
    assert.match(recovered.get(a.id).error!, /reinicialização/);
    release!(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 2); assert.equal(service.get(a.id).status, 'completed');
    assert.equal(new VideoStudioService(root).get(a.id).status, 'completed');
    assert.throws(() => service.get('../../etc/passwd'));
  } finally { release!(); rmSync(root, { recursive: true, force: true }); }
});
test('local renderer failures remain visible and never expose a download', async () => {
  const root = temp();
  try {
    const service = new VideoStudioService(root, { render: async () => { throw Object.assign(new Error('private path'), { code: 'ENOENT' }); } });
    const job = service.create({ idea: 'Teste' }); service.approve(job.id, true);
    await new Promise(resolve => setImmediate(resolve));
    const result = service.get(job.id);
    assert.equal(result.status, 'failed'); assert.match(result.error!, /Dependência local ausente/);
    assert.equal(result.previewUrl, undefined); assert.ok(!result.error!.includes('private path'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('HTTP protects plans/status/artifacts, supports session CSRF protection and byte ranges', async () => {
  const root = temp(), token = 'video-test-only-secret';
  const store = new FileMemoryStore(join(root, 'memory.json'));
  const service = new VideoStudioService(join(root, 'videos'), { render: async (_p, dir) => {
    mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'video.mp4'), 'test-artifact');
  } });
  const app = createSebastianApplication();
  const server = new SebastianHttpServer({ application: app, apiToken: token, videoStudio: service, conversationRegistry: new ConversationRegistry(store, new FileCommandContextHydrator(store)) });
  const started = await server.listen(0, '127.0.0.1'); const base = `http://127.0.0.1:${started.port}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(base+'/api/video/jobs')).status, 401);
    const r = await fetch(base+'/api/video/jobs', { method: 'POST', headers, body: JSON.stringify({ idea: '<script>alert(1)</script>' }) });
    assert.equal(r.status, 201); const job = await r.json() as { id: string };
    assert.equal((await fetch(base+`/api/video/jobs/${job.id}`)).status, 401);
    assert.equal((await fetch(base+`/api/video/jobs/${job.id}/video.mp4`, { headers })).status, 409);
    assert.equal((await fetch(base+'/api/video/jobs', { method: 'POST', headers, body: 'null' })).status, 400);
    assert.equal((await fetch(base+`/api/video/jobs/${job.id}/render`, { method:'POST', headers, body:'{}' })).status, 400);
    const login = await fetch(base+'/api/web/session', { method:'POST', headers:{'Content-Type':'application/json',Origin:base}, body:JSON.stringify({ token }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    assert.equal((await fetch(base+'/api/video/jobs', {headers:{Cookie:cookie}})).status, 200);
    assert.equal((await fetch(base+'/api/video/jobs', {method:'POST',headers:{Cookie:cookie,Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,401);
    assert.equal((await fetch(base+`/api/video/jobs/${job.id}/render`, {method:'POST',headers,body:'{"approved":true}'})).status,202);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await fetch(base+`/api/video/jobs/${job.id}/video.mp4`)).status, 401);
    const range = await fetch(base+`/api/video/jobs/${job.id}/video.mp4`, {headers:{...headers,Range:'bytes=0-3'}});
    assert.equal(range.status,206); assert.equal(await range.text(),'test');
    assert.equal((await fetch(base+`/api/video/jobs/${job.id}/video.mp4`, {headers:{...headers,Range:'bytes=999-1000'}})).status,416);
    const download = await fetch(base+`/api/video/jobs/${job.id}/video.mp4?download=1`, {headers});
    assert.match(download.headers.get('content-disposition')!, /attachment/); await download.arrayBuffer();
    const page = await fetch(base+'/studio'); assert.match(await page.text(), /Estúdio de vídeos/);
    assert.match(page.headers.get('content-security-policy')!, /media-src 'self'/);
  } finally { await started.close(); rmSync(root, { recursive:true, force:true }); }
});
