import { randomUUID } from 'node:crypto';
import type { FileMemoryStore } from '../memory/FileMemoryStore.js';
import type { ProjectRegistry } from './ProjectRegistry.js';
import { loadProjectPolicies } from './ProjectWorkspacePolicy.js';

const SELECTIONS = 'project-conversations';
const AUDIT = 'project-policy-uses';
const normalize = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.!?]+$/g, '').trim();
export interface ActiveProject { readonly id: string; readonly displayName: string; readonly environment: string; readonly policyStatus: 'loaded' | 'unavailable'; }
export interface ProjectReply { readonly message: string; readonly project: ActiveProject | null; }

/** Conversation binding and policy provenance, using the existing registry and memory store. No executor. */
export class ProjectConversationContext {
  public constructor(public readonly registry: ProjectRegistry, private readonly store: FileMemoryStore, private readonly environmentId: string) {}

  public active(conversationId: string): ActiveProject | null {
    const record = this.store.listRecords(SELECTIONS).find(item => item.conversationId === conversationId);
    const project = typeof record?.projectId === 'string' ? this.registry.getById(record.projectId) : undefined;
    return project ? { id: project.id, displayName: project.displayName, environment: project.workspace?.environment.label ?? 'não configurado', policyStatus: record?.policyStatus === 'loaded' ? 'loaded' : 'unavailable' } : null;
  }

  public handle(conversationId: string, text: string, executionId: string, at: string): ProjectReply | undefined {
    const query = normalize(text).replace(/^sebastian\s*[, :]\s*/, '');
    const select = /^(?:agora\s+)?(?:use|usar|selecione|selecionar|mude para|troque para)\s+(?:(?:o|a|projeto)\s+)*(.*?)$/.exec(query);
    const inProject = /\b(?:no|na|do|da|projeto)\s+(.+)$/.exec(query);
    const isIdentity = /qual projeto.*ativ|em qual projeto|onde (?:estamos|estou)/.test(query);
    const reference = select?.[1] ?? (!isIdentity && inProject && !/^(?:projeto|conversa|momento|sistema|codigo)$/.test(inProject[1] ?? '') ? inProject[1] : undefined);
    const direct = this.registry.resolve(query);
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
      return { project: loaded, message: `Projeto: ${project.displayName}. Ambiente: ${active.environment}. Checkout: ${project.workspace!.root}. Regras-base carregadas: ${policies.map(policy => policy.path).join(', ')}.\n${select || direct || isIdentity ? 'Seleção associada somente a esta conversa.' : 'Identifiquei o projeto e suas regras. A análise/execução da tarefa ainda não está conectada nesta etapa; não executei ferramentas sobre o projeto.'}` };
    } catch (error) {
      this.store.writeRecord(SELECTIONS, conversationId, { conversationId, projectId: project.id, policyStatus: 'unavailable', selectedAt: at });
      return { project: this.active(conversationId), message: `Projeto: ${project.displayName}. ${error instanceof Error ? error.message : 'Regras indisponíveis.'} Nenhuma regra do projeto anterior foi reaproveitada e nenhuma ação foi executada.` };
    }
  }
}
