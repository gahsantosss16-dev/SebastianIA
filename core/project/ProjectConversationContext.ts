import { randomUUID } from 'node:crypto';
import type { FileMemoryStore } from '../memory/FileMemoryStore.js';
import type { ProjectRegistry } from './ProjectRegistry.js';
import { loadProjectPolicies } from './ProjectWorkspacePolicy.js';

const SELECTIONS = 'project-conversations';
const AUDIT = 'project-policy-uses';
const normalize = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.!?]+$/g, '').trim();
export interface ActiveProject { readonly id: string; readonly displayName: string; readonly environment: string; readonly policyStatus: 'loaded' | 'unavailable'; }
export interface ProjectReply {
  readonly message: string;
  readonly project: ActiveProject | null;
  /**
   * True exactly when this reply only identified/loaded the project and
   * never attempted to act on the rest of the message - i.e. the message
   * carried no explicit selection verb (`select`) and wasn't itself an
   * identity/rules query, so a follow-up conversational question in the
   * same text ("...e me diga o que você consegue fazer por mim?") was never
   * addressed. The caller (`InMemorySpecializedAgent`) uses this to decide
   * whether this reply is the final answer or whether the message should
   * keep flowing through the rest of the pipeline once a task intent
   * (ANALISA/FAZ/FECHA) has already had its chance and found none.
   */
  readonly taskConnectionPending?: boolean;
}

/** Conversation binding and policy provenance, using the existing registry and memory store. No executor. */
export class ProjectConversationContext {
  public constructor(public readonly registry: ProjectRegistry, private readonly store: FileMemoryStore, private readonly environmentId: string) {}

  public active(conversationId: string): ActiveProject | null {
    const record = this.store.listRecords(SELECTIONS).find(item => item.conversationId === conversationId);
    const project = typeof record?.projectId === 'string' ? this.registry.getById(record.projectId) : undefined;
    return project ? { id: project.id, displayName: project.displayName, environment: project.workspace?.environment.label ?? 'não configurado', policyStatus: record?.policyStatus === 'loaded' ? 'loaded' : 'unavailable' } : null;
  }

  /**
   * A joining "e" ("Usa o Neuro e vê por que X" / "Vamos pro LSB e verifica
   * Y") separates a selection clause from a trailing request in the SAME
   * clause - the part after "e" is never itself a project reference. Cutting
   * there unconditionally would break "Use Neuro e LSB" (an intentionally
   * ambiguous message naming two real projects at once, which must still be
   * refused, never silently resolved to the first one) - so the cut is only
   * taken when the part after "e" does NOT itself resolve to a registered
   * project. When it does, both sides look like project names and the
   * segment is returned unchanged, preserving the existing ambiguity refusal.
   */
  private boundedSelectionSegment(segment: string): string {
    const conjunctionSplit = /^(.*?)\s+e\s+(.*)$/.exec(segment);
    if (!conjunctionSplit) return segment;
    const [, before, after] = conjunctionSplit;
    if (this.registry.resolve(after ?? '') !== undefined) return segment;
    return before ?? segment;
  }

