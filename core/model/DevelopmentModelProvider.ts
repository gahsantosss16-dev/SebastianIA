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
  FILESYSTEM_CREATE_TEXT_FILE_TOOL_ID,
  FILESYSTEM_APPEND_TEXT_FILE_TOOL_ID,
  FILESYSTEM_DESCRIBE_WORKSPACE_TOOL_ID,
  FILESYSTEM_REPLACE_TEXT_TOOL_ID,
} from '../tool/LocalFilesystemInspectionTool.js';
import { GIT_STATUS_TOOL_ID, GIT_DIFF_TOOL_ID } from '../tool/LocalGitInspectionTool.js';
import {
  VALIDATION_TEST_TOOL_ID,
  VALIDATION_BUILD_TOOL_ID,
  VALIDATION_TYPECHECK_TOOL_ID,
} from '../tool/LocalAuthorizedCommandTool.js';
import type { DevelopmentTaskPlan } from '../development/DevelopmentTaskContract.js';
import {
  ConversationContextComposer,
  type ComposedConversationContext,
  type RelevantMemoryMatch,
} from './ConversationContextComposer.js';

const REMEMBER_MARKER = 'lembra que';
const LIST_DIRECTORY_MARKER = 'arquivos existem';
const READ_FILE_MARKER = 'leia o arquivo';
const ADD_TASK_MARKER = 'adiciona uma tarefa';
const LIST_TASKS_MARKER = 'minhas tarefas';
const COMPLETE_TASK_PATTERN = /marca\s+(.+?)\s+como feita/i;
const DESCRIBE_WORKSPACE_MARKER = 'qual projeto';
const CREATE_TEXT_FILE_PATTERN = /crie (?:uma nota|um arquivo) chamad[ao]\s+(.+?)\s+com:\s*(.+)$/i;
const APPEND_TEXT_FILE_PATTERN = /acrescente (?:na nota|no arquivo)\s+(.+?):\s*(.+)$/i;
const REPLACE_TEXT_PATTERN = /altere o arquivo\s+(.+?)\s+substituindo\s+(.+?)\s+por\s+(.+)$/i;
const GIT_DIFF_MARKER = 'alterações atuais';
const RUN_TEST_MARKER = 'execute os testes';
const RUN_BUILD_MARKER = 'execute o build';
const RUN_TYPECHECK_MARKER = 'execute o typecheck';
/**
 * Recognizes a single, combined development-task request: "no arquivo X,
 * substitua Y por Z e execute <validação>" - proving the SPEC-044 multi-step
 * orchestration (edit → validate → git status → git diff → report) end to
 * end from one deterministic marker. Deliberately narrow, exactly like every
 * other pattern in this file - a real ModelProvider replaces this entirely
 * behind the same `developTask` decision shape.
 */
const DEVELOP_TASK_PATTERN =
  /no arquivo\s+(.+?),\s*substitua\s+(.+?)\s+por\s+(.+?)\s+e execute\s+(os testes|o build|o typecheck)\.?\s*$/i;
const DEVELOP_TASK_VALIDATION_TOOL_IDS: Readonly<Record<string, string>> = {
  'os testes': VALIDATION_TEST_TOOL_ID,
  'o build': VALIDATION_BUILD_TOOL_ID,
  'o typecheck': VALIDATION_TYPECHECK_TOOL_ID,
};
const MAX_TASK_CONTENT_LENGTH = 500;
const MAX_LISTED_PENDING_TASKS = 500;
const NO_MATCH_ANSWER = 'Ainda não sei responder a isso.';
const NO_MEMORY_ANSWER = 'Ainda não tenho nenhuma memória registrada sobre isso.';
const NO_PENDING_TASKS_ANSWER = 'Você não tem nenhuma tarefa pendente.';

/** An answer paired with whether it is worth recording as recent conversation context - see ModelInterpretationRespondDecision.recordable. */
interface RecordableAnswer {
  readonly answer: string;
  readonly recordable: boolean;
}

