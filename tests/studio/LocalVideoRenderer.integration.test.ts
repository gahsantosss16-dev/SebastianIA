import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('real authenticated MP4 pilot has original scenes, audible Portuguese voice and subtitles', { skip: process.env.SEBASTIAN_VIDEO_E2E !== '1', timeout: 240_000 }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'sebastian-real-video-test-'));
  try {
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/render-video-pilot.ts', directory], { timeout: 230_000, stdio: 'pipe' });
    const verification = JSON.parse(readFileSync(join(directory, 'verification.json'), 'utf8'));
    assert.equal(verification.authenticatedHttpDownload, true);
    assert.equal(verification.fullDecodePassed, true);
    assert.equal(verification.externalCostUsd, 0);
    assert.ok(verification.maxVolumeDb > -40);
    assert.equal(verification.originalScenes, 5);
    const srt = readFileSync(join(directory, 'pilot.srt'), 'utf8');
    assert.match(srt, /Beto/); assert.match(srt, /planta/);
    assert.ok(readFileSync(join(directory, 'pilot.mp4')).byteLength > 10_000);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
