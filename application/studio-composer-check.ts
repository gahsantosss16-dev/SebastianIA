#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StudioSceneClip } from '../studio/ComfyStudioEngine.js';
import { verifyMobileMp4 } from '../studio/StudioRenderJobs.js';
import type { StudioProductionPlan } from '../studio/VideoProductionPlan.js';
import { loadComposer } from './StudioEngineConfiguration.js';

/**
 * Contract check for the Work's composer, run on the GPU machine:
 *
 *   STUDIO_COMPOSER_MODULE=./composer.js node dist/application/studio-composer-check.js
 *
 * Feeds the composer real FFmpeg test clips (shorter than their scenes, as a
 * video model returns them) and a plan with narration and character lines,
 * through the same integration point production uses, then checks the MP4:
 * H.264 + AAC + faststart (mobile browsers) and total duration. Exit code 0
 * only when every check passes.
 */

const PLAN: StudioProductionPlan = {
  title: 'Verificação do compositor', format: '9:16', style: '3d_cartoon', language: 'pt-BR', durationSeconds: 9,
  characters: [
    { id: 'narrador', name: 'Narrador', visualDescription: 'Narrador em off', voiceDescription: 'Voz brasileira (pt-BR), clara e expressiva' },
    { id: 'nina', name: 'Nina', visualDescription: 'menina de jardineira roxa', voiceDescription: 'Voz brasileira (pt-BR) de Nina' },
  ],
  scenes: [
    { id: 'cena-1', order: 1, durationSeconds: 5, visualPrompt: 'Animação 3D: Nina no quarto', characterIds: ['narrador', 'nina'],
      dialogue: [{ characterId: 'narrador', text: 'Nina entrou no quarto bagunçado.' }, { characterId: 'nina', text: 'Que bagunça!' }] },
    { id: 'cena-2', order: 2, durationSeconds: 4, visualPrompt: 'Animação 3D: quarto arrumado', characterIds: ['narrador'],
      dialogue: [{ characterId: 'narrador', text: 'No fim, tudo ficou arrumado.' }] },
  ],
  status: 'rendering', estimatedCostUsd: 0, budgetApproved: true,
};

async function main(): Promise<void> {
  const composer = await loadComposer(process.env);
  if (!composer) throw new Error('Defina STUDIO_COMPOSER_MODULE com o módulo do compositor (exporta createStudioComposer(env)).');
  const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
  const dir = mkdtempSync(join(tmpdir(), 'studio-composer-check-'));
  try {
    const clips: StudioSceneClip[] = PLAN.scenes.map((scene) => {
      const path = join(dir, `${scene.id}.mp4`);
      const result = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=480x832:d=3:r=16', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path], { windowsHide: true });
      if (result.status !== 0) throw new Error(`FFmpeg não conseguiu gerar o clipe de teste: ${String(result.stderr).slice(-300)}`);
      return { sceneId: scene.id, order: scene.order, path, mimeType: 'video/mp4', targetSeconds: scene.durationSeconds, generatedSeconds: 3, prompt: scene.visualPrompt };
    });
    const outputPath = join(dir, 'final.mp4');
    const started = Date.now();
    await composer.compose({ plan: PLAN, clips, outputPath, workDirectory: dir, signal: new AbortController().signal });
    const media = await verifyMobileMp4(outputPath);
    const duration = media.durationSeconds ?? 0;
    const problems: string[] = [];
    if (Math.abs(duration - PLAN.durationSeconds) > 1) problems.push(`duração ${duration.toFixed(2)} s, esperado ${PLAN.durationSeconds} s (cada clipe deve ser estendido até targetSeconds)`);
    console.log(JSON.stringify({ composer: composer.id, seconds: (Date.now() - started) / 1000, media, problems }, null, 2));
    if (media.subtitleCodecs.length === 0) console.log('Aviso: sem trilha de legenda no MP4. Se as legendas forem gravadas na imagem (recomendado para celulares), confira visualmente.');
    if (problems.length > 0) throw new Error(problems.join('; '));
    console.log('OK: o compositor atende ao contrato do Sebastian Studio.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`FALHA: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
