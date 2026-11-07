import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { VideoPlan } from '../video-studio/storyboard.js';
import { invokeVideoStoryboard } from '../application/VideoStudioCapabilityProvider.js';
import { LocalVideoRenderer, type VideoRenderer } from './LocalVideoRenderer.js';
export interface VideoJob {
  id: string; plan: VideoPlan; status: 'awaiting_approval' | 'queued' | 'rendering' | 'completed' | 'failed';
  scene: number; createdAt: string; error?: string; previewUrl?: string; downloadUrl?: string;
}
export class VideoStudioError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
/** One local render at a time, bounded retention; completed jobs survive restart. */
export class VideoStudioService {
  private readonly jobs = new Map<string, VideoJob>();
  private readonly root: string;
  private running = false;
  constructor(root: string, private readonly renderer: VideoRenderer = new LocalVideoRenderer()) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
    for (const id of readdirSync(this.root).filter(id => /^[a-f0-9-]{36}$/.test(id)).slice(0, 100)) {
      try {
        const job = JSON.parse(readFileSync(join(this.root, id, 'job.json'), 'utf8')) as VideoJob;
        if (job.id !== id) continue;
        if (job.status === 'rendering' || job.status === 'queued') {
          job.status = 'failed'; job.error = 'Geração interrompida pela reinicialização. Crie um novo roteiro.';
        }
        this.jobs.set(id, job); this.save(job);
      } catch { /* Incomplete metadata is never exposed as a finished video. */ }
    }
  }
  list(): VideoJob[] { return [...this.jobs.values()].map(job => structuredClone(job)); }
  create(input: Record<string, unknown>): VideoJob {
    if (this.jobs.size >= 100) throw new VideoStudioError(429, 'Limite de 100 vídeos. Arquive os arquivos no servidor antes de continuar.');
    let plan: VideoPlan;
    try { plan = invokeVideoStoryboard(input); }
    catch (error) { throw new VideoStudioError(400, (error as Error).message); }
    const job: VideoJob = { id: randomUUID(), plan, status: 'awaiting_approval', scene: 0, createdAt: new Date().toISOString() };
    this.jobs.set(job.id, job); this.save(job);
    return structuredClone(job);
  }
  get(id: string): VideoJob {
    const job = this.jobs.get(id);
    if (!job) throw new VideoStudioError(404, 'Vídeo não encontrado.');
    return structuredClone(job);
  }
  approve(id: string, approved: unknown): VideoJob {
    if (approved !== true) throw new VideoStudioError(400, 'Aprovação explícita do roteiro necessária. Custo externo: US$ 0.');
    const job = this.jobs.get(id);
    if (!job) throw new VideoStudioError(404, 'Vídeo não encontrado.');
    if (job.status !== 'awaiting_approval') return structuredClone(job); // Retry is idempotent.
    if ([...this.jobs.values()].filter(j => j.status === 'queued' || j.status === 'rendering').length >= 3) throw new VideoStudioError(429, 'Fila cheia. Aguarde a geração atual.');
    job.status = 'queued'; this.save(job);
    void this.drain();
    return structuredClone(job);
  }
  artifact(id: string, name: 'video.mp4' | 'captions.srt'): string {
    if (this.get(id).status !== 'completed') throw new VideoStudioError(409, 'Artefato ainda indisponível.');
    return join(this.root, id, name);
  }
  private save(job: VideoJob): void {
    const dir = join(this.root, job.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'job.tmp'), JSON.stringify(job, null, 2));
    renameSync(join(dir, 'job.tmp'), join(dir, 'job.json'));
  }
  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const job of this.jobs.values()) {
        if (job.status !== 'queued') continue;
        job.status = 'rendering'; this.save(job);
        try {
          await this.renderer.render(job.plan, join(this.root, job.id), scene => { job.scene = scene; this.save(job); });
          job.status = 'completed';
          job.previewUrl = `/api/video/jobs/${job.id}/video.mp4`;
          job.downloadUrl = `${job.previewUrl}?download=1`;
        } catch (error) {
          job.status = 'failed';
          const code = (error as NodeJS.ErrnoException).code;
          job.error = code === 'ENOENT' ? 'Dependência local ausente: instale FFmpeg, ffprobe e eSpeak NG no servidor. Nenhum serviço pago foi acionado.' : 'Falha na renderização local. Verifique as dependências, espaço em disco e duração da narração. Nenhum serviço pago foi acionado.';
        }
        this.save(job);
      }
    } finally { this.running = false; }
  }
}
