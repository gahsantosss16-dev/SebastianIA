import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { StudioClipComposer, StudioClipComposeRequest } from './ComfyStudioEngine.js';
import { StudioEngineError } from './StudioRenderJobs.js';

export interface FfmpegStudioComposerOptions {
  readonly ffmpegPath?: string;
  readonly espeakPath?: string;
  /** Optional pre-cleared music asset. The caller is responsible for its licence. */
  readonly backgroundMusicPath?: string;
  readonly run?: (command: string, args: readonly string[], signal: AbortSignal) => Promise<void>;
}

/**
 * FFmpeg composition for real AI video clips. It never manufactures visual
 * content: every video frame comes from an engine-provided scene clip.
 * Speech is generated locally with eSpeak NG pt-BR; captions are embedded as
 * mov_text, and optional music is mixed at a low level.
 */
export class FfmpegStudioComposer implements StudioClipComposer {
  public readonly id = 'FFmpeg + eSpeak NG pt-BR';
  private readonly ffmpegPath: string;
  private readonly espeakPath: string;
  private readonly run: (command: string, args: readonly string[], signal: AbortSignal) => Promise<void>;

  public constructor(private readonly options: FfmpegStudioComposerOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
    this.espeakPath = options.espeakPath ?? process.env.ESPEAK_NG_PATH ?? 'espeak-ng';
    this.run = options.run ?? runProcess;
  }

  public async compose(request: StudioClipComposeRequest): Promise<void> {
    if (request.signal.aborted) throw new StudioEngineError('Renderização cancelada.');
    if (request.clips.length === 0) throw new StudioEngineError('O modelo não devolveu nenhuma cena para compor.');

    const work = resolve(request.workDirectory, 'composition');
    await mkdir(work, { recursive: true });
    try {
      const captions = join(work, 'captions.srt');
      const lines = timeline(request);
      await writeFile(captions, makeSrt(lines), { encoding: 'utf8', mode: 0o600 });

      const voiceFiles: string[] = [];
      for (const [index, line] of lines.entries()) {
        if (request.signal.aborted) throw new StudioEngineError('Renderização cancelada.');
        const path = join(work, `voice-${String(index + 1).padStart(3, '0')}.wav`);
        await this.run(this.espeakPath, ['-v', 'pt-br', '-w', path, line.text], request.signal);
        voiceFiles.push(path);
      }

      const { width, height } = outputSize(request.plan.format);
      const inputs: string[] = [];
      for (const clip of request.clips) inputs.push('-i', clip.path);
      for (const voice of voiceFiles) inputs.push('-i', voice);
      const musicIndex = this.options.backgroundMusicPath ? request.clips.length + voiceFiles.length : undefined;
      if (this.options.backgroundMusicPath) inputs.push('-stream_loop', '-1', '-i', this.options.backgroundMusicPath);
      const subtitleIndex = request.clips.length + voiceFiles.length + (musicIndex === undefined ? 0 : 1);
      inputs.push('-i', captions);

      const video = request.clips.map((_, index) =>
        `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,setpts=PTS-STARTPTS[v${index}]`,
      );
      const joinedVideo = request.clips.map((_, index) => `[v${index}]`).join('') + `concat=n=${request.clips.length}:v=1:a=0[video]`;

      const voices = voiceFiles.map((_, index) => {
        const input = request.clips.length + index;
        const delay = Math.max(0, Math.round(lines[index]!.startSeconds * 1000));
        return `[${input}:a]adelay=${delay}:all=1,aresample=44100[voice${index}]`;
      });
      const voiceMix = voiceFiles.length === 1
        ? '[voice0]anull[voices]'
        : `${voiceFiles.map((_, index) => `[voice${index}]`).join('')}amix=inputs=${voiceFiles.length}:normalize=0[voices]`;
      const audio = musicIndex === undefined
        ? `${voiceMix}`
        : `[${musicIndex}:a]volume=0.08,atrim=duration=${request.plan.durationSeconds},asetpts=PTS-STARTPTS[music];${voiceMix};[voices][music]amix=inputs=2:weights='1 0.15':normalize=0[audio]`;

      const mapAudio = musicIndex === undefined ? '[voices]' : '[audio]';
      const filter = [...video, joinedVideo, ...voices, audio].join(';');
      await this.run(this.ffmpegPath, [
        ...inputs,
        '-filter_complex', filter,
        '-map', '[video]',
        '-map', mapAudio,
        '-map', `${subtitleIndex}:s:0`,
        '-t', String(request.plan.durationSeconds),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k',
        '-c:s', 'mov_text', '-movflags', '+faststart',
        '-y', request.outputPath,
      ], request.signal);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}

interface TimedLine { readonly startSeconds: number; readonly endSeconds: number; readonly text: string; }

function timeline(request: StudioClipComposeRequest): readonly TimedLine[] {
  const result: TimedLine[] = [];
  let elapsed = 0;
  for (const scene of [...request.plan.scenes].sort((a, b) => a.order - b.order)) {
    const sceneLines = scene.dialogue.length === 0
      ? [{ text: scene.visualPrompt }]
      : scene.dialogue.map((line) => {
        const character = request.plan.characters.find((candidate) => candidate.id === line.characterId);
        return { text: `${character?.name ?? 'Narrador'}: ${line.text}` };
      });
    const span = scene.durationSeconds / sceneLines.length;
    for (const [index, line] of sceneLines.entries()) {
      result.push({ startSeconds: elapsed + index * span, endSeconds: elapsed + (index + 1) * span, text: line.text.slice(0, 1000) });
    }
    elapsed += scene.durationSeconds;
  }
  return result;
}

function outputSize(format: '9:16' | '16:9' | '1:1'): { readonly width: number; readonly height: number } {
  switch (format) {
    case '9:16': return { width: 720, height: 1280 };
    case '16:9': return { width: 1280, height: 720 };
    case '1:1': return { width: 960, height: 960 };
  }
}

function makeSrt(lines: readonly TimedLine[]): string {
  return lines.map((line, index) => `${index + 1}\n${srtTime(line.startSeconds)} --> ${srtTime(line.endSeconds)}\n${line.text.replaceAll(/\r?\n/g, ' ')}\n`).join('\n');
}

function srtTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds * 1000));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const secs = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':') + ',' + String(millis).padStart(3, '0');
}

function runProcess(command: string, args: readonly string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { windowsHide: true, signal });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => reject(new StudioEngineError(`Não foi possível iniciar ${basename(command)}: ${error.message}`)));
    child.on('close', (code) => code === 0
      ? resolveRun()
      : reject(new StudioEngineError(`${basename(command)} falhou (${code ?? 'sem código'}): ${stderr.slice(-500)}`)));
  });
}
