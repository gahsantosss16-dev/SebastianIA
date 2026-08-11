import type {
  ModelInterpretationDecision,
  ModelInterpretationRequest,
  ModelProvider,
} from './ModelProviderContract.js';
import { InvalidModelInterpretationRequestError } from './ModelProviderContractErrors.js';

const REMEMBER_MARKER = 'lembra que';
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
