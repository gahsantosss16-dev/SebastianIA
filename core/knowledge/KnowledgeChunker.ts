import type { KnowledgeIngestionFormat } from './KnowledgeTypes.js';

/**
 * Chunking for Markdown/TXT only (see docs/knowledge-layer-v1.md, section 4
 * and 13 risk 3: ~300-500 tokens / ~1500 chars per chunk, ~15% overlap,
 * never crossing a heading boundary - a starting proposal, not empirically
 * tuned yet). PDF/DOCX and OCR are explicitly out of scope for this phase.
 */
export interface DraftChunk {
  readonly sectionPath: readonly string[];
  readonly locator: string;
  readonly text: string;
}

const TARGET_CHUNK_CHARS = 1_500;
const OVERLAP_LINES = 3;

interface DraftSection {
  readonly sectionPath: readonly string[];
  readonly lines: readonly string[];
  readonly startLine: number;
}

/**
 * Some official Markdown sources (e.g. GitHub Docs) use Liquid template
 * markers for multi-edition publishing. This strips only the purely
 * structural, content-free ones (conditional/comment scaffolding) -
 * mechanical tag removal, not template execution: no condition is ever
 * evaluated, no branch is chosen, every word of wrapped text is kept
 * verbatim exactly as ingested. Generic (not gated on source identity) - a
 * no-op for the overwhelming majority of sources that never contain these
 * markers at all.
 *
 * Deliberately NOT handled: inline value-substitution tags like
 * `{% data variables.product.pat_generic %}`. Blindly deleting those would
 * remove real words from the sentence (e.g. "a {% data
 * variables.product.pat_generic %} token" would silently become "a token"),
 * changing meaning - correctly resolving them to their real value would
 * require fetching and parsing the source repository's separate
 * `data/variables/*.yml` files, a new dependency and added complexity out of
 * scope for this phase (see docs/knowledge-layer-v1.md, section 13). Left in
 * place as visible, harmless markup noise and a documented Fase 1
 * limitation - it does not misrepresent the underlying content.
 */
function stripStructuralLiquidTags(text: string): string {
  return text.replace(/\{%-?\s*(?:ifversion|elsif|else|endif|comment|endcomment)\b[^%]*-?%\}\n?/gi, '');
}

export function normalizeText(rawText: string): string {
  return stripStructuralLiquidTags(rawText)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunkDocument(format: KnowledgeIngestionFormat, rawText: string): readonly DraftChunk[] {
  const normalized = normalizeText(rawText);
  const lines = normalized.split('\n');
  const sections = format === 'markdown' ? splitMarkdownIntoSections(lines) : [{ sectionPath: [], lines, startLine: 1 }];
  return sections.flatMap((section) => chunkSection(section));
}

function splitMarkdownIntoSections(lines: readonly string[]): readonly DraftSection[] {
  const sections: DraftSection[] = [];
  let headingStack: Array<{ readonly level: number; readonly title: string }> = [];
  let currentLines: string[] = [];
  let currentSectionPath: readonly string[] = [];
  let currentStartLine = 1;

  const flushSection = (): void => {
    if (currentLines.some((line) => line.trim() !== '')) {
      sections.push({ sectionPath: currentSectionPath, lines: currentLines, startLine: currentStartLine });
    }
  };

  lines.forEach((line, index) => {
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!headingMatch) {
      currentLines.push(line);
      return;
    }
    flushSection();
    const level = headingMatch[1]!.length;
    const title = headingMatch[2]!.trim();
    headingStack = headingStack.filter((entry) => entry.level < level);
    headingStack.push({ level, title });
    currentSectionPath = headingStack.map((entry) => entry.title);
    currentLines = [];
    currentStartLine = index + 2; // body starts on the line right after this heading (1-based)
  });
  flushSection();

  return sections;
}

function chunkSection(section: DraftSection): readonly DraftChunk[] {
  const chunks: DraftChunk[] = [];
  let buffer: string[] = [];
  let bufferChars = 0;
  let chunkStartLine = section.startLine;

  const flush = (): void => {
    const text = buffer.join('\n').trim();
    if (text === '') {
      return;
    }
    const endLine = chunkStartLine + buffer.length - 1;
    chunks.push({ sectionPath: section.sectionPath, locator: `linhas ${chunkStartLine}-${endLine}`, text });
  };

  for (const line of section.lines) {
    buffer.push(line);
    bufferChars += line.length + 1;
    if (bufferChars < TARGET_CHUNK_CHARS) {
      continue;
    }
    flush();
    const overlap = buffer.slice(-OVERLAP_LINES);
    chunkStartLine = chunkStartLine + buffer.length - overlap.length;
    buffer = [...overlap];
    bufferChars = overlap.reduce((sum, overlapLine) => sum + overlapLine.length + 1, 0);
  }
  flush();

  return chunks;
}

/** Rough, dependency-free token accounting (~4 chars/token) - not exact, only used for budget bookkeeping. */
export function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
