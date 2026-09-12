const DIACRITICAL_MARKS_PATTERN = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g');
const normalize = (text: string): string =>
  text.normalize('NFD').replace(DIACRITICAL_MARKS_PATTERN, '').toLowerCase();

/**
 * FAZ - explicit imperative verbs asking for a real change. Deliberately a
 * narrow, precision-over-recall list (never a general "sounds like a
 * request" heuristic): a false negative just falls through to ordinary
 * conversation, but a false positive would spawn a real, paid external
 * agent against a project's checkout, so an ambiguous or vague sentence
 * ("isso não resolve", "vamos discutir a correção") is accepted as a known,
 * intentional limitation rather than guessed at.
 */
const WRITE_INTENT_PATTERN = /\b(?:faca|facam|fazer|corrige|corrija|corrigir|implementa|implemente|implementar|ajusta|ajuste|ajustar|resolve|resolva|resolver|altera|altere|adiciona|adicione|remove|remova|cria|crie)\b/;

/**
 * ANALISA - read-only investigation verbs; never a trigger for FAZ. Etapa 4
 * adds the informal "vê"/"ve" spellings (vs. only "veja") and a few common
 * ways of asking "what's causing this" without an imperative verb at all -
 * still a closed, precision-over-recall list, never a general "sounds like a
 * question" heuristic.
 */
const ANALYZE_INTENT_PATTERN =
  /\b(?:analisa|analise|analisar|investiga|investigue|investigar|verifica|verifique|verificar|descobre|descubra)\b|\bve(?:ja)?\s+o\s+que\b|\bo\s+que\s+esta\s+causando\b|\bpor\s+que\s+esta\s+assim\b|\bisso\s+esta\s+certo\b/;

/**
 * HOMOLOGA - natural positive feedback on an `awaitingHomologation` task.
 * Deliberately does not by itself authorize anything: `ProjectTaskOrchestrator`
 * only ever records this as a non-binding signal (`homologatedAt`) that a
 * later, explicit close intent can lean on - see `detectHomologationFeedback`.
 * A bare "homologado"/"aprovado" already exists in `CLOSE_ALL_INTENT_PATTERN`
 * below (it only counts there when paired with an explicit "fech-" verb);
 * this pattern instead captures the many ways of saying "looks good" that
 * carry no closing verb at all.
 */
const HOMOLOGATION_FEEDBACK_PATTERN =
  /\bficou\s+bo[ma]\b|\bperfeito\b|\baprovado\b|\bhomologado\b|\be\s+isso\s+mesmo\b|\bgostei\b|\bexcelente\b|\bshow\b|\bbeleza\b|\botimo\b|\bagora\s+sim\b/;

/**
 * FECHA TUDO - recognized explicitly so it never collapses into
 * WRITE_AUTHORIZED by accident (it is checked first). Deliberately narrow,
 * same precision-over-recall rationale as WRITE_INTENT_PATTERN, but here the
 * stakes are higher (a real commit/push/tag), so an isolated homologation
 * word or an isolated "pode fechar" alone is not enough - "homologado"/
 * "aprovado" only counts when it appears near an actual "fech-" verb (either
 * order), and a bare "pode fechar"/"manda fechar" is still an explicit,
 * unambiguous imperative on its own. A message like "isso está homologado"
 * with no mention of closing never matches.
 */
const CLOSE_VERB = 'fecha(?:r)?';
const HOMOLOGATION_WORD = '(?:homologad[oa]|homologo|aprovad[oa])';
const CLOSE_ALL_INTENT_PATTERN = new RegExp(
  `\\bfecha(?:r)?\\s+tudo\\b` +
    `|\\bpode\\s+fechar\\b` +
    `|\\bmanda(?:r)?\\s+fechar\\b` +
    `|\\b${HOMOLOGATION_WORD}\\b[^.!?\\n]{0,40}\\b${CLOSE_VERB}\\b` +
    `|\\b${CLOSE_VERB}\\b[^.!?\\n]{0,40}\\b${HOMOLOGATION_WORD}\\b`,
);