/**
 * Local, deterministic, zero-cost implementation of the ModelProvider
 * contract. It exists to prove the conversational pipeline end-to-end during
 * development and testing - it is not a general-purpose chatbot and is
 * expected to be replaced by a real provider behind the same contract once
 * the product reaches production.
 */
export class DevelopmentModelProvider implements ModelProvider {
  private readonly contextComposer: ConversationContextComposer;

  public constructor(contextComposer: ConversationContextComposer = new ConversationContextComposer()) {
    this.contextComposer = contextComposer;
  }

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

    if (request.text.toLowerCase().includes(DESCRIBE_WORKSPACE_MARKER)) {
      return { intent: 'useTool', toolId: FILESYSTEM_DESCRIBE_WORKSPACE_TOOL_ID, toolInput: {} };
    }

    const createTextFile = this.extractCreateTextFileRequest(request.text);
    if (createTextFile !== undefined) {
      return { intent: 'useTool', toolId: FILESYSTEM_CREATE_TEXT_FILE_TOOL_ID, toolInput: createTextFile };
    }

    const appendTextFile = this.extractAppendTextFileRequest(request.text);
    if (appendTextFile !== undefined) {
      return { intent: 'useTool', toolId: FILESYSTEM_APPEND_TEXT_FILE_TOOL_ID, toolInput: appendTextFile };
    }

    const developTaskPlan = this.extractDevelopTaskPlan(request.text);
    if (developTaskPlan !== undefined) {
      return { intent: 'developTask', plan: developTaskPlan };
    }

    const replaceTextRequest = this.extractReplaceTextRequest(request.text);
    if (replaceTextRequest !== undefined) {
      return { intent: 'useTool', toolId: FILESYSTEM_REPLACE_TEXT_TOOL_ID, toolInput: replaceTextRequest };
    }

    const lowerText = request.text.toLowerCase();

    if (lowerText.includes('estado') && lowerText.includes('repositório')) {
      return { intent: 'useTool', toolId: GIT_STATUS_TOOL_ID, toolInput: {} };
    }

    if (lowerText.includes(GIT_DIFF_MARKER)) {
      return { intent: 'useTool', toolId: GIT_DIFF_TOOL_ID, toolInput: {} };
    }

    if (lowerText.includes(RUN_TEST_MARKER)) {
      return { intent: 'useTool', toolId: VALIDATION_TEST_TOOL_ID, toolInput: {} };
    }

    if (lowerText.includes(RUN_BUILD_MARKER)) {
      return { intent: 'useTool', toolId: VALIDATION_BUILD_TOOL_ID, toolInput: {} };
    }

