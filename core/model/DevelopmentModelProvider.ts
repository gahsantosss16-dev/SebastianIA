import type { PendingTaskRecord } from '../memory/index.js';
import type {
  ModelInterpretationDecision,
  ModelInterpretationRequest,
  ModelProvider,
} from './ModelProviderContract.js';
import { InvalidModelInterpretationRequestError } from './ModelProviderContractErrors.js';
import {
  FILESYSTEM_LIST_DIRECTORY_TOOL_ID,
  FILESYSTEM_READ_FILE_TOOL_ID,
} from '../tool/LocalFilesystemInspectionTool.js';

const REMEMBER_MARKER = 'lembra que';
const LIST_DIRECTORY_MARKER = 'arquivos existem';
const READ_FILE_MARKER = 'leia o arquivo';
const ADD_TASK_MARKER = 'adiciona uma tarefa';
const LIST_TASKS_MARKER = 'minhas tarefas';
const COMPLETE_TASK_PATTERN = /marca\s+(.+?)\s+como feita/i;
const MAX_TASK_CONTENT_LENGTH = 500;
const MAX_LISTED_PENDING_TASKS = 500;
const NO_MATCH_ANSWER = 'Ainda não sei responder a isso.';
const NO_MEMORY_ANSWER = 'Ainda não tenho nenhuma memória registrada sobre isso.';
const NO_PENDING_TASKS_ANSWER = 'Você não tem nenhuma tarefa pendente.';

/**
 * Local, deterministic, zero-cost implementation of the ModelProvider
 * contract. It exists to prove the conversational pipeline end-to-end during
 * development and testing - it is not a general-purpose chatbot and is
 * expected to be replaced by a real provider behind the same contract once
 * the product reaches production.
 */
export class DevelopmentModelProvider implements ModelProvider {
  public async interpret(request: ModelInterpretationRequest): Promise<ModelInterpretationDecision> {
    this.validateRequest(request);

    const rememberContent = this.extractRememberContent(request.text);
    if (rememberContent !== undefined) {
      return { intent: 'remember', content: rememberContent };
    }

    const addTaskContent = this.extractAddTaskContent(request.text);
    if (addTaskContent !== undefined) {
      if (addTaskContent.length > MAX_TASK_CONTENT_LENGTH) {
        return {
          intent: 'respond',
          answer: `O texto da tarefa é grande demais (limite de ${MAX_TASK_CONTENT_LENGTH} caracteres).`,
        };
      }
      return { intent: 'addTask', content: addTaskContent };
    }

    const completeTaskTarget = this.extractCompleteTaskTarget(request.text);
    if (completeTaskTarget !== undefined) {
      return this.resolveCompleteTaskDecision(completeTaskTarget, request.pendingTasks ?? []);
    }

    if (request.text.toLowerCase().includes(LIST_TASKS_MARKER)) {
      return { intent: 'respond', answer: this.composeTaskListAnswer(request.pendingTasks ?? []) };
    }

    const listDirectoryPath = this.extractListDirectoryPath(request.text);
    if (listDirectoryPath !== undefined) {
      return {
        intent: 'useTool',
        toolId: FILESYSTEM_LIST_DIRECTORY_TOOL_ID,
        toolInput: { path: listDirectoryPath },
      };
    }

    const readFilePath = this.extractReadFilePath(request.text);
    if (readFilePath !== undefined) {
      return {
        intent: 'useTool',
        toolId: FILESYSTEM_READ_FILE_TOOL_ID,
        toolInput: { path: readFilePath },
      };
    }

    if (request.text.includes('?')) {
      return { intent: 'respond', answer: this.composeAnswerFromMemory(request.rememberedFacts) };
    }

    return { intent: 'respond', answer: NO_MATCH_ANSWER };
  }

  private extractRememberContent(text: string): string | undefined {
    const markerIndex = text.toLowerCase().indexOf(REMEMBER_MARKER);
    if (markerIndex === -1) {
      return undefined;
    }

    const content = text.slice(markerIndex + REMEMBER_MARKER.length).trim();
    return content === '' ? undefined : content;
  }

  /**
   * Minimal, deliberately narrow marker recognition proving the "list a
   * directory" intent end-to-end. This is development-adapter parsing, not
   * NLU: a real ModelProvider replaces this entirely behind the same
   * structured `useTool` decision shape.
   */
  private extractListDirectoryPath(text: string): string | undefined {
    const markerIndex = text.toLowerCase().indexOf(LIST_DIRECTORY_MARKER);
    if (markerIndex === -1) {
      return undefined;
    }

    const rest = text.slice(markerIndex + LIST_DIRECTORY_MARKER.length);
    const withoutConnector = rest.trim().replace(/^(na pasta|no diret[óo]rio|na|em)\s+/i, '');
    const path = this.cleanPathFragment(withoutConnector);
    return path === '' ? '.' : path;
  }

