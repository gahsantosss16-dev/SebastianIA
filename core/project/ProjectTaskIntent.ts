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

/** ANALISA - read-only investigation verbs; never a trigger for FAZ. */
const ANALYZE_INTENT_PATTERN = /\b(?:analisa|analise|analisar|investiga|investigue|investigar|verifica|verifique|verificar)\b|\bveja\s+o\s+que\b/;

/** "fecha tudo" - recognized explicitly so it never collapses into WRITE_AUTHORIZED by accident. */
const CLOSE_ALL_INTENT_PATTERN = /\bfecha(?:r)?\s+tudo\b/;

export type ProjectTaskIntentKind = 'analyze' | 'write' | 'closeAll';

/**
 * Classifies free text into one of the three high-level intents Etapa 2
 * defines (ANALISA/FAZ/FECHA TUDO), or `undefined` when none apply - the
 * caller then leaves the message to whatever else already handles it
 * (project identity/selection, ordinary conversation). Order matters:
 * "fecha tudo" is checked first so it is never misread as a write verb.
 */
export function classifyProjectTaskIntent(text: string): ProjectTaskIntentKind | undefined {
  if (typeof text !== 'string' || text.trim() === '') {
    return undefined;
  }
  const query = normalize(text);
  if (CLOSE_ALL_INTENT_PATTERN.test(query)) {
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
