import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Mp4InspectionError, inspectMp4, mobilePlaybackProblems } from '../../studio/Mp4Inspection.js';
import { FAKE_MP4 } from '../fixtures/StudioFixtures.js';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const hasFfmpeg = spawnSync(FFMPEG, ['-version'], { windowsHide: true }).status === 0;
const dir = mkdtempSync(join(tmpdir(), 'studio-mp4-'));

/** Real files produced by FFmpeg - the same tool the composer uses - not hand-made bytes. */
function ffmpeg(name: string, args: readonly string[]): string {
  const output = join(dir, name);
  const result = spawnSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x568:d=1:r=16', ...args, '-y', output], { windowsHide: true });
  assert.equal(result.status, 0, String(result.stderr));
  return output;
}

test('real FFmpeg MP4s: mobile-ready output passes, each incompatibility is named', { skip: hasFfmpeg ? false : 'FFmpeg não instalado neste ambiente' }, async () => {
  const srt = join(dir, 'legenda.srt');
  writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nNina: Bolota, guarde tudo!\n');
  const good = await inspectMp4(ffmpeg('good.mp4', ['-f', 'lavfi', '-i', 'sine=d=1', '-i', srt, '-map', '0:v', '-map', '1:a', '-map', '2:s',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'mov_text', '-movflags', '+faststart']));
  assert.equal(good.video?.codec, 'avc1');
  assert.equal(good.video?.width, 320);
  assert.equal(good.video?.height, 568);
  assert.ok([66, 77, 100].includes(good.video?.profile ?? -1));
  assert.equal(good.audio?.codec, 'mp4a');
  assert.deepEqual(good.subtitleCodecs, ['tx3g']);
  assert.equal(good.faststart, true);
  assert.ok(Math.abs((good.durationSeconds ?? 0) - 1) < 0.2);
  assert.deepEqual(mobilePlaybackProblems(good), []);

  const slow = await inspectMp4(ffmpeg('slow.mp4', ['-f', 'lavfi', '-i', 'sine=d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']));
  assert.match(mobilePlaybackProblems(slow).join(), /faststart/);
  const mute = await inspectMp4(ffmpeg('mute.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']));
  assert.match(mobilePlaybackProblems(mute).join(), /áudio/);
  const yuv444 = await inspectMp4(ffmpeg('yuv444.mp4', ['-f', 'lavfi', '-i', 'sine=d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-c:a', 'aac', '-movflags', '+faststart']));
  assert.match(mobilePlaybackProblems(yuv444).join(), /perfil H\.264 244/);
  const mpeg4 = await inspectMp4(ffmpeg('mpeg4.mp4', ['-f', 'lavfi', '-i', 'sine=d=1', '-c:v', 'mpeg4', '-c:a', 'aac', '-movflags', '+faststart']));
  assert.match(mobilePlaybackProblems(mpeg4).join(), /mp4v, não H\.264/);
});

test('fixture MP4 used by the job tests is structurally mobile-ready', async () => {
  const path = join(dir, 'fixture.mp4');
  writeFileSync(path, FAKE_MP4);
  const media = await inspectMp4(path);
  assert.deepEqual(mobilePlaybackProblems(media), []);
});

test('non-MP4, truncated and moov-less files are rejected', async () => {
  const cases: readonly [string, Buffer][] = [
    ['empty.mp4', Buffer.alloc(0)],
    ['text.mp4', Buffer.from('isto não é um vídeo, apenas texto qualquer')],
    ['truncated.mp4', FAKE_MP4.subarray(0, 40)],
    ['no-moov.mp4', Buffer.concat([FAKE_MP4.subarray(0, FAKE_MP4.readUInt32BE(0)), Buffer.from([0, 0, 0, 8]), Buffer.from('mdat')])],
  ];
  for (const [name, bytes] of cases) {
    const path = join(dir, name);
    writeFileSync(path, bytes);
    await assert.rejects(inspectMp4(path), Mp4InspectionError, name);
  }
});
