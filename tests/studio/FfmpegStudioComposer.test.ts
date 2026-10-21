import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FfmpegStudioComposer } from '../../studio/FfmpegStudioComposer.js';
import type { StudioClipComposeRequest } from '../../studio/ComfyStudioEngine.js';

function request(root: string): StudioClipComposeRequest {
  return {
    plan: {
      title: 'A aventura de Nina', format: '9:16', style: '3d_cartoon', language: 'pt-BR',
      durationSeconds: 5, status: 'rendering', estimatedCostUsd: 0, budgetApproved: true,
      characters: [{ id: 'nina', name: 'Nina', visualDescription: 'menina de cabelo castanho e jardineira azul', voiceDescription: 'criança alegre' }],
      scenes: [{ id: 'scene-1', order: 1, durationSeconds: 5, visualPrompt: 'Nina acena na biblioteca iluminada', characterIds: ['nina'], dialogue: [{ characterId: 'nina', text: 'Olá, amigos!' }] }],
    },
    clips: [{ sceneId: 'scene-1', order: 1, path: join(root, 'generated-scene.mp4'), mimeType: 'video/mp4', targetSeconds: 5, generatedSeconds: 5, prompt: '3D animation' }],
    outputPath: join(root, 'result.mp4'), workDirectory: root, signal: new AbortController().signal,
  };
}

test('composes only supplied AI clips with pt-BR speech, captions and mobile MP4 codecs', async () => {
  const calls: { command: string; args: readonly string[] }[] = [];
  const root = mkdtempSync(join(tmpdir(), 'sebastian-composer-'));
  const composer = new FfmpegStudioComposer({
    ffmpegPath: 'ffmpeg-test', espeakPath: 'espeak-test',
    run: async (command, args) => { calls.push({ command, args }); },
  });

  await composer.compose(request(root));

  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.command, 'espeak-test');
  assert.deepEqual(calls[0]!.args.slice(0, 4), ['-v', 'pt-br', '-w', join(root, 'composition', 'voice-001.wav')]);
  const ffmpeg = calls[1]!;
  assert.equal(ffmpeg.command, 'ffmpeg-test');
  assert.ok(ffmpeg.args.includes(join(root, 'generated-scene.mp4')));
  assert.ok(ffmpeg.args.includes('-c:v') && ffmpeg.args.includes('libx264'));
  assert.ok(ffmpeg.args.includes('-c:a') && ffmpeg.args.includes('aac'));
  assert.ok(ffmpeg.args.includes('-c:s') && ffmpeg.args.includes('mov_text'));
  assert.ok(ffmpeg.args.includes('+faststart'));
  assert.match(String(ffmpeg.args[ffmpeg.args.indexOf('-filter_complex') + 1]), /adelay=0:all=1/);
});

test('does not call a renderer when the job is already cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  const composer = new FfmpegStudioComposer({ run: async () => assert.fail('runner must not be called') });
  await assert.rejects(composer.compose({ ...request(mkdtempSync(join(tmpdir(), 'sebastian-composer-'))), signal: controller.signal }), /cancelada/);
});
