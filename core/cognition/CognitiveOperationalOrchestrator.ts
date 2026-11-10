import { requireSynchronousToolInvocationResult, type SpecializedTool } from '../tool/index.js';
import {
  OPERATION_EVENT_RECORD_KIND,
  PENDING_OPERATION_TTL_MS,
  type PendingOperationRecord,
} from '../memory/index.js';
import type { Logger } from '../logger.js';
import type {
  CognitiveDecisionRequest,
  CognitiveModelProvider,
  CognitiveObservationRecord,
  CognitiveToolDescriptor,
} from './CognitiveModelProviderContract.js';

export const MAX_OPERATIONAL_DECISIONS = 4;

/**
 * Stored as a pending operation's `validationToolId` when its policy is
 * `resultEvidence: 'toolOutcomeOnly'`: no local validation exists for the
 * changed target, so none is ever invoked or claimed. Not a real Tool id.
 */
export const NO_LOCAL_VALIDATION_TOOL_ID = 'none.targetProjectNotValidated';
/** Extra `decide` calls the loop may spend recovering from a provider timeout (see `execute`). */
export const MAX_OPERATIONAL_DECIDE_TIMEOUT_RETRIES = 1;
const MAX_OBSERVATION_CHARS = 2_000;

export interface OperationalToolPolicyEntry extends CognitiveToolDescriptor {
  readonly requiredStringArguments: readonly string[];
  /**
   * Small, typed, backward-compatible extension: operation-only integer
   * knobs (e.g. a result-count `limit`) a deterministic route - or, if it
   * chooses to, the model itself via `decide` - may supply alongside the
   * required string arguments. Omitted entirely by default, so every
   * existing catalog entry keeps behaving exactly as before. Deliberately
   * narrow (named, whitelisted keys only, each still validated as a real
   * integer) rather than a general "any extra argument goes" escape hatch.
   */
  readonly optionalNumberArguments?: readonly string[];
  /** Optional non-empty string arguments a route may supply (e.g. a text to locate). */
  readonly optionalStringArguments?: readonly string[];
  readonly validationToolId?: string;
  /**
   * `toolOutcomeOnly`: the Tool changes an external target (e.g. a remote
   * GitHub project) that no local validation can test. The authorized run
   * then reports only the Tool's own proven outcome, never invokes a local
   * validation as if it covered that target, and never claims the change
   * was tested or "corrigido". Must not be combined with `validationToolId`.
   */
  readonly resultEvidence?: 'toolOutcomeOnly';
  readonly risk?: string;
  /**
   * Optional deterministic capability routing: when the objective matches
   * `pattern`, this Tool is invoked directly - once, before the model is
   * ever consulted - instead of trusting a model's very first
   * `concludeCompleted` decision at face value. Exists because a model can
   * otherwise answer "I don't have access to X" on its first turn without
   * ever having attempted the Tool that plainly exists for this exact class
   * of request (see SPEC discussion: bare "github?" producing a false
   * incapacity claim even though `github.*` Tools were configured and
   * never invoked). The gathered observation is fed back into the very next
   * `decide` call exactly like any other Tool observation - the model still
   * composes the final answer, never bypassed for that. Deliberately
   * generic here (a pattern + an argument builder, not "GitHub"-specific
   * code): the composing application supplies whichever routes make sense
   * for its own registered capabilities.
   */
  readonly deterministicIntent?: {
    readonly pattern: RegExp;
    /** Optional narrow continuation route evaluated only against the primary (immediately previous) context. */
    readonly immediateContext?: { readonly objectivePattern: RegExp; readonly contextPattern: RegExp };
    readonly buildArguments: (objective: string) => Readonly<Record<string, string | number>>;
    /**
     * A deterministic route may already satisfy the user's full read-only
     * intent. This formatter is the safe fallback if evidence-only cognitive
     * synthesis is absent or fails; rejected/failed Tool outcomes never use it.
     */
    readonly answerFromSuccessfulObservation?: (observation: CognitiveObservationRecord) => string;
    /**
     * Opt-in honest answer for a REJECTED deterministic observation (e.g. a
     * file not found in the explicitly named project). When present, the
     * rejection is reported as-is instead of handing the turn to `decide`,
     * which could otherwise paraphrase the user's own instructions.
     */
    readonly answerFromRejectedObservation?: (observation: CognitiveObservationRecord, objective: string) => string;
    /**
     * Opt-in, per-route escape hatch from the otherwise-unconditional
     * `synthesize()` call this formatter's answer would normally go through.
     * Omitted (the default) preserves the exact current behavior - every
     * existing route keeps calling `synthesize()` unconditionally. Return
     * `false` only when, for this specific objective, the deterministic
     * route's own arguments already fully resolved quantity/order/content
     * (e.g. an explicit, in-range commit count), so the Tool's structured
     * result needs no further LLM transformation - never for a route whose
     * observation is free-form or content the caller does not fully control
     * (this must never be set for a knowledge-retrieval-style route: recovered
     * documents are evidence, not a pre-validated final answer).
     */
    readonly requiresSynthesis?: (objective: string) => boolean;
  };
  /**
   * Opt-in, generic escape from the literal id/description term-overlap
   * fallback in `hasApplicableToolCandidate` for a capability whose own
   * description is necessarily broad (e.g. `knowledge.search`: "busca
   * trechos relevantes em bibliotecas de conhecimento configuradas" shares
   * no term with a concrete objective like "o que é X segundo Y"). When
   * present, this predicate is consulted the same way a `deterministicIntent`
   * pattern is - but it is deliberately NOT `deterministicIntent`: it never
   * triggers a pre-model Tool call and never produces an answer on its own.
   * It only widens (a) whether the operational engine is worth entering at
   * all, and (b) which untried capability the orchestrator may attempt once,
   * as evidence, if the model concludes with zero observations despite an
   * applicable capability existing (see `findRecoveryRoute`). The composing
   * application must derive this from its own real, already-configured data
   * (e.g. a cheap relevance probe against an actual indexed corpus) - never
   * from a curated per-topic keyword/phrase list.
   */
  readonly broadApplicabilityProbe?: (objective: string) => boolean | Promise<boolean>;
  /**
   * Opt-in domain vocabulary for the term-overlap fallback (pre-model gate,
   * recovery and unique-capability routing). When present, ONLY these terms
   * are compared with the objective - never the free-text `description`,
   * whose qualifiers ("atual", "texto", "projeto", "programação") are
   * ordinary words that sent plain conversation into the slow `decide` loop.
   * Matching is accent- and case-insensitive with the same light plural
   * normalization. Omitted: the original id/description overlap is kept.
   * The `description` itself is unchanged and still what `decide` sees.
   */
  readonly applicabilityTerms?: readonly string[];
}

