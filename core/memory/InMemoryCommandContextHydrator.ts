import {
  type CommandContextHydrationRequest,
  type CommandContextHydrationResult,
  type CommandContextHydrationSnapshot,
  type CommandContextHydrator,
} from './CommandContextHydrationContract.js';
import { InvalidCommandContextHydrationRequestError } from './CommandContextHydrationContractErrors.js';

export class InMemoryCommandContextHydrator implements CommandContextHydrator {
  private readonly snapshotsByScope = new Map<string, CommandContextHydrationSnapshot>();

  public hydrate(request: CommandContextHydrationRequest): CommandContextHydrationResult {
    this.validateRequest(request);

    const key = this.buildScopeKey(request.conversationId, request.sessionId);
    const snapshot = this.snapshotsByScope.get(key);
    if (!snapshot) {
      return { status: 'absent' };
    }

    return {
      status: 'hydrated',
      context: structuredClone(snapshot) as CommandContextHydrationSnapshot,
    };
  }

  public prime(
    conversationId: string | undefined,
    sessionId: string | undefined,
    snapshot: CommandContextHydrationSnapshot,
  ): void {
    const key = this.buildScopeKey(conversationId, sessionId);
    this.snapshotsByScope.set(key, structuredClone(snapshot) as CommandContextHydrationSnapshot);
  }

  private validateRequest(request: CommandContextHydrationRequest): void {
    const isObject = request && typeof request === 'object' && !Array.isArray(request);
    if (!isObject) {
      throw new InvalidCommandContextHydrationRequestError('Command context hydration request must be an object.');
    }

    if (typeof request.commandType !== 'string' || request.commandType.trim() === '') {
      throw new InvalidCommandContextHydrationRequestError('Command context hydration commandType must be a non-empty string.');
    }

    if (typeof request.generatedAt !== 'string' || request.generatedAt.trim() === '') {
      throw new InvalidCommandContextHydrationRequestError('Command context hydration generatedAt must be a non-empty string.');
    }

    if (request.conversationId !== undefined && (typeof request.conversationId !== 'string' || request.conversationId.trim() === '')) {
      throw new InvalidCommandContextHydrationRequestError('Command context hydration conversationId must be a non-empty string when provided.');
    }

    if (request.sessionId !== undefined && (typeof request.sessionId !== 'string' || request.sessionId.trim() === '')) {
      throw new InvalidCommandContextHydrationRequestError('Command context hydration sessionId must be a non-empty string when provided.');
    }
  }

  private buildScopeKey(conversationId: string | undefined, sessionId: string | undefined): string {
    return `${conversationId ?? '<none>'}:${sessionId ?? '<none>'}`;
  }
}
