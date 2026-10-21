import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ComfyVideoProvider, ComfyVideoError } from '../../studio/ComfyVideoProvider.js';
const asJson = (data: unknown): Response => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
test('queues a real model workflow and retrieves its MP4', async () => {
  const calls: string[] = [];
  const provider = new ComfyVideoProvider({
    baseUrl: 'http://127.0.0.1:8188/',
    pollIntervalMs: 100,
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.endsWith('/prompt')) return asJson({ prompt_id: 'job-1' });
      if (url.endsWith('/history/job-1')) return asJson({
        'job-1': { status: { completed: true }, outputs: { '99': { videos: [{ filename: 'test.mp4', type: 'output' }] } } }
      });
      if (url.includes('/view?')) return new Response(new Uint8Array([0, 1, 2, 3]));
      throw new Error('Unexpected URL: ' + url);
    }) as typeof fetch,
  });
  const result = await provider.generate({ '1': { class_type: 'VideoModel', inputs: {} } });
  assert.equal(result.filename, 'test.mp4');
  assert.equal(result.mimeType, 'video/mp4');
  assert.equal(result.bytes.length, 4);
  assert.equal(calls.length, 3);
});
test('refuses arbitrary remote endpoints, empty workflows and billing defaults', async () => {
  assert.throws(() => new ComfyVideoProvider({ baseUrl: 'https://example.com/' }), ComfyVideoError);
  const provider = new ComfyVideoProvider({ baseUrl: 'http://localhost:8188' });
  await assert.rejects(provider.generate({}), ComfyVideoError);
});
test('fails closed when the model finishes without video', async () => {
  const provider = new ComfyVideoProvider({ baseUrl: 'http://127.0.0.1:8188', fetchImpl: (async (input: RequestInfo | URL) => {
    return String(input).endsWith('/prompt') ? asJson({ prompt_id: 'job-2' }) : asJson({ 'job-2': { status: { completed: true }, outputs: {} } });
  }) as typeof fetch });
  await assert.rejects(provider.generate({ x: { class_type: 'NoVideo', inputs: {} } }), /without video/);
});
