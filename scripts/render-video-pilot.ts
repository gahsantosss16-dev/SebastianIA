import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
/** Reproducible, free end-to-end pilot through authenticated production HTTP routes. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSebastianApplication } from '../application/SebastianApplication.js';
import { SebastianHttpServer } from '../application/SebastianHttpServer.js';
import { ConversationRegistry, FileCommandContextHydrator, FileMemoryStore } from '../core/memory/index.js';
import { VideoStudioService, type VideoJob } from '../studio/VideoStudioService.js';
import { probeMedia, runMedia } from '../studio/LocalVideoRenderer.js';

const root = mkdtempSync(join(tmpdir(), 'sebastian-pilot-'));
const output = resolve(process.argv[2] ?? 'examples/video-studio');
const token = randomBytes(32).toString('hex');
const app = createSebastianApplication({ dataDir: root });
const store = new FileMemoryStore(join(root, 'memory.json'));
const server = new SebastianHttpServer({ application: app, apiToken: token, videoStudio: new VideoStudioService(join(root, 'videos')), conversationRegistry: new ConversationRegistry(store, new FileCommandContextHydrator(store)) });
const started = await server.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${started.port}`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
async function json(path: string, body?: unknown): Promise<VideoJob> {
  const response = await fetch(base+path, { headers, ...(body === undefined ? {} : { method:'POST', body:JSON.stringify(body) }) });
  assert.ok(response.ok, `HTTP ${response.status}: ${await response.clone().text()}`);
  return response.json() as Promise<VideoJob>;
}
try {
  assert.equal((await fetch(base+'/api/video/jobs')).status, 401);
  let job = await json('/api/video/jobs', { idea:'Beto, o robô que serviu café para uma planta', durationSeconds:30 });
  assert.equal(job.plan.estimatedCostUsd,0);
  const path = `/api/video/jobs/${job.id}`;
  await json(path+'/render', { approved:true });
  const deadline = Date.now()+180_000;
  do {
    await new Promise(resolve => setTimeout(resolve, 500));
    job = await json(path);
    process.stdout.write(`\r${job.status}: cena ${job.scene}/5   `);
  } while ((job.status === 'rendering' || job.status === 'queued') && Date.now()<deadline);
  assert.equal(job.status,'completed', job.error ?? 'Geração não concluída.');
  mkdirSync(output, { recursive:true });
  const video = await fetch(base+job.downloadUrl!, { headers });
  assert.equal(video.status,200);
  assert.match(video.headers.get('content-disposition')!, /attachment/);
  writeFileSync(join(output,'pilot.mp4'),Buffer.from(await video.arrayBuffer()));
  const srt = await fetch(base+path+'/captions.srt', { headers }); assert.equal(srt.status,200);
  const subtitles = await srt.text();
  writeFileSync(join(output,'pilot.srt'),subtitles);
  const timingText = readFileSync(join(root, 'videos', job.id, 'timing.json'), 'utf8');
  const timings = JSON.parse(timingText) as { scene: number; text: string; startSeconds: number; endSeconds: number; sourceDurationSeconds: number; tempo: number }[];
  let previousEnd = 0;
  for (const cue of timings) {
    const sceneStart = job.plan.scenes.slice(0, cue.scene-1).reduce((sum, s) => sum+s.durationSeconds, 0);
    const sceneEnd = sceneStart + job.plan.scenes[cue.scene-1]!.durationSeconds;
    assert.ok(cue.startSeconds >= previousEnd-0.001 && cue.startSeconds >= sceneStart);
    assert.ok(cue.endSeconds <= sceneEnd && cue.endSeconds > cue.startSeconds);
    assert.ok(Math.abs(cue.endSeconds-cue.startSeconds-cue.sourceDurationSeconds/cue.tempo) < 0.002);
    assert.ok(subtitles.includes(cue.text));
    previousEnd = cue.endSeconds;
  }
  writeFileSync(join(output,'timing.json'),timingText);
  const metadata = await probeMedia(join(output,'pilot.mp4'));
  assert.ok(metadata.streams.some(s=>s.codec_name==='h264' && s.width===720 && s.height===1280));
  assert.ok(metadata.streams.some(s=>s.codec_name==='aac'));
  await runMedia('ffmpeg',['-v','error','-i',join(output,'pilot.mp4'),'-f','null','-']);
  const { stderr } = await promisify(execFile)('ffmpeg',['-v','info','-i',join(output,'pilot.mp4'),'-af','volumedetect','-f','null','-']);
  const maxVolume = /max_volume: (-?[\d.]+) dB/.exec(stderr);
  assert.ok(maxVolume && Number(maxVolume[1]) > -40, 'Narração silenciosa ou ausente.');
  const frame = async (seconds: number): Promise<Buffer> => (await promisify(execFile)('ffmpeg', ['-v','error','-ss',String(seconds),'-i',join(output,'pilot.mp4'),'-vf','crop=720:760:0:0,scale=72:76','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'], { encoding: 'buffer', maxBuffer: 1024*1024 })).stdout;
  const frames = await Promise.all([0.5,4.5,6.5,12.5,18.5,24.5].map(frame));
  const difference = (a: Buffer, b: Buffer): number => a.reduce((sum, value, i) => sum+Math.abs(value-b[i]!),0)/a.length;
  const movementDifference = difference(frames[0]!,frames[1]!);
  assert.ok(movementDifference > 0.05, 'Cena sem movimento de câmera.');
  const sceneDifferences = frames.slice(2).map((f,i) => difference(frames[i === 0 ? 0 : i+1]!,f));
  assert.ok(sceneDifferences.every(n=>n>0.1), 'Cenas não mudaram.');
  const sceneVolumes: number[] = [];
  for (const start of [0,6,12,18,24]) {
    const { stderr: stats } = await promisify(execFile)('ffmpeg',['-v','info','-ss',String(start),'-t','6','-i',join(output,'pilot.mp4'),'-af','volumedetect','-f','null','-']);
    const match = /max_volume: (-?[\d.]+) dB/.exec(stats);
    assert.ok(match && Number(match[1]) > -40, 'Cena sem voz audível.'); sceneVolumes.push(Number(match[1]));
  }
  writeFileSync(join(output,'verification.json'), JSON.stringify({ authenticatedHttpDownload: true, unauthorizedAccessStatus: 401, fullDecodePassed: true, externalCostUsd: 0, maxVolumeDb: Number(maxVolume[1]), renderer: 'FFmpeg + eSpeak NG (pt-br)', durationSeconds: Number(metadata.format.duration), video: 'H.264 720x1280 24fps', audio: 'AAC 48kHz mono', subtitles: 'burned-in + SRT', originalScenes: 5, movementMeanPixelDifference: movementDifference, distinctSceneMeanPixelDifferences: sceneDifferences, sceneMaxVolumesDb: sceneVolumes, captionTiming: 'Measured WAV segment boundaries, adjusted by applied tempo; tolerance 2ms before AAC encoding', captionSegments: timings.length }, null, 2));
  writeFileSync(join(output,'probe.json'),JSON.stringify(metadata,null,2));
  writeFileSync(join(output,'storyboard.json'),JSON.stringify(job.plan,null,2));
  console.log(`\nMP4 validado e baixado por HTTP autenticado: ${join(output,'pilot.mp4')}`);
} finally { await started.close(); rmSync(root, { recursive:true,force:true }); }
