/**
 * Evidence grounding shared by every path that turns Tool observations into
 * a user-facing answer (SPEC-051/052/053). An answer is grounded only when it
 * cites at least one excerpt and EVERY excerpt is the observed words, in
 * order. Only formatting is ignored: case, whitespace, Markdown markers
 * (* _ ` # | >) and typographic quotes. Excerpts under 3 characters never
 * ground anything.
 */
export const MAX_EVIDENCE_EXCERPTS = 8;
export const MAX_EVIDENCE_EXCERPT_CHARS = 600;

function collapse(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[“”„«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[*_`#|>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizedIncludes(haystack: string, needle: string): boolean {
  const target = collapse(needle);
  return target.length >= 3 && collapse(haystack).includes(target);
}

export type GroundingFailure = 'missingEvidence' | 'invalidEvidence' | 'evidenceNotInObservations';

/** `undefined` when grounded; otherwise the structural reason (never content). */
export function groundingFailure(evidence: unknown, observationSummaries: readonly string[]): GroundingFailure | undefined {
  if (!Array.isArray(evidence) || evidence.length === 0) return 'missingEvidence';
  if (evidence.length > MAX_EVIDENCE_EXCERPTS ||
    evidence.some((excerpt) => typeof excerpt !== 'string' || excerpt.trim() === '' || excerpt.length > MAX_EVIDENCE_EXCERPT_CHARS)) return 'invalidEvidence';
  return evidence.every((excerpt) => observationSummaries.some((summary) => normalizedIncludes(summary, excerpt as string)))
    ? undefined
    : 'evidenceNotInObservations';
}