  public handle(conversationId: string, text: string, executionId: string, at: string): ProjectReply | undefined {
    const query = normalize(text).replace(/^sebastian\s*[, :]\s*/, '');
    // Both `select` and the loose preposition match below are read only from
    // the message's first clause (up to its first sentence break or line
    // break), further bounded at a joining "e" (see `boundedSelectionSegment`)
    // - never scanned across the whole message. Without the clause bound, in
    // a long natural message a capture running to `$` backtracks past every
    // earlier "no"/"na" (which can't reach end-of-string across a line break)
    // until it lands on the message's LAST line, misreading an unrelated
    // trailing preposition there as the actual selection command. Without the
    // "e" bound, "Usa o Neuro e vê por que X" would try to resolve "neuro e
    // vê por que x" as a single project name and fail.
    const firstClause = query.split(/[\n.!?]/, 1)[0] ?? '';
    const boundedFirstClause = this.boundedSelectionSegment(firstClause);
    const select = /^(?:agora\s+)?(?:use|usa|usar|selecione|selecionar|mude para|troque para)\s+(?:(?:o|a|projeto)\s+)*(.*?)$/.exec(boundedFirstClause);
    // A single clause can still be a long natural sentence that merely ends
    // with a common idiom built on one of these prepositions ("...na
    // prática?", "...do jeito certo") without being a project reference at
    // all. Confirmed false positive: "o que você consegue fazer por mim
    // diretamente nele agora, na prática?" matched "na" and captured
    // "prática" as a project name, misfiring into "Projeto desconhecido".
    // Genuine selection commands ("vamos trabalhar no Neuro Hub Pro", "agora
    // vamos pro LSB") are short imperative phrases, so the loose match is
    // only attempted when the (already "e"-bounded) clause is short enough to
    // plausibly be one.
    const MAX_LOOSE_PROJECT_REFERENCE_WORDS = 8;
    const boundedFirstClauseWordCount = boundedFirstClause.split(/\s+/).filter(Boolean).length;
    const inProject =
      boundedFirstClauseWordCount <= MAX_LOOSE_PROJECT_REFERENCE_WORDS
        ? /\b(?:no|na|do|da|pro|para\s+o|para\s+a|projeto)\s+(.+)$/.exec(boundedFirstClause)
        : null;
    const isIdentity = /qual projeto.*ativ|em qual projeto|onde (?:estamos|estou)/.test(query);
    const reference = select?.[1] ?? (!isIdentity && inProject && !/^(?:projeto|conversa|momento|sistema|codigo)$/.test(inProject[1] ?? '') ? inProject[1] : undefined);
    const direct = this.registry.resolve(query);
    // Whether this turn's selection clause left something behind - either the
    // "e" bound cut off a trailing request, or the first clause itself wasn't
    // the whole message (more sentences/lines follow). Only meaningful when a
    // selection actually happened this turn; a steady-state message (no new
    // selection at all) is handled by `taskConnectionPending` below on its
    // own, unconditionally.
    const newSelectionThisTurn = reference !== undefined || direct !== undefined;
    const hasRemainderThisTurn =
      newSelectionThisTurn && (boundedFirstClause !== firstClause || query.length > firstClause.length);
    let active = this.active(conversationId);
    if (reference !== undefined || direct) {
      const target = direct ?? this.registry.resolve(reference!);
      if (!target) return { project: active, message: 'Projeto desconhecido ou ambíguo. Indique um único nome cadastrado: ' + this.registry.listDescriptors().map(item => item.displayName).join(', ') + '. A seleção anterior não foi alterada.' };
      // Persist identity before policy loading: failure must never leave the previous project's rules active.
      this.store.writeRecord(SELECTIONS, conversationId, { conversationId, projectId: target.id, policyStatus: 'unavailable', selectedAt: at });
      active = this.active(conversationId);
    }
    if (!active) return isIdentity || /regras.*projeto/.test(query) ? { project: null, message: 'Nenhum projeto está ativo nesta conversa. Diga “Use o Neuro”, “Use o LSB” ou “Use o Sebastian”.' } : undefined;
    const project = this.registry.getById(active.id)!;
    try {
      const policies = loadProjectPolicies(project, this.environmentId, text);
      this.store.writeRecord(SELECTIONS, conversationId, { conversationId, projectId: project.id, policyStatus: 'loaded', selectedAt: at });
      this.store.writeRecord(AUDIT, randomUUID(), { conversationId, executionId, projectId: project.id, environmentId: this.environmentId, at, sources: policies.map(({ path, hash }) => ({ path, hash })) });
      const loaded = this.active(conversationId);
      if (/regras|politica|diretrizes/.test(query)) {
        const sections = policies.map(policy => {
          const sections = policy.content.split(/(?=^#{1,4}\s)/m).filter(section => /banco|migration|homologa|bolt|psique|novidades|commit|push|seguran|custos/i.test(section.split('\n')[0] ?? '')).slice(0, 7);
          const excerpts = sections.map(section => {
            const [heading, ...body] = section.split(/\r?\n/);
            const paragraphs = body.join('\n').split(/\n\s*\n/).map(paragraph => paragraph.trim()).filter(paragraph => paragraph && paragraph !== '---');
            const normative = paragraphs.find(paragraph => /nunca|obrigat|autoriza|deve|antes|somente|percept|migration|homologa/i.test(paragraph)) ?? paragraphs[0] ?? '';
            return `• ${heading?.replace(/^#+\s*/, '')}: ${normative.length > 360 ? normative.slice(0, 360) + '…' : normative}`;
          });
          return `${policy.path}\n${excerpts.join('\n') || policy.content.slice(0, 450)}`;
        });
        return { project: loaded, message: `Projeto: ${project.displayName}. Fontes canônicas carregadas integralmente; abaixo, trechos resumidos para consulta:\n${sections.join('\n')}\nAs versões das regras foram registradas. O resumo não substitui as fontes completas nem autoriza ações fora do seu pedido. Nesta etapa, apenas identificação e leitura de regras.` };
      }
      const explicitSelection = select || direct || isIdentity;
      // A bare selection with nothing left over ("vamos trabalhar no Neuro
      // Hub Pro" alone) must still end here, exactly as before - only a
      // selection that left something behind (`hasRemainderThisTurn`)
      // continues. In the steady-state case (no new selection this turn at
      // all - `newSelectionThisTurn` false), any message that isn't itself an
      // explicit identity/rules query is the same "nothing to add" situation
      // Etapa 1 already left unaddressed, so it always continues.
      const taskConnectionPending = newSelectionThisTurn ? hasRemainderThisTurn : !explicitSelection;
      return {
        project: loaded,
        message: `Projeto: ${project.displayName}. Ambiente: ${active.environment}. Checkout: ${project.workspace!.root}. Regras-base carregadas: ${policies.map(policy => policy.path).join(', ')}.\n${explicitSelection ? 'Seleção associada somente a esta conversa.' : 'Identifiquei o projeto e suas regras.'}`,
        ...(taskConnectionPending ? { taskConnectionPending: true } : {}),
      };
    } catch (error) {
      this.store.writeRecord(SELECTIONS, conversationId, { conversationId, projectId: project.id, policyStatus: 'unavailable', selectedAt: at });
      return { project: this.active(conversationId), message: `Projeto: ${project.displayName}. ${error instanceof Error ? error.message : 'Regras indisponíveis.'} Nenhuma regra do projeto anterior foi reaproveitada e nenhuma ação foi executada.` };
    }
  }
}
