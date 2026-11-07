import { execFile } from 'node:child_process';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { VideoPlan } from '../video-studio/storyboard.js';
const exec = promisify(execFile);
export async function runMedia(command: string, args: string[], cwd?: string): Promise<string> {
  const result = await exec(command, args, { ...(cwd === undefined ? {} : { cwd }), timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
  return result.stdout;
}
export async function probeMedia(file: string): Promise<{ streams: { codec_type: string; codec_name: string; width?: number; height?: number }[]; format: { duration: string } }> {
  return JSON.parse(await runMedia('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
}
export function subtitleTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
/** Original raster illustration, drawn locally; no stock assets or protected characters. */
function sceneArt(index: number): Buffer {
  const w = 360, h = 640;
  const pixels = Buffer.alloc(w * h * 3);
  const palette = [[19, 32, 64], [26, 42, 75], [51, 30, 65], [18, 55, 65], [22, 51, 46]][index]!;
  const rect = (x: number, y: number, width: number, height: number, c: number[]) => {
    for (let yy = Math.max(0, y); yy < Math.min(h, y + height); yy++) for (let xx = Math.max(0, x); xx < Math.min(w, x + width); xx++) {
      const p = (yy * w + xx) * 3; pixels[p] = c[0]!; pixels[p + 1] = c[1]!; pixels[p + 2] = c[2]!;
    }
  };
  const circle = (cx: number, cy: number, r: number, c: number[]) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x*x+y*y<=r*r) rect(cx+x, cy+y, 1, 1, c);
  };
  rect(0, 0, w, h, palette);
  rect(18, 70, 324, 255, [37, 64, 91]);
  for (let x = 30; x < 330; x += 50) rect(x, 80, 2, 235, [63, 98, 118]);
  circle(282, 118, 34, [255, 203, 112]);
  rect(0, 400, 360, 240, [12, 23, 37]);
  rect(20, 388, 320, 16, [213, 145, 99]);
  rect(35, 404, 12, 100, [110, 75, 65]); rect(310, 404, 12, 100, [110, 75, 65]);
  // Beto: turquoise box robot with antenna, eyes and articulated arms.
  const bx = index === 3 ? 90 : 62;
  rect(bx+16, 225, 5, 30, [84, 223, 213]); circle(bx+18, 220, 8, [255, 193, 88]);
  rect(bx-22, 253, 88, 73, [84, 223, 213]); rect(bx-14, 266, 72, 39, [10, 39, 57]);
  circle(bx+3, 283, 7, [242, 251, 255]); circle(bx+40, 283, 7, [242, 251, 255]);
  rect(bx, 313, 42, 4, [10, 39, 57]); rect(bx-7, 333, 62, 51, [53, 169, 182]);
  rect(bx-28, 340, 16, 37, [84, 223, 213]); rect(bx+61, 335-index*3, 37, 13, [84, 223, 213]);
  rect(bx, 383, 14, 32, [84, 223, 213]); rect(bx+35, 383, 14, 32, [84, 223, 213]);
  // Original coffee machine and plant, changed by story beat.
  rect(240, 240, 64, 100, [158, 134, 209]); rect(247, 251, 50, 24, [24, 27, 47]);
  circle(283, 293, 8, index === 1 ? [255, 91, 97] : [255, 202, 110]);
  rect(253, 320, 8, 26, [221, 219, 239]);
  rect(224, 362, 50, 27, [213, 130, 91]); rect(246, 307, 5, 55, [95, 179, 112]);
  circle(233, 331, 16, [85, 192, 120]); circle(266, 318, 18, [107, 218, 134]);
  if (index >= 2) rect(254, 345, 4, 17, [125, 76, 41]);
  if (index >= 3) { circle(183, 290, 23, [241, 180, 133]); rect(165, 313, 36, 68, [240, 153, 91]); rect(160, 262, 47, 18, [66, 38, 56]); }
  if (index === 4) { circle(260, 315, 3, [15, 30, 35]); circle(270, 315, 3, [15, 30, 35]); }
  for (let n = 0; n <= index; n++) rect(30+n*62, 545, 45, 5, [84, 223, 213]);
  return Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), pixels]);
}
export interface VideoRenderer { render(plan: VideoPlan, directory: string, progress: (scene: number) => void): Promise<void> }
export class LocalVideoRenderer implements VideoRenderer {
  async render(plan: VideoPlan, directory: string, progress: (scene: number) => void): Promise<void> {
    // Fixed local binaries only. No network, shell, API keys, or paid provider fallback.
    await runMedia('ffmpeg', ['-version']);
    await runMedia('espeak-ng', ['--version']);
    await mkdir(directory, { recursive: true });
    const timings: { scene: number; text: string; startSeconds: number; endSeconds: number; sourceDurationSeconds: number; tempo: number }[] = [];
    let offset = 0, fullSrt = '', cue = 1;
    for (const [i, scene] of plan.scenes.entries()) {
      progress(i + 1);
      await writeFile(join(directory, 'scene.ppm'), sceneArt(i));
      const words = scene.narration.split(/\s+/);
      const chunks = Array.from({ length: Math.ceil(words.length / 6) }, (_, n) => words.slice(n*6, n*6+6).join(' '));
      // Synthesize exactly what each cue displays. Measured WAV boundaries,
      // rather than equal subdivisions, keep the subtitles aligned to speech.
      const durations: number[] = [];
      for (const [n, chunk] of chunks.entries()) {
        await writeFile(join(directory, 'narration.txt'), chunk);
        await runMedia('espeak-ng', ['-v', 'pt-br', '-s', '165', '-f', 'narration.txt', '-w', `voice-${n}.wav`], directory);
        const voice = await probeMedia(join(directory, `voice-${n}.wav`));
        durations.push(Number(voice.format.duration));
      }
      const voiceDuration = durations.reduce((a, b) => a + b, 0);
      const speed = Math.max(1, voiceDuration / (scene.durationSeconds - 0.3));
      if (!Number.isFinite(speed) || speed > 2.5) throw new Error('Narração longa demais. Reduza a ideia ou aumente a duração.');
      await writeFile(join(directory, 'voice-concat.txt'), chunks.map((_, n) => `file 'voice-${n}.wav'`).join('\n'));
      await runMedia('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '1', '-i', 'voice-concat.txt', '-c', 'copy', 'voice.wav'], directory);
      let srt = '', elapsed = 0;
      for (const [n, chunk] of chunks.entries()) {
        const a = elapsed, b = elapsed + durations[n]! / speed;
        srt += `${n+1}\n${subtitleTime(a)} --> ${subtitleTime(b)}\n${chunk}\n\n`;
        fullSrt += `${cue++}\n${subtitleTime(offset+a)} --> ${subtitleTime(offset+b)}\n${chunk}\n\n`;
        timings.push({ scene: i+1, text: chunk, startSeconds: offset+a, endSeconds: offset+b, sourceDurationSeconds: durations[n]!, tempo: speed });
        elapsed = b;
      }
      await writeFile(join(directory, 'scene.srt'), srt);
      await runMedia('ffmpeg', ['-y', '-v', 'error', '-loop', '1', '-i', 'scene.ppm', '-i', 'voice.wav', '-vf', "scale=720:1280,zoompan=z='min(1+on*0.0003,1.045)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=720x1280:fps=24,subtitles=scene.srt:force_style='FontName=DejaVu Sans,FontSize=12,PrimaryColour=&HFFFFFF,OutlineColour=&H181818,BorderStyle=1,Outline=2,MarginV=42'", '-af', `atempo=${speed.toFixed(5)},apad`, '-t', String(scene.durationSeconds), '-r', '24', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '1', `${i}.mp4`], directory);
      offset += scene.durationSeconds;
    }
    await writeFile(join(directory, 'captions.srt'), fullSrt);
    await writeFile(join(directory, 'timing.json'), JSON.stringify(timings, null, 2));
    await writeFile(join(directory, 'concat.txt'), plan.scenes.map((_, i) => `file '${i}.mp4'`).join('\n'));
    await runMedia('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '1', '-i', 'concat.txt', '-c', 'copy', '-movflags', '+faststart', 'rendering.mp4'], directory);
    const result = await probeMedia(join(directory, 'rendering.mp4'));
    if (!result.streams.some(s => s.codec_type === 'video' && s.width === 720 && s.height === 1280) || !result.streams.some(s => s.codec_type === 'audio') || Math.abs(Number(result.format.duration) - plan.durationSeconds) > 1) throw new Error('MP4 inválido.');
    await rename(join(directory, 'rendering.mp4'), join(directory, 'video.mp4'));
  }
}
