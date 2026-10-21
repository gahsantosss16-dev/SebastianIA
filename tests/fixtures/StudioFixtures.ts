import { writeFile } from 'node:fs/promises';
import { StudioEngineError, type StudioEngineRenderRequest, type StudioRenderEngine } from '../../studio/StudioRenderJobs.js';
import type { StudioProductionPlan } from '../../studio/VideoProductionPlan.js';

/** ISO-BMFF box: 32-bit size + type + payload. */
function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, body]);
}

function track(handler: string, sampleEntry: Buffer): Buffer {
  const hdlr = box('hdlr', Buffer.alloc(8), Buffer.from(handler, 'latin1'), Buffer.alloc(13));
  const stsd = box('stsd', Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), sampleEntry);
  return box('trak', box('mdia', hdlr, box('minf', box('stbl', stsd))));
}

function mvhd(timescale: number, duration: number): Buffer {
  const body = Buffer.alloc(100);
  body.writeUInt32BE(timescale, 12);
  body.writeUInt32BE(duration, 16);
  return box('mvhd', body);
}

const visual = Buffer.alloc(78);
visual.writeUInt16BE(480, 24);
visual.writeUInt16BE(832, 26);

/**
 * Minimal structurally valid, mobile-ready MP4: ftyp, then moov (H.264 High
 * video + AAC audio, 1 s) before mdat ("faststart"). Over 1000 bytes so
 * Range tests have room.
 */
export const FAKE_MP4 = Buffer.concat([
  box('ftyp', Buffer.from('isom', 'latin1'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2avc1mp41', 'latin1')),
  box('moov',
    mvhd(1000, 1000),
    track('vide', box('avc1', visual, box('avcC', Buffer.from([1, 100, 0, 30, 0xff, 0xe0, 0])))),
    track('soun', box('mp4a', Buffer.alloc(28)))),
  box('mdat', Buffer.alloc(1000, 7)),
]);

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

