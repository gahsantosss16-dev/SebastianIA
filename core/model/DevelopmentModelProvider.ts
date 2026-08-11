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
const NO_MATCH_ANSWER = 'Ainda não sei responder a isso.';
const NO_MEMORY_ANSWER = 'Ainda não tenho nenhuma memória registrada sobre isso.';

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

    if (typeof request.requestedAt !== 'string' || request.requestedAt.trim() === '') {
      throw new InvalidModelInterpretationRequestError('Model interpretation requestedAt must be a non-empty string.');
    }
  }
}
