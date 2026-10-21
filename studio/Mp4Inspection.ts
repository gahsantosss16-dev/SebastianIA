import { open, type FileHandle } from 'node:fs/promises';

/**
 * Structural MP4 inspection in plain TypeScript (no FFmpeg needed on the web
 * host). Reads only box headers and the moov box, so large videos are cheap.
 *
 * Used to refuse outputs that would not play in mobile browsers before they
 * are offered to the user: H.264 (baseline/main/high, i.e. 8-bit 4:2:0),
 * AAC audio and "faststart" (moov before mdat).
 */

export interface Mp4Inspection {
  readonly majorBrand: string;
  readonly faststart: boolean;
  readonly durationSeconds: number | undefined;
  readonly video: { readonly codec: string; readonly profile: number | undefined; readonly width: number; readonly height: number } | undefined;
  readonly audio: { readonly codec: string } | undefined;
  /** Soft subtitle sample entries (e.g. tx3g). Burned-in captions are not detectable here. */
  readonly subtitleCodecs: readonly string[];
}

const MAX_MOOV_BYTES = 64 * 1024 * 1024;
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
/** H.264 profile_idc: 66 baseline, 77 main, 88 extended, 100 high (8-bit 4:2:0). */
const MOBILE_H264_PROFILES = new Set([66, 77, 88, 100]);

export class Mp4InspectionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'Mp4InspectionError';
  }
}

export async function inspectMp4(path: string): Promise<Mp4Inspection> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, 'r');
    const size = (await handle.stat()).size;
    let offset = 0;
    let majorBrand = '';
    let moov: Buffer | undefined;
    let moovOffset = -1;
    let mdatOffset = -1;
    let first = true;
    while (offset + 8 <= size) {
      const header = Buffer.alloc(16);
      await handle.read(header, 0, 16, offset);
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      let headerSize = 8;
      if (boxSize === 1) {
        boxSize = Number(header.readBigUInt64BE(8));
        headerSize = 16;
      } else if (boxSize === 0) {
        boxSize = size - offset;
      }
      if (boxSize < headerSize || offset + boxSize > size) throw new Mp4InspectionError('Estrutura MP4 corrompida.');
      if (first) {
        if (type !== 'ftyp') throw new Mp4InspectionError('O arquivo não começa com a caixa ftyp de um MP4.');
        const brand = Buffer.alloc(4);
        await handle.read(brand, 0, 4, offset + headerSize);
        majorBrand = brand.toString('latin1');
        first = false;
      }
      if (type === 'moov' && moovOffset < 0) {
        if (boxSize > MAX_MOOV_BYTES) throw new Mp4InspectionError('Caixa moov grande demais.');
        moovOffset = offset;
        moov = Buffer.alloc(boxSize - headerSize);
        await handle.read(moov, 0, moov.length, offset + headerSize);
      }
      if (type === 'mdat' && mdatOffset < 0) mdatOffset = offset;
      offset += boxSize;
    }
    if (first) throw new Mp4InspectionError('Arquivo vazio ou não é um MP4.');
    if (!moov) throw new Mp4InspectionError('O MP4 não tem a caixa moov (arquivo incompleto).');
    return { majorBrand, faststart: mdatOffset < 0 || moovOffset < mdatOffset, ...inspectMoov(moov) };
  } catch (error) {
    if (error instanceof Mp4InspectionError) throw error;
    throw new Mp4InspectionError('Não foi possível ler o MP4.');
  } finally {
    await handle?.close();
  }
}

/** Problems that would stop the video from playing (with sound) in mobile browsers. Empty means OK. */
export function mobilePlaybackProblems(media: Mp4Inspection): readonly string[] {
  const problems: string[] = [];
  if (!media.video) problems.push('não há trilha de vídeo');
  else if (media.video.codec !== 'avc1' && media.video.codec !== 'avc3') problems.push(`vídeo em ${media.video.codec}, não H.264`);
  else if (media.video.profile !== undefined && !MOBILE_H264_PROFILES.has(media.video.profile)) problems.push(`perfil H.264 ${media.video.profile} não suportado em celulares (use yuv420p, perfil high/main/baseline)`);
  if (!media.audio) problems.push('não há trilha de áudio (narração)');
  else if (media.audio.codec !== 'mp4a') problems.push(`áudio em ${media.audio.codec}, não AAC`);
  if (!media.faststart) problems.push('moov depois de mdat (gere com -movflags +faststart)');
  return problems;
}

interface Box { readonly type: string; readonly start: number; readonly end: number }

function* children(buffer: Buffer, start: number, end: number): Generator<Box> {
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      size = Number(buffer.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) throw new Mp4InspectionError('Estrutura moov corrompida.');
    yield { type: buffer.toString('latin1', offset + 4, offset + 8), start: offset + header, end: offset + size };
    offset += size;
  }
}

function inspectMoov(moov: Buffer): Omit<Mp4Inspection, 'majorBrand' | 'faststart'> {
  let durationSeconds: number | undefined;
  let video: Mp4Inspection['video'];
  let audio: Mp4Inspection['audio'];
  const subtitleCodecs: string[] = [];
  for (const box of children(moov, 0, moov.length)) {
    if (box.type === 'mvhd') durationSeconds = readDuration(moov, box);
    if (box.type !== 'trak') continue;
    let handler = '';
    const entries: { type: string; box: Box }[] = [];
    const walk = (parent: Box): void => {
      for (const child of children(moov, parent.start, parent.end)) {
        if (child.type === 'hdlr') handler = moov.toString('latin1', child.start + 8, child.start + 12);
        else if (child.type === 'stsd') {
          // FullBox header (4) + entry_count (4), then sample entries.
          for (const entry of children(moov, child.start + 8, child.end)) entries.push({ type: entry.type, box: entry });
        } else if (CONTAINERS.has(child.type)) walk(child);
      }
    };
    walk(box);
    const entry = entries[0];
    if (!entry) continue;
    if (handler === 'vide' && !video) {
      // VisualSampleEntry: 8 bytes SampleEntry + 70 bytes of visual fields, then child boxes (avcC).
      const width = moov.readUInt16BE(entry.box.start + 24);
      const height = moov.readUInt16BE(entry.box.start + 26);
      let profile: number | undefined;
      if (entry.box.start + 78 <= entry.box.end) {
        for (const child of children(moov, entry.box.start + 78, entry.box.end)) {
          if (child.type === 'avcC' && child.end - child.start >= 2) profile = moov.readUInt8(child.start + 1);
        }
      }
      video = { codec: entry.type, profile, width, height };
    } else if (handler === 'soun' && !audio) {
      audio = { codec: entry.type };
    } else if (handler === 'sbtl' || handler === 'text' || handler === 'subt') {
      subtitleCodecs.push(entry.type);
    }
  }
  return { durationSeconds, video, audio, subtitleCodecs };
}

function readDuration(buffer: Buffer, box: Box): number | undefined {
  const version = buffer.readUInt8(box.start);
  const timescale = version === 1 ? buffer.readUInt32BE(box.start + 20) : buffer.readUInt32BE(box.start + 12);
  const duration = version === 1 ? Number(buffer.readBigUInt64BE(box.start + 24)) : buffer.readUInt32BE(box.start + 16);
  return timescale > 0 ? duration / timescale : undefined;
}