    if (lowerText.includes(RUN_TYPECHECK_MARKER)) {
      return { intent: 'useTool', toolId: VALIDATION_TYPECHECK_TOOL_ID, toolInput: {} };
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

    const composed = this.contextComposer.compose({
      text: request.text,
      rememberedFacts: request.rememberedFacts,
      recentExchanges: request.recentExchanges ?? [],
    });

    if (composed.intent === 'resumptionReference') {
      return { intent: 'respond', ...this.composeResumptionAnswer(composed) };
    }

    if (composed.intent === 'continuationReference') {
      return { intent: 'respond', ...this.composeContinuationAnswer(composed) };
    }

    if (composed.intent === 'question') {
      return { intent: 'respond', ...this.composeMemoryAnswer(composed) };
    }

    return { intent: 'respond', answer: NO_MATCH_ANSWER, recordable: false };
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

  /**
   * Minimal, deliberately narrow recognition of "create a note/file named X
   * with: Y" proving the fs.createTextFile intent end-to-end. Actual
   * overwrite protection and content limits are enforced by the Tool, not
   * here - this only extracts the two free-form fragments.
   */
  private extractCreateTextFileRequest(text: string): Readonly<Record<string, unknown>> | undefined {
    const match = text.match(CREATE_TEXT_FILE_PATTERN);
    const rawPath = match?.[1];
    const rawContent = match?.[2];
    if (rawPath === undefined || rawContent === undefined) {
      return undefined;
    }

    const path = this.cleanPathFragment(rawPath);
    const content = rawContent.trim();
    return path === '' || content === '' ? undefined : { path, content };
  }

  /** Minimal, deliberately narrow recognition of "append to note/file X: Y" proving the fs.appendTextFile intent end-to-end. */
  private extractAppendTextFileRequest(text: string): Readonly<Record<string, unknown>> | undefined {
    const match = text.match(APPEND_TEXT_FILE_PATTERN);
    const rawPath = match?.[1];
    const rawContent = match?.[2];
    if (rawPath === undefined || rawContent === undefined) {
      return undefined;
    }

    const path = this.cleanPathFragment(rawPath);
    const content = rawContent.trim();
    return path === '' || content === '' ? undefined : { path, content };
  }

  /**
   * Minimal, deliberately narrow recognition of "altere o arquivo X
   * substituindo Y por Z" proving the fs.replaceText intent end-to-end.
   * Occurrence-count validation (not found / ambiguous) is entirely the
   * Tool's responsibility, not this extraction.
   */
  private extractReplaceTextRequest(text: string): Readonly<Record<string, unknown>> | undefined {
    const match = text.match(REPLACE_TEXT_PATTERN);
    const rawPath = match?.[1];
    const rawSearchText = match?.[2];
    const rawReplaceText = match?.[3];
    if (rawPath === undefined || rawSearchText === undefined || rawReplaceText === undefined) {
      return undefined;
    }

    const path = this.cleanPathFragment(rawPath);
    const searchText = rawSearchText.trim();
    const replaceText = rawReplaceText.trim();
    return path === '' || searchText === '' ? undefined : { path, searchText, replaceText };
  }

  /**
   * Minimal, deliberately narrow recognition of "no arquivo X, substitua Y
   * por Z e execute <validação>" proving the SPEC-044 developTask
   * orchestration end-to-end. The resulting plan is fully structured and
   * bounded (edit → validate → git status → git diff) - this method only
   * extracts the free-form fragments and picks the right validation toolId;
   * every safety decision during execution belongs to the orchestrator and
   * the underlying Tools, not to this recognition step.
   */
  private extractDevelopTaskPlan(text: string): DevelopmentTaskPlan | undefined {
    const match = text.match(DEVELOP_TASK_PATTERN);
    const rawPath = match?.[1];
    const rawSearchText = match?.[2];
    const rawReplaceText = match?.[3];
    const rawValidation = match?.[4];
    if (rawPath === undefined || rawSearchText === undefined || rawReplaceText === undefined || rawValidation === undefined) {
      return undefined;
    }

    const path = this.cleanPathFragment(rawPath);
    const searchText = this.stripSurroundingQuotes(rawSearchText);
    const replaceText = this.stripSurroundingQuotes(rawReplaceText);
    const validationToolId = DEVELOP_TASK_VALIDATION_TOOL_IDS[rawValidation.toLowerCase()];
    if (path === '' || searchText === '' || validationToolId === undefined) {
      return undefined;
    }

    return this.buildDevelopTaskPlan(path, searchText, replaceText, validationToolId);
  }

  private buildDevelopTaskPlan(
    path: string,
    searchText: string,
    replaceText: string,
    validationToolId: string,
  ): DevelopmentTaskPlan {
    return {
      objective: `Substituir texto em "${path}" e executar a validação "${validationToolId}".`,
      steps: [
        {
          stepId: 'edit',
          description: `Substituir o texto indicado em "${path}".`,
          toolId: FILESYSTEM_REPLACE_TEXT_TOOL_ID,
          toolInput: { path, searchText, replaceText },
        },
        {
          stepId: 'validate',
          description: `Executar a validação "${validationToolId}".`,
          toolId: validationToolId,
          toolInput: {},
        },
        {
          stepId: 'status',
          description: 'Consultar o estado do repositório Git após a alteração.',
          toolId: GIT_STATUS_TOOL_ID,
          toolInput: {},
        },
        {
          stepId: 'diff',
          description: 'Consultar o diff atual do repositório Git após a alteração.',
          toolId: GIT_DIFF_TOOL_ID,
          toolInput: {},
        },
      ],
    };
  }

  private stripSurroundingQuotes(fragment: string): string {
    return fragment.trim().replace(/^["'“”]+|["'“”]+$/g, '');
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

  /**
   * Answers a question using genuinely relevant memory (keyword-overlap
   * selection from ConversationContextComposer) when any was found -
   * otherwise degrades gracefully to the most recent remembered fact, which
   * is what this method did unconditionally before this block. That fallback
   * keeps a vague, keyword-less question ("O que você sabe sobre mim?")
   * still answerable instead of refusing outright.
   */
  private composeMemoryAnswer(composed: ComposedConversationContext): RecordableAnswer {
    const [top] = composed.relevantMemories;
    if (top) {
      return { answer: this.describeSingleMatch(top), recordable: true };
    }

    if (composed.mostRecentFact) {
      return { answer: `Sobre isso, você registrou: "${composed.mostRecentFact.content}".`, recordable: true };
    }

    return { answer: NO_MEMORY_ANSWER, recordable: false };
  }

  /**
   * "Vamos continuar meu projeto de ontem"-style requests: names a subject
   * and asks to resume it. Relevant memory (fact or past exchange) about
   * that subject, when found, is what actually drives the answer - the
   * point being that Sebastian surfaces the last known state instead of
   * asking the user to repeat it. Marked non-recordable when nothing
   * relevant was found, for the same reason as composeMemoryAnswer.
   */
  private composeResumptionAnswer(composed: ComposedConversationContext): RecordableAnswer {
    const [top] = composed.relevantMemories;
    if (!top) {
      return {
        answer: 'Ainda não tenho registros sobre esse projeto ou tarefa para retomar; me conte por onde paramos.',
        recordable: false,
      };
    }

    const answer =
      top.source === 'fact'
        ? `Retomando de onde paramos: você registrou "${top.content}".`
        : `Retomando de onde paramos: "${top.content}".`;
    return { answer, recordable: true };
  }

  /**
   * Short, generic continuation ("então continua", "e agora?") carries no
   * subject of its own - it is resolved against the single most recent
   * conversation exchange, whatever it was, so a short follow-up genuinely
   * continues the previous turn instead of being treated as an isolated,
   * unrecognized request. Marked non-recordable when there is no prior
   * exchange at all: a "nothing to continue" answer must not itself become
   * the thing a later continuation picks up - which would otherwise let the
   * same coincidental word ("continuar") in the fallback message falsely
   * match a later, unrelated resumption request.
   */
  private composeContinuationAnswer(composed: ComposedConversationContext): RecordableAnswer {
    if (composed.mostRecentExchange) {
      return { answer: `Continuando de onde paramos: ${composed.mostRecentExchange.summary}`, recordable: true };
    }

    return { answer: 'Ainda não tenho um contexto anterior para continuar.', recordable: false };
  }

  /**
   * Answers using only the single best-ranked relevant memory - deliberately
   * not a multi-item summary of everything with any overlap. A single shared
   * word is enough to rank a fact/exchange as the top candidate, but is not
   * strong enough signal to also assert several other loosely-related
   * memories are equally worth surfacing in the same answer.
   */
  private describeSingleMatch(match: RelevantMemoryMatch): string {
    return match.source === 'fact'
      ? `Sobre isso, você registrou: "${match.content}".`
      : `Sobre isso, na nossa conversa anterior: "${match.content}".`;
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

    if (request.recentExchanges !== undefined && !Array.isArray(request.recentExchanges)) {
      throw new InvalidModelInterpretationRequestError(
        'Model interpretation recentExchanges must be an array when provided.',
      );
    }

    if (typeof request.requestedAt !== 'string' || request.requestedAt.trim() === '') {
      throw new InvalidModelInterpretationRequestError('Model interpretation requestedAt must be a non-empty string.');
    }
  }
}