export type CognitiveOperationalResult =
  | { readonly outcome: 'answered'; readonly answer: string; readonly toolCalls: number }
  | { readonly outcome: 'proposed'; readonly answer: string; readonly operation: PendingOperationRecord; readonly toolCalls: number }
  | { readonly outcome: 'unavailable'; readonly toolCalls: number }
  | { readonly outcome: 'blocked'; readonly reason: string; readonly toolCalls: number };

/** Bounded model → Tool → observation loop. Policy, not the model, owns authority. */
export class CognitiveOperationalOrchestrator {
  public constructor(
    private readonly tool: SpecializedTool,
    private readonly provider: CognitiveModelProvider,
    private readonly catalog: readonly OperationalToolPolicyEntry[],
    private readonly maxDecisions = MAX_OPERATIONAL_DECISIONS,
    private readonly logger?: Logger,
  ) {}

  /**
   * Cheap catalog gate before spending an operational model turn. Exact
   * deterministic routes always qualify; otherwise at least one meaningful
   * objective term must occur in a registered Tool's id/description. This is
   * capability-driven (the catalog is the source), not a phrase/topic list.
   */
  public async hasApplicableToolCandidate(objective: string, immediateContext?: string): Promise<boolean> {
    for (const entry of this.catalog) {
      if (await this.isBroadlyApplicable(entry, objective, immediateContext)) return true;
    }
    return false;
  }

  /**
   * Per-entry applicability check shared by `hasApplicableToolCandidate` (the
   * pre-model gate) and `findRecoveryRoute` (the in-loop safeguard): an exact
   * deterministic pattern/continuation match, the entry's own opt-in
   * `broadApplicabilityProbe`, or - the original, narrower fallback - at
   * least one meaningful objective term occurring in the entry's own
   * id/description.
   */
  private async isBroadlyApplicable(entry: OperationalToolPolicyEntry, objective: string, immediateContext?: string): Promise<boolean> {
    if (entry.deterministicIntent?.pattern?.test(objective) === true) return true;
    if (immediateContext !== undefined &&
      entry.deterministicIntent?.immediateContext?.objectivePattern.test(objective) === true &&
      entry.deterministicIntent.immediateContext.contextPattern.test(immediateContext) === true) return true;
    if ((await entry.broadApplicabilityProbe?.(objective)) === true) return true;
    return this.termOverlap(entry, objective);
  }