/**
 * Etapa 4: short, bare closing confirmations ("fecha", "encerra", "pode
 * finalizar"...) - these are NEVER matched on their own; the whole message
 * must be exactly one of these short forms (anchored `^...$`, only trailing
 * "isso"/"ai"/punctuation tolerated). That anchoring is what keeps "fecha o
 * modal"/"finaliza esse texto" out: as soon as anything else follows the
 * verb, the anchor fails and this pattern simply does not match - never a
 * word-blacklist of UI terms to keep up to date. Even when this matches, the
 * caller (`classifyProjectTaskIntent`) only honors it when the caller has
 * already told us a close-eligible task exists (`hasCloseEligibleTask`) -
 * the task context is what makes "fecha" ever mean Git, never the bare word.
 */
const SHORT_CLOSE_CONFIRMATION_PATTERN = new RegExp(
  `^(?:${CLOSE_VERB}|encerra(?:r)?|finaliza(?:r)?)(?:\\s+isso)?(?:\\s+ai)?[.!]*$` +
    `|^pode\\s+(?:encerrar|finalizar)[.!]*$` +
    `|^agora\\s+${CLOSE_VERB}\\s+isso[.!]*$`,
);

export type ProjectTaskIntentKind = 'analyze' | 'write' | 'closeAll';

export interface ProjectTaskIntentContext {
  /**
   * Whether a bare confirmation like "fecha" should be honored as FECHA
   * TUDO right now. The caller (`ProjectTaskOrchestrator`) is the one that
   * decides this - Etapa 4's fix: it must reflect approval of the task's
   * CURRENT state (a fresh `homologatedAt`, or a commit already pending
   * push from an earlier authorized close), never merely "a close-eligible
   * status exists" and never a homologation left over from a state that was
   * since edited. Explicit, self-contained phrases ("fecha tudo", "pode
   * fechar") are unaffected by this - they are their own authorization,
   * always for whatever state exists right now.
   */
  readonly hasCloseEligibleTask?: boolean;
}

/**
 * Etapa 4: true when the message is structurally a short, bare closing
 * confirmation ("fecha", "encerra", "pode finalizar"...), independent of
 * whether it is actually authorized right now. Exposed separately from
 * `classifyProjectTaskIntent` so the caller can tell "this looks like an
 * attempt to close, but the current state lacks homologation" apart from
 * "this is not about closing at all" - the two must never be handled the
 * same way (the first needs an explicit refusal, the second silently falls
 * through to ordinary conversation/continuation).
 */
export function isShortCloseConfirmation(text: string): boolean {
  if (typeof text !== 'string' || text.trim() === '') {
    return false;
  }
  return SHORT_CLOSE_CONFIRMATION_PATTERN.test(normalize(text).trim());
}

/**
 * Classifies free text into one of the three high-level intents Etapa 2
 * defines (ANALISA/FAZ/FECHA TUDO), or `undefined` when none apply - the
 * caller then leaves the message to whatever else already handles it
 * (project identity/selection, ordinary conversation, or Etapa 4's
 * contextual layer). Order matters: "fecha tudo" is checked first so it is
 * never misread as a write verb. `context` is optional and defaults to no
 * task available, so every existing call site keeps its exact prior
 * behavior unless it explicitly opts into the new short-confirmation match.
 */
export function classifyProjectTaskIntent(text: string, context: ProjectTaskIntentContext = {}): ProjectTaskIntentKind | undefined {
  if (typeof text !== 'string' || text.trim() === '') {
    return undefined;
  }
  const query = normalize(text).trim();
  if (CLOSE_ALL_INTENT_PATTERN.test(query)) {
    return 'closeAll';
  }
  if (context.hasCloseEligibleTask === true && SHORT_CLOSE_CONFIRMATION_PATTERN.test(query)) {
    return 'closeAll';
  }
  if (WRITE_INTENT_PATTERN.test(query)) {
    return 'write';
  }
  if (ANALYZE_INTENT_PATTERN.test(query)) {
    return 'analyze';
  }
  return undefined;
}

/**
 * Etapa 4: natural positive feedback on a task, independent of (and checked
 * alongside, never instead of) `classifyProjectTaskIntent` - "ficou bom,
 * fecha" both records homologation AND triggers the close in the same
 * message, because the caller checks both. Never authorizes anything by
 * itself; `ProjectTaskOrchestrator` only ever uses it to set a
 * non-binding `homologatedAt` marker.
 */
export function detectHomologationFeedback(text: string): boolean {
  if (typeof text !== 'string' || text.trim() === '') {
    return false;
  }
  return HOMOLOGATION_FEEDBACK_PATTERN.test(normalize(text).trim());
}
