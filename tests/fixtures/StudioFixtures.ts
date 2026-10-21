import { writeFile } from 'node:fs/promises';
import { StudioEngineError, type StudioEngineRenderRequest, type StudioRenderEngine } from '../../studio/StudioRenderJobs.js';
import type { StudioProductionPlan } from '../../studio/VideoProductionPlan.js';

/** Smallest byte sequence the Studio accepts as an MP4 (ftyp box) followed by deterministic payload. */
export const FAKE_MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(1012, 7)]);

export const PLAN: StudioProductionPlan = {
  title: 'O Robô que Entendeu Tudo Errado', format: '9:16', style: '3d_cartoon', language: 'pt-BR', durationSeconds: 15,
  characters: [
    { id: 'narrador', name: 'Narrador', visualDescription: 'Narrador em off', voiceDescription: 'Voz pt-BR' },
    { id: 'nina', name: 'Nina', visualDescription: 'menina de jardineira roxa', voiceDescription: 'Voz pt-BR de Nina' },
    { id: 'bolota', name: 'Bolota', visualDescription: 'robô redondo azul e branco', voiceDescription: 'Voz pt-BR de Bolota' },
  ],
  scenes: [
    { id: 'cena-1', order: 1, durationSeconds: 9, visualPrompt: 'Animação 3D estilo cartoon: Nina chama Bolota no quarto', characterIds: ['narrador', 'nina', 'bolota'],
      dialogue: [{ characterId: 'narrador', text: 'Nina chama Bolota no quarto.' }, { characterId: 'nina', text: 'Bolota, arrume tudo!' }] },
    { id: 'cena-2', order: 2, durationSeconds: 6, visualPrompt: 'Animação 3D estilo cartoon: Bolota empilha brinquedos', characterIds: ['bolota'],
      dialogue: [{ characterId: 'bolota', text: 'Missão cumprida!' }] },
  ],
  status: 'rendering', estimatedCostUsd: 0, budgetApproved: true,
};

/** Engine under test control: each render waits for release() or aborts. */
export class ControlledEngine implements StudioRenderEngine {
  public readonly id = 'teste';
  public available = true;
  public cost = 0;
  public readonly requests: StudioEngineRenderRequest[] = [];
  public output: Buffer = FAKE_MP4;
  public failWith: Error | undefined;
  private releases: (() => void)[] = [];
  private credits = 0;
  public async availability() {
    return { available: this.available, engine: this.id, estimatedCostUsd: this.cost, ...(this.available ? {} : { message: 'Motor de teste desligado.' }) };
  }
  public async render(request: StudioEngineRenderRequest): Promise<void> {
    this.requests.push(request);
    request.report({ stage: 'Gerando a cena 1 de 2', progress: 0.25 });
    await new Promise<void>((resolve, reject) => {
      if (request.signal.aborted) { reject(new StudioEngineError('abortado')); return; }
      if (this.credits > 0) { this.credits -= 1; resolve(); return; }
      this.releases.push(resolve);
      request.signal.addEventListener('abort', () => {
        // An aborted render must not keep a slot: the next release() belongs to a live render.
        this.releases.splice(this.releases.indexOf(resolve), 1);
        reject(new StudioEngineError('abortado'));
      }, { once: true });
    });
    if (this.failWith) throw this.failWith;
    await writeFile(request.outputPath, this.output);
  }
  /** Resolves once the engine has been asked to render `count` jobs in total. */
  public async rendering(count = this.requests.length + 1): Promise<void> {
    const deadline = Date.now() + 5000;
    while (this.requests.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    if (this.requests.length < count) throw new Error(`engine never received render #${count}`);
  }

  /** Lets the current (or the next) render finish. */
  public release(): void {
    const next = this.releases.shift();
    if (next) next(); else this.credits += 1;
  }
}