  /** Term-overlap check: the entry's declared vocabulary when present, else its id/description. */
  private termOverlap(entry: OperationalToolPolicyEntry, objective: string): boolean {
    if (entry.applicabilityTerms !== undefined) {
      const objectiveTokens = this.vocabularyTokens(objective);
      return entry.applicabilityTerms.some((term) => {
        const termTokens = [...this.vocabularyTokens(term)];
        return termTokens.length > 0 && termTokens.every((token) => objectiveTokens.has(token));
      });
    }
    const objectiveTerms = this.catalogTerms(objective);
    if (objectiveTerms.size === 0) return false;
    const capabilityTerms = this.catalogTerms(`${entry.toolId} ${entry.description}`);
    return [...objectiveTerms].some((term) => capabilityTerms.has(term));
  }

  private vocabularyTokens(text: string): ReadonlySet<string> {
    const tokens = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{N}]+/u).filter((term) => term !== '');
    return new Set(tokens.map((term) => (term.length > 4 && term.endsWith('s') ? term.slice(0, -1) : term)));
  }

  /**
   * Bounded, schema-driven safety net for a model that concludes with zero
   * observations despite an applicable, never-tried capability (see the
   * `execute` `concludeCompleted` branch). Deliberately narrow: it only ever
   * auto-invokes a catalog entry whose own declared shape needs no argument
   * guessing (`requiredStringArguments` is empty, or exactly `['query']`,
   * which the objective itself safely fills) - never a write-authorized
   * entry, and never when more than one such entry is applicable (ambiguity
   * is left to `decide`, exactly like `findUniqueCapabilityMatchRoute`).
   * Whatever this recovers is still just one more observation fed back into
   * the ordinary loop - it never produces an answer directly and never
   * skips `synthesize()`.
   */
  private async findRecoveryRoute(objective: string, immediateContext?: string): Promise<OperationalToolPolicyEntry | undefined> {
    const candidates: OperationalToolPolicyEntry[] = [];
    for (const entry of this.catalog) {
      if (entry.requiresAuthorization) continue;
      const shape = entry.requiredStringArguments;
      const invokableWithoutGuessing = shape.length === 0 || (shape.length === 1 && shape[0] === 'query');
      if (invokableWithoutGuessing && await this.isBroadlyApplicable(entry, objective, immediateContext)) candidates.push(entry);
    }
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  private async attemptRecoveryObservation(
    objective: string,
    context: { readonly executionId: string; readonly responsibilityId: string; readonly requestedAt: string; readonly immediateContext?: string },
    observations: CognitiveObservationRecord[],
  ): Promise<boolean> {
    const route = await this.findRecoveryRoute(objective, context.immediateContext);
    if (!route) return false;
    const args = route.requiredStringArguments.length === 0 ? {} : { query: objective };
    const invocation = await this.tool.invoke({
      toolId: route.toolId,
      executionId: context.executionId,
      responsibilityId: context.responsibilityId,
      requestedAt: context.requestedAt,
      payload: args,
    });
    if (invocation.status !== 'completed') {
      observations.push({ stepId: 'operational:recovery', toolId: route.toolId, outcome: 'failed', summary: 'A ferramenta de recuperação não concluiu.' });
      return true;
    }
    const message = typeof invocation.output.message === 'string'
      ? invocation.output.message.slice(0, MAX_OBSERVATION_CHARS)
      : 'A ferramenta concluiu sem uma mensagem descritiva.';
    observations.push({
      stepId: 'operational:recovery',
      toolId: route.toolId,
      outcome: invocation.output.outcome === 'ok' ? 'ok' : 'rejected',
      summary: message,
    });
    return true;
  }

  private catalogTerms(text: string): ReadonlySet<string> {
    const ignored = new Set(['para', 'como', 'qual', 'quais', 'esse', 'essa', 'isso', 'uma', 'por', 'com', 'sem']);
    const tokens = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 4 && !ignored.has(term));
    // Lightweight singular/plural normalization (strip one trailing "s" from
    // a term longer than 4 characters) - not real stemming, just enough that
    // an objective phrased in the singular ("commit") still matches a
    // catalog description phrased in the plural ("commits"), on either side
    // of the comparison, since both the objective and the capability text
    // are tokenized through this same method.
    return new Set(tokens.map((term) => (term.length > 4 && term.endsWith('s') ? term.slice(0, -1) : term)));
  }

  public async execute(
    objective: string,
    context: { readonly executionId: string; readonly responsibilityId: string; readonly requestedAt: string; readonly relevantMemory?: readonly { readonly content: string }[]; readonly immediateContext?: string; readonly activeProjectId?: string; readonly signal?: AbortSignal },
  ): Promise<CognitiveOperationalResult> {
    const observations: CognitiveObservationRecord[] = [];
    let toolCalls = 0;

    const deterministic = await this.applyDeterministicIntentRoute(objective, context, observations);
    toolCalls += deterministic.toolCalls;
    if (deterministic.answer !== undefined) {
      return this.finish({ outcome: 'answered', answer: deterministic.answer, toolCalls });
    }

    // At most one extra `decide` per execution, and only after a genuine
    // provider timeout (never after caller cancellation, never after
    // `unavailable`/`invalidResponse`). If the retry also fails, the run still
    // ends as `unavailable` exactly as before - the failure is not masked.
    let timeoutRetryAvailable = true;
    for (let attempt = 0; attempt < this.maxDecisions; attempt += 1) {
      let result;
      try {
        const decisionRequest = this.request(objective, context.requestedAt, observations, context.relevantMemory ?? [], context.signal);
        result = await this.provider.decide(decisionRequest);
        if (result.outcome === 'timeout' && timeoutRetryAvailable && context.signal?.aborted !== true) {
          timeoutRetryAvailable = false;
          this.logger?.warn('Cognitive operational decision timed out; retrying once.', { attempt, toolCalls });
          result = await this.provider.decide(decisionRequest);
          this.logger?.info('Cognitive operational decision retry completed.', { attempt, outcome: result.outcome });
        }
      } catch {
        this.logStep(attempt, { nextAction: 'n/a', toolId: undefined, toolInvoked: false, toolOutcome: undefined }, toolCalls);
        return this.finish({ outcome: 'unavailable', toolCalls });
      }
      if (result.outcome !== 'decided') {
        this.logStep(attempt, { nextAction: 'n/a', toolId: undefined, toolInvoked: false, toolOutcome: undefined }, toolCalls);
        return this.finish(
          result.outcome === 'unavailable' || result.outcome === 'timeout'
            ? { outcome: 'unavailable', toolCalls }
            : { outcome: 'blocked', reason: 'cognitiveInvalidResponse', toolCalls },
        );
      }

      const decision = result.decision;
      if (decision.nextAction === 'concludeCompleted') {
        this.logStep(attempt, { nextAction: decision.nextAction, toolId: undefined, toolInvoked: false, toolOutcome: undefined }, toolCalls);
        const successfulObservations = observations.filter((observation) => observation.outcome === 'ok');
        if (successfulObservations.length > 0 && successfulObservations.length === observations.length) {
          const evidenceFallback = successfulObservations.map((observation) => observation.summary).join('\n');
          const answer = await this.synthesizeOrFallback(objective, context, successfulObservations, evidenceFallback);
          return this.finish({ outcome: 'answered', answer, toolCalls });
        }
        // A conclusion with literally zero attempts, while a real capability
        // remains applicable and untried, is never accepted at face value -
        // see `findRecoveryRoute`. This spends at most one extra Tool call
        // and one extra `decide` turn (still within `maxDecisions`), and only
        // when unambiguous; a genuinely ambiguous or ordinary "nothing
        // applies" conclusion is unaffected.
        if (observations.length === 0 && attempt < this.maxDecisions - 1 &&
          await this.attemptRecoveryObservation(objective, context, observations)) {
          toolCalls += 1;
          continue;
        }
        return this.finish(
          decision.finalAnswer
            ? { outcome: 'answered', answer: decision.finalAnswer, toolCalls }
            : { outcome: 'blocked', reason: 'cognitiveMissingFinalAnswer', toolCalls },
        );
      }
      if (decision.nextAction !== 'invokeTool' || !decision.toolId) {
        this.logStep(attempt, { nextAction: decision.nextAction, toolId: decision.toolId, toolInvoked: false, toolOutcome: undefined }, toolCalls);
        return this.finish({ outcome: 'blocked', reason: 'cognitiveNoActionableDecision', toolCalls });
      }

      const policy = this.catalog.find((entry) => entry.toolId === decision.toolId);
      if (!policy) {
        this.logStep(attempt, { nextAction: decision.nextAction, toolId: decision.toolId, toolInvoked: false, toolOutcome: undefined }, toolCalls);
        return this.finish({ outcome: 'blocked', reason: 'cognitiveToolNotInMenu', toolCalls });
      }
      const args = decision.toolId.startsWith('github.') && context.activeProjectId !== undefined
        ? { ...(decision.toolArguments ?? {}), projectId: context.activeProjectId }
        : decision.toolArguments ?? {};
      if (!this.argumentsMatchPolicy(policy, args)) {
        this.logStep(attempt, { nextAction: decision.nextAction, toolId: decision.toolId, toolInvoked: false, toolOutcome: undefined }, toolCalls);
        return this.finish({ outcome: 'blocked', reason: 'cognitiveInvalidToolArguments', toolCalls });
      }
      if (policy.requiresAuthorization) {
        const validationToolId = policy.validationToolId;
        const outcomeOnly = policy.resultEvidence === 'toolOutcomeOnly';
        if (outcomeOnly ? validationToolId !== undefined : (!validationToolId || !this.catalog.some((entry) => entry.toolId === validationToolId && !entry.requiresAuthorization))) {
          this.logStep(attempt, { nextAction: decision.nextAction, toolId: decision.toolId, toolInvoked: false, toolOutcome: undefined }, toolCalls);
          return this.finish({ outcome: 'blocked', reason: 'validationUnavailable', toolCalls });
        }
        const operation = this.proposal(objective, context.executionId, context.requestedAt, policy, args);
        this.logStep(attempt, { nextAction: decision.nextAction, toolId: decision.toolId, toolInvoked: false, toolOutcome: undefined }, toolCalls);
        return this.finish({
          outcome: 'proposed',
          operation,
          toolCalls,
          answer: outcomeOnly
            ? `Proponho ${operation.proposedAction}. ` +
              `Escopo: ${operation.toolId} ${JSON.stringify(operation.toolArguments)}. ` +
              `Risco: ${operation.risk}. Esta operação não executa testes do projeto alterado; ` +
              'informarei somente o resultado confirmado pela ferramenta. Posso executar essa operação?'
            : `Encontrei uma correção possível. Proponho ${operation.proposedAction}. ` +
              `Escopo: ${operation.toolId} ${JSON.stringify(operation.toolArguments)}. ` +
              `Risco: ${operation.risk}. Posso executar e validar essa alteração?`,
        });
      }
      const invocation = await this.tool.invoke({
        toolId: policy.toolId,
        executionId: context.executionId,
        responsibilityId: context.responsibilityId,
        requestedAt: context.requestedAt,
        payload: args,
      });
      toolCalls += 1;
      if (invocation.status !== 'completed') {
        this.logStep(attempt, { nextAction: decision.nextAction, toolId: decision.toolId, toolInvoked: true, toolOutcome: 'failed' }, toolCalls);
        return this.finish({ outcome: 'blocked', reason: 'toolFailure', toolCalls });
      }
      const message = typeof invocation.output.message === 'string'
        ? invocation.output.message.slice(0, MAX_OBSERVATION_CHARS)
        : 'A ferramenta concluiu sem uma mensagem descritiva.';
      const toolOutcome = invocation.output.outcome === 'ok' ? 'ok' : 'rejected';
      observations.push({
        stepId: `operational:${toolCalls}`,
        toolId: policy.toolId,
        outcome: toolOutcome,
        summary: message,
      });
      this.logStep(attempt, { nextAction: decision.nextAction, toolId: decision.toolId, toolInvoked: true, toolOutcome }, toolCalls);
    }

    return this.finish({ outcome: 'blocked', reason: 'cognitiveBudgetExceeded', toolCalls });
  }

  /**
   * Runs at most once per `execute` call, before the model is ever asked
   * anything. Returns how many Tool calls it made (0 or 1) so the caller can
   * fold that into its own running `toolCalls` count.
   */
  private async applyDeterministicIntentRoute(
    objective: string,
    context: { readonly executionId: string; readonly responsibilityId: string; readonly requestedAt: string; readonly relevantMemory?: readonly { readonly content: string }[]; readonly immediateContext?: string },
    observations: CognitiveObservationRecord[],
  ): Promise<{ readonly toolCalls: number; readonly answer?: string }> {
    const primaryContext = context.immediateContext;
    const route = this.catalog.find((entry) => {
      const deterministic = entry.deterministicIntent;
      if (!deterministic) return false;
      if (deterministic.pattern.test(objective)) return true;
      return primaryContext !== undefined &&
        deterministic.immediateContext?.objectivePattern.test(objective) === true &&
        deterministic.immediateContext.contextPattern.test(primaryContext) === true;
    }) ?? this.findUniqueCapabilityMatchRoute(objective);
    if (!route?.deterministicIntent) {
      return { toolCalls: 0 };
    }
    const args = route.deterministicIntent.buildArguments(objective);
    if (!this.argumentsMatchPolicy(route, args)) {
      return { toolCalls: 0 };
    }

    const invocation = await this.tool.invoke({
      toolId: route.toolId,
      executionId: context.executionId,
      responsibilityId: context.responsibilityId,
      requestedAt: context.requestedAt,
      payload: args,
    });
    if (invocation.status !== 'completed') {
      this.logger?.info('Cognitive operational deterministic route completed.', {
        toolId: route.toolId,
        toolInvoked: true,
        toolOutcome: 'failed',
      });
      return { toolCalls: 1 };
    }
    const message = typeof invocation.output.message === 'string'
      ? invocation.output.message.slice(0, MAX_OBSERVATION_CHARS)
      : 'A ferramenta concluiu sem uma mensagem descritiva.';
    const toolOutcome = invocation.output.outcome === 'ok' ? 'ok' : 'rejected';
    observations.push({
      stepId: 'operational:deterministic',
      toolId: route.toolId,
      outcome: toolOutcome,
      summary: message,
    });
    this.logger?.info('Cognitive operational deterministic route completed.', {
      toolId: route.toolId,
      toolInvoked: true,
      toolOutcome,
    });
    const successfulObservation = observations[observations.length - 1]!;
    if (toolOutcome === 'rejected' && route.deterministicIntent.answerFromRejectedObservation !== undefined) {
      return { toolCalls: 1, answer: route.deterministicIntent.answerFromRejectedObservation(successfulObservation, objective) };
    }
    const fallbackAnswer = toolOutcome === 'ok'
      ? route.deterministicIntent.answerFromSuccessfulObservation?.(successfulObservation)
      : undefined;
    if (fallbackAnswer === undefined) {
      return { toolCalls: 1 };
    }
    // Opt-in fast path (see `requiresSynthesis` on `deterministicIntent`):
    // skip the LLM round-trip entirely when this specific objective's
    // deterministic arguments already fully resolved quantity/order/content,
    // so the Tool's own structured, already-correct result is the answer.
    if (route.deterministicIntent.requiresSynthesis?.(objective) === false) {
      this.logger?.info('Cognitive operational synthesis completed.', { outcome: 'skippedDeterministic', fallbackUsed: false });
      return { toolCalls: 1, answer: fallbackAnswer };
    }
    const answer = await this.synthesizeOrFallback(objective, context, [successfulObservation], fallbackAnswer);
    return { toolCalls: 1, answer };
  }

  /**
   * Generalizes deterministic pre-fetch beyond a per-entry literal `pattern`
   * regex: when the objective's meaningful terms overlap exactly one
   * deterministic-capable catalog entry's own id/description (the same
   * capability-driven term matching `hasApplicableToolCandidate` already
   * uses to decide whether the operational engine is even worth trying),
   * that single entry is the answer regardless of the specific wording used
   * - e.g. "quais os últimos 3 commits?" never says "github", but "commits"
   * uniquely names `github.listCommits` among configured capabilities. Never
   * fires on an ambiguous (more than one matching entry) or empty overlap,
   * so it only ever resolves cases a human reading the catalog would call
   * unambiguous - anything murkier still goes through `decide`.
   */
  private findUniqueCapabilityMatchRoute(objective: string): OperationalToolPolicyEntry | undefined {
    const candidates = this.catalog.filter((entry) => entry.deterministicIntent !== undefined && this.termOverlap(entry, objective));
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  private async synthesizeOrFallback(
    objective: string,
    context: { readonly requestedAt: string; readonly signal?: AbortSignal },
    observations: readonly CognitiveObservationRecord[],
    fallbackAnswer: string,
  ): Promise<string> {
    if (typeof this.provider.synthesize !== 'function') {
      this.logger?.info('Cognitive operational synthesis completed.', { outcome: 'notConfigured', fallbackUsed: true });
      return fallbackAnswer;
    }
    try {
      const result = await this.provider.synthesize({
        objective,
        observations,
        requestedAt: context.requestedAt,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      if (result.outcome === 'synthesized' && result.answer.trim() !== '') {
        this.logger?.info('Cognitive operational synthesis completed.', { outcome: 'synthesized', fallbackUsed: false });
        return result.answer.trim();
      }
      this.logger?.info('Cognitive operational synthesis completed.', { outcome: result.outcome, fallbackUsed: true });
    } catch {
      this.logger?.info('Cognitive operational synthesis completed.', { outcome: 'unavailable', fallbackUsed: true });
    }
    return fallbackAnswer;
  }

  public async executeAuthorized(
    operation: PendingOperationRecord,
    context: { readonly executionId: string; readonly responsibilityId: string; readonly requestedAt: string },
  ): Promise<{ readonly answer: string; readonly operation: PendingOperationRecord }> {
    if (operation.status !== 'proposed' || Date.parse(context.requestedAt) >= Date.parse(operation.expiresAt)) {
      return { answer: 'A proposta expirou e não foi executada.', operation: this.transition(operation, 'expired', context.requestedAt) };
    }
    const policy = this.catalog.find((entry) => entry.toolId === operation.toolId);
    const outcomeOnly = policy?.resultEvidence === 'toolOutcomeOnly';
    const expectedValidationToolId = outcomeOnly
      ? (policy?.validationToolId === undefined ? NO_LOCAL_VALIDATION_TOOL_ID : undefined)
      : policy?.validationToolId;
    if (!policy || !policy.requiresAuthorization || expectedValidationToolId === undefined || expectedValidationToolId !== operation.validationToolId) {
      return { answer: 'A proposta não corresponde mais ao catálogo autorizado e não foi executada.', operation: this.transition(operation, 'failed', context.requestedAt) };
    }
    if (!this.argumentsMatchPolicy(policy, operation.toolArguments)) {
      return { answer: 'O escopo armazenado da proposta é inválido e não foi executado.', operation: this.transition(operation, 'failed', context.requestedAt) };
    }

    const action = await this.tool.invoke({
        toolId: operation.toolId,
        executionId: context.executionId,
        responsibilityId: context.responsibilityId,
        requestedAt: context.requestedAt,
        payload: operation.toolArguments,
      });
    if (outcomeOnly) {
      return this.outcomeOnlyResult(operation, action, context.requestedAt);
    }
    if (action.status !== 'completed' || action.output.outcome !== 'ok') {
      return { answer: 'A alteração autorizada falhou e não foi considerada resolvida.', operation: this.transition(operation, 'failed', context.requestedAt) };
    }

    const validation = await this.tool.invoke({
        toolId: operation.validationToolId,
        executionId: context.executionId,
        responsibilityId: context.responsibilityId,
        requestedAt: context.requestedAt,
        payload: {},
      });
    const output = validation.status === 'completed' ? validation.output : undefined;
    const validated = output?.outcome === 'ok' &&
      (output.succeeded === undefined || output.succeeded === true) &&
      (output.exitCode === undefined || output.exitCode === 0);
    if (!validated) {
      return { answer: 'A alteração foi executada, mas a validação falhou; não considero o problema resolvido.', operation: this.transition(operation, 'failed', context.requestedAt) };
    }
    return {
      answer: 'Corrigido. A alteração autorizada foi executada no escopo proposto e a validação foi concluída com sucesso.',
      operation: this.transition(operation, 'completed', context.requestedAt),
    };
  }

  private request(
    objective: string,
    requestedAt: string,
    recentObservations: readonly CognitiveObservationRecord[],
    relevantMemory: readonly { readonly content: string }[],
    signal?: AbortSignal,
  ): CognitiveDecisionRequest {
    return {
      objective,
      authorization: 'readOnly',
      relevantMemory,
      recentObservations,
      filesRead: [],
      availableTools: this.catalog.map(({ toolId, description, requiresAuthorization }) => ({ toolId, description, requiresAuthorization })),
      stepsTaken: recentObservations.length,
      stepsRemaining: Math.max(0, this.maxDecisions - recentObservations.length),
      requestedAt,
      ...(signal === undefined ? {} : { signal }),
    };
  }

  private proposal(
    objective: string,
    objectiveId: string,
    createdAt: string,
    policy: OperationalToolPolicyEntry,
    toolArguments: Readonly<Record<string, unknown>>,
  ): PendingOperationRecord {
    return Object.freeze({
      memoryRecordKind: OPERATION_EVENT_RECORD_KIND,
      id: `${objectiveId}:operation:${policy.toolId}`,
      objectiveId,
      objective,
      proposedAction: policy.description,
      toolId: policy.toolId,
      toolArguments: structuredClone(toolArguments) as Readonly<Record<string, unknown>>,
      validationToolId: policy.resultEvidence === 'toolOutcomeOnly' ? NO_LOCAL_VALIDATION_TOOL_ID : policy.validationToolId!,
      risk: policy.risk ?? 'alteração reversível de baixo risco',
      authorizationRequirement: 'explicitUserAuthorization',
      status: 'proposed',
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + PENDING_OPERATION_TTL_MS).toISOString(),
      updatedAt: createdAt,
    });
  }

  /**
   * Reports exactly what the Tool itself confirmed for an external target -
   * never a local validation, never "corrigido"/"testado". On failure, it
   * states that nothing from this step is considered done and that actions
   * confirmed in earlier steps were preserved (never rolled back).
   */
  private outcomeOnlyResult(
    operation: PendingOperationRecord,
    action: Awaited<ReturnType<SpecializedTool['invoke']>>,
    requestedAt: string,
  ): { readonly answer: string; readonly operation: PendingOperationRecord } {
    const notTested = 'Nenhum teste ou validação do projeto alterado foi executado; a alteração não foi testada.';
    const toolMessage = action.status === 'completed' && typeof action.output.message === 'string' && action.output.message.trim() !== ''
      ? action.output.message.trim()
      : undefined;
    if (action.status === 'completed' && action.output.outcome === 'ok') {
      return {
        answer: `${toolMessage ?? 'A ferramenta confirmou a operação.'} ${notTested}`,
        operation: this.transition(operation, 'completed', requestedAt),
      };
    }
    return {
      answer:
        `A operação não foi concluída: ${toolMessage ?? 'a ferramenta não confirmou o resultado.'} ` +
        'Nada desta etapa foi considerado concluído. Ações já confirmadas em etapas anteriores ' +
        '(por exemplo, branch criada ou commit registrado) foram preservadas e não foram revertidas. ' +
        notTested,
      operation: this.transition(operation, 'failed', requestedAt),
    };
  }

  private transition(operation: PendingOperationRecord, status: PendingOperationRecord['status'], updatedAt: string): PendingOperationRecord {
    return Object.freeze({ ...operation, status, updatedAt });
  }

  private argumentsMatchPolicy(policy: OperationalToolPolicyEntry, args: Readonly<Record<string, unknown>>): boolean {
    const optionalNumberArguments = policy.optionalNumberArguments ?? [];
    const optionalStringArguments = policy.optionalStringArguments ?? [];
    return policy.requiredStringArguments.every((name) => typeof args[name] === 'string') &&
      Object.keys(args).every((name) =>
        policy.requiredStringArguments.includes(name) ||
        (optionalStringArguments.includes(name) && typeof args[name] === 'string' && (args[name] as string).trim() !== '') ||
        (optionalNumberArguments.includes(name) && typeof args[name] === 'number' && Number.isInteger(args[name])));
  }

  /**
   * Structural-only diagnostic for one decision step - never the objective,
   * arguments, or any observation content. Safe to enable in production.
   */
  private logStep(
    attempt: number,
    step: {
      readonly nextAction: string;
      readonly toolId: string | undefined;
      readonly toolInvoked: boolean;
      readonly toolOutcome: 'ok' | 'rejected' | 'failed' | undefined;
    },
    toolCallsSoFar: number,
  ): void {
    this.logger?.info('Cognitive operational decision step completed.', {
      attempt,
      nextAction: step.nextAction,
      ...(step.toolId === undefined ? {} : { toolId: step.toolId }),
      toolInvoked: step.toolInvoked,
      ...(step.toolOutcome === undefined ? {} : { toolOutcome: step.toolOutcome }),
      toolCallsSoFar,
    });
  }

  /** Structural-only diagnostic for the whole loop's outcome - never the answer text or reason detail beyond its closed reason code. */
  private finish(result: CognitiveOperationalResult): CognitiveOperationalResult {
    this.logger?.info('Cognitive operational loop finished.', {
      outcome: result.outcome,
      toolCalls: result.toolCalls,
      ...(result.outcome === 'blocked' ? { reason: result.reason } : {}),
    });
    return result;
  }
}