  /** Minimal, deliberately narrow marker recognition proving the "read a file" intent end-to-end. */
  private extractReadFilePath(text: string): string | undefined {
    const markerIndex = text.toLowerCase().indexOf(READ_FILE_MARKER);
    if (markerIndex === -1) {
      return undefined;
    }

    const rest = text.slice(markerIndex + READ_FILE_MARKER.length);
    const path = this.cleanPathFragment(rest);
    return path === '' ? undefined : path;
  }

  /** Minimal, deliberately narrow marker recognition proving the "add a task" intent end-to-end. */
  private extractAddTaskContent(text: string): string | undefined {
    const markerIndex = text.toLowerCase().indexOf(ADD_TASK_MARKER);
    if (markerIndex === -1) {
      return undefined;
    }

    const rest = text.slice(markerIndex + ADD_TASK_MARKER.length).replace(/^\s*:\s*/, '');
    const content = this.cleanPathFragment(rest);
    return content === '' ? undefined : content;
  }

  /**
   * Extracts the free-form task-identifying text between "marca" and "como
   * feita" (e.g. `marca "comprar leite" como feita`). Resolution against the
   * actual pending tasks - including the not-found/ambiguous outcomes -
   * happens in resolveCompleteTaskDecision, not here.
   */
  private extractCompleteTaskTarget(text: string): string | undefined {
    const match = text.match(COMPLETE_TASK_PATTERN);
    const rawTarget = match?.[1];
    if (rawTarget === undefined) {
      return undefined;
    }

    const target = this.cleanPathFragment(rawTarget);
    return target === '' ? undefined : target;
  }

  /**
   * Exact, normalized matching only - deliberately no fuzzy matching. A
   * single match completes the task by its stable id; zero or multiple
   * matches produce a safe, friendly `respond` decision instead of guessing.
   */
  private resolveCompleteTaskDecision(
    targetText: string,
    pendingTasks: readonly PendingTaskRecord[],
  ): ModelInterpretationDecision {
    const normalizedTarget = this.normalizeForMatch(targetText);
    const matches = pendingTasks.filter((task) => this.normalizeForMatch(task.content) === normalizedTarget);

    if (matches.length === 0) {
      return {
        intent: 'respond',
        answer: `Não encontrei nenhuma tarefa pendente correspondente a "${targetText}".`,
      };
    }

    if (matches.length > 1) {
      return {
        intent: 'respond',
        answer: `Mais de uma tarefa pendente corresponde a "${targetText}"; não vou concluir nenhuma para evitar engano.`,
      };
    }

    const match = matches[0];
    if (!match) {
      return {
        intent: 'respond',
        answer: `Não encontrei nenhuma tarefa pendente correspondente a "${targetText}".`,
      };
    }

    return { intent: 'completeTask', taskId: match.id };
  }

  private composeTaskListAnswer(pendingTasks: readonly PendingTaskRecord[]): string {
    if (pendingTasks.length === 0) {
      return NO_PENDING_TASKS_ANSWER;
    }

    const listed = pendingTasks.slice(0, MAX_LISTED_PENDING_TASKS);
    const summary = `Suas tarefas pendentes: ${listed.map((task) => task.content).join(', ')}.`;

    return pendingTasks.length > MAX_LISTED_PENDING_TASKS
      ? `${summary} (mostrando ${MAX_LISTED_PENDING_TASKS} de ${pendingTasks.length} tarefas pendentes)`
      : summary;
  }

  private normalizeForMatch(text: string): string {
    return text.trim().toLowerCase();
  }

  private cleanPathFragment(fragment: string): string {
    const withoutQuotes = fragment.trim().replace(/^["'“”]+|["'“”]+$/g, '');
    return withoutQuotes.replace(/[.?!]+$/, '').trim();
  }

  private composeAnswerFromMemory(rememberedFacts: ModelInterpretationRequest['rememberedFacts']): string {
    const mostRecentFact = rememberedFacts[rememberedFacts.length - 1];
    if (!mostRecentFact) {
      return NO_MEMORY_ANSWER;
    }

    return `Sobre isso, você registrou: "${mostRecentFact.content}".`;
  }

  private validateRequest(request: ModelInterpretationRequest): void {
    const isObject = request && typeof request === 'object' && !Array.isArray(request);
    if (!isObject) {
      throw new InvalidModelInterpretationRequestError('Model interpretation request must be an object.');
    }

    if (typeof request.text !== 'string' || request.text.trim() === '') {
      throw new InvalidModelInterpretationRequestError('Model interpretation text must be a non-empty string.');
    }

    if (!Array.isArray(request.rememberedFacts)) {
      throw new InvalidModelInterpretationRequestError('Model interpretation rememberedFacts must be an array.');
    }

    if (request.pendingTasks !== undefined && !Array.isArray(request.pendingTasks)) {
      throw new InvalidModelInterpretationRequestError(
        'Model interpretation pendingTasks must be an array when provided.',
      );
    }

    if (typeof request.requestedAt !== 'string' || request.requestedAt.trim() === '') {
      throw new InvalidModelInterpretationRequestError('Model interpretation requestedAt must be a non-empty string.');
    }
  }
}
