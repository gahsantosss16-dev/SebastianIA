import type { SpecializedTool, SpecializedToolInvocationResult } from '../tool/SpecializedToolInvocationContract.js';
import { FILESYSTEM_READ_FILE_TOOL_ID, FILESYSTEM_REPLACE_TEXT_TOOL_ID } from '../tool/LocalFilesystemInspectionTool.js';
import { GIT_STATUS_TOOL_ID, GIT_DIFF_TOOL_ID } from '../tool/LocalGitInspectionTool.js';
import { InvalidGoalExecutionInputError } from './GoalExecutionErrors.js';
import { extractImportedRelativePaths, parseFailureEvidence, type FailureEvidence } from './FailureEvidenceParser.js';
import type {
  GoalDefinition,
  GoalExecutionDecisionRecord,
  GoalExecutionResult,
  GoalExecutionStatus,
  GoalExecutionStepPhase,
  GoalExecutionStepRecord,
} from './GoalExecutionContract.js';
import {
  DEFAULT_COGNITIVE_EXECUTION_BUDGET,
  describeCognitiveToolMenu,
  findCognitiveToolPolicyEntry,
  validateCognitiveToolArguments,
  type CognitiveDecision,
  type CognitiveDecisionRequest,
  type CognitiveDecisionResult,
  type CognitiveExecutionBudget,
  type CognitiveModelProvider,
} from '../cognition/index.js';

/**
 * Hard, non-negotiable ceiling on Tool calls per goal - the guard that
 * guarantees an objective incapable of converging still stops safely instead
 * of looping. Sized for the worst realistic case of the autonomous fix cycle
 * (inspect + validate + read the failing test + up to MAX_CANDIDATE_FILES
 * edit attempts + verify, repeated up to MAX_FIX_ATTEMPTS times, plus a
 * final diff) - still small and entirely bounded, never open-ended.
 */
export const MAX_GOAL_EXECUTION_STEPS = 14;
/** How many source files, discovered from the failing test's own imports, are ever attempted for an autonomous fix - never a workspace-wide scan. */
export const MAX_CANDIDATE_FILES = 3;
/** How many distinct hypotheses (apply → verify) an autonomous fix ever tries before giving up - the "reconsider once, don't loop forever" bound required by this block. */
export const MAX_FIX_ATTEMPTS = 2;

const VALIDATION_TOOL_ID_PREFIX = 'validation.';

/** Read-only toolIds a goal may always invoke, regardless of authorization - reading a file is investigation, never a change. */
const READ_ONLY_TOOL_IDS: ReadonlySet<string> = new Set([GIT_STATUS_TOOL_ID, GIT_DIFF_TOOL_ID, FILESYSTEM_READ_FILE_TOOL_ID]);

export interface GoalExecutionContext {
  readonly executionId: string;
  readonly responsibilityId: string;
  readonly requestedAt: string;
  /**
   * Short, already-selected facts from Memory relevant to this goal - never
   * the full memory store. Optional and empty by default so every existing
   * caller keeps working unchanged; only consulted by the cognitive engine
   * (`executeWithCognition`), never by the deterministic path.
   */
  readonly relevantMemory?: readonly { readonly content: string }[];
}

type ActOutcome =
  | { readonly kind: 'output'; readonly output: Readonly<Record<string, unknown>> }
  | { readonly kind: 'incomplete' }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'toolFailure' };

/**
 * Runs a short, adaptive OBJECTIVE → PLAN → ACT → OBSERVE → DECIDE → VERIFY →
 * COMPLETE cycle over the same `SpecializedTool` interface every other
 * orchestrator in this codebase already uses - never a new Tool, never a
 * second dispatch mechanism. Unlike `DevelopmentTaskOrchestrator` (which
 * executes a plan that is already fully built before execution starts), this
 * engine decides its next action at runtime from what the previous action
 * observed - the "adapt when a hypothesis is wrong" behavior this block asks
 * for. There are exactly two concrete procedures, chosen by whether the goal
 * carries a concrete `fix`:
 *
 * - **investigate** (`goal.fix` absent): inspect Git state, run the
 *   validation the objective is about, and only dig further when that
 *   validation actually failed - if it already passes, the cycle stops
 *   immediately instead of manufacturing more steps (the plan adapting to a
 *   contradicted hypothesis). Never touches `fs.replaceText`, regardless of
 *   `goal.authorization`.
 * - **fix** (`goal.fix` present and `goal.authorization === 'writeAuthorized'`):
 *   inspect, apply the one concrete edit the user already specified, and
 *   then re-run the same validation as verification - a completed status is
 *   only ever reported when that verification actually passes ("ação
 *   executada ≠ objetivo concluído").
 * - **autonomous fix** (`goal.fix` absent, `goal.authorization ===
 *   'writeAuthorized'`, validation actually failed): SPEC-047's central new
 *   behavior. The failed validation's own captured output is parsed
 *   (`FailureEvidenceParser`) for the concrete actual/expected values Node's
 *   own assertion failure already reports, and for the failing test's own
 *   file; that test file is read once and its own `require`/`import`
 *   statements become the only candidate source files ever considered -
 *   never a workspace-wide scan. Each candidate is tried, in order, as a
 *   `fs.replaceText(candidate, actual, expected)` hypothesis; a hypothesis
 *   that does not make the validation pass is never reverted, but a fresh
 *   hypothesis is formed from the *new* failure's own evidence and tried
 *   again, up to `MAX_FIX_ATTEMPTS` times. A read-only goal runs the exact
 *   same evidence gathering to produce a more useful diagnosis, but never
 *   reaches the edit step.
 *
 * `fs.replaceText` is refused, defensively, whenever authorization is not
 * `writeAuthorized` - even if a `fix` were somehow present on a read-only
 * goal, this engine would never invoke it.
 */
export class GoalExecutionOrchestrator {
  private readonly specializedTool: SpecializedTool;
  private readonly maxSteps: number;
  private readonly cognitiveModelProvider: CognitiveModelProvider | undefined;
  private readonly cognitiveBudget: CognitiveExecutionBudget;

  public constructor(
    specializedTool: SpecializedTool,
    maxSteps: number = MAX_GOAL_EXECUTION_STEPS,
    cognitiveModelProvider?: CognitiveModelProvider,
    cognitiveBudget?: Partial<CognitiveExecutionBudget>,
  ) {
    if (!specializedTool || typeof specializedTool.invoke !== 'function') {
      throw new InvalidGoalExecutionInputError('Goal execution orchestrator specialized tool must provide invoke.');
    }
    if (typeof maxSteps !== 'number' || !Number.isInteger(maxSteps) || maxSteps < 1) {
      throw new InvalidGoalExecutionInputError('Goal execution orchestrator maxSteps must be a positive integer.');
    }
    if (cognitiveModelProvider !== undefined && typeof cognitiveModelProvider.decide !== 'function') {
      throw new InvalidGoalExecutionInputError('Goal execution orchestrator cognitive model provider must provide decide.');
    }
    this.specializedTool = specializedTool;
    this.maxSteps = maxSteps;
    this.cognitiveModelProvider = cognitiveModelProvider;
    this.cognitiveBudget = Object.freeze({ ...DEFAULT_COGNITIVE_EXECUTION_BUDGET, ...cognitiveBudget });
  }

  public execute(goal: GoalDefinition, context: GoalExecutionContext): GoalExecutionResult {
    this.validateGoal(goal);
    this.validateContext(context);

    const run = new GoalExecutionRun(this.specializedTool, this.maxSteps, goal, context);
    return run.perform();
  }

  /**
   * Same OBJECTIVE → PLAN → ACT → OBSERVE → DECIDE → VERIFY → COMPLETE cycle
   * as `execute`, but the DECIDE point may additionally consult the
   * cognitive engine (SPEC-048) once the deterministic SPEC-046/047 path has
   * genuinely exhausted itself: a `writeAuthorized` goal whose validation is
   * confirmed failing, yet for which no hypothesis could be formed or
   * applied at all. When no `cognitiveModelProvider` was configured, or that
   * condition never triggers, this behaves identically to `execute` (wrapped
   * in an already-resolved Promise) - existing behavior is never changed,
   * only extended.
   */
  public async executeWithCognition(goal: GoalDefinition, context: GoalExecutionContext): Promise<GoalExecutionResult> {
    this.validateGoal(goal);
    this.validateContext(context);

    const run = new GoalExecutionRun(this.specializedTool, this.maxSteps, goal, context);
    if (!this.cognitiveModelProvider) {
      return run.perform();
    }
    return run.performCognitively(this.cognitiveModelProvider, this.cognitiveBudget);
  }

  private validateGoal(goal: GoalDefinition): void {
    const isObject = goal && typeof goal === 'object' && !Array.isArray(goal);
    if (!isObject) {
      throw new InvalidGoalExecutionInputError('Goal definition must be an object.');
    }
    if (typeof goal.objective !== 'string' || goal.objective.trim() === '') {
      throw new InvalidGoalExecutionInputError('Goal objective must be a non-empty string.');
    }
    if (goal.authorization !== 'readOnly' && goal.authorization !== 'writeAuthorized') {
      throw new InvalidGoalExecutionInputError('Goal authorization must be "readOnly" or "writeAuthorized".');
    }
    if (typeof goal.validationToolId !== 'string' || goal.validationToolId.trim() === '') {
      throw new InvalidGoalExecutionInputError('Goal validationToolId must be a non-empty string.');
    }
    if (goal.fix !== undefined) {
      const fix = goal.fix;
      const isFixObject = fix && typeof fix === 'object' && !Array.isArray(fix);
      if (
        !isFixObject ||
        typeof fix.path !== 'string' ||
        fix.path.trim() === '' ||
        typeof fix.searchText !== 'string' ||
        fix.searchText.trim() === '' ||
        typeof fix.replaceText !== 'string'
      ) {
        throw new InvalidGoalExecutionInputError('Goal fix, when provided, must have a non-empty path/searchText and a string replaceText.');
      }
    }
  }

  private validateContext(context: GoalExecutionContext): void {
    const isObject = context && typeof context === 'object' && !Array.isArray(context);
    if (!isObject) {
      throw new InvalidGoalExecutionInputError('Goal execution context must be an object.');
    }
    if (typeof context.executionId !== 'string' || context.executionId.trim() === '') {
      throw new InvalidGoalExecutionInputError('Goal execution context executionId must be a non-empty string.');
    }
    if (typeof context.responsibilityId !== 'string' || context.responsibilityId.trim() === '') {
      throw new InvalidGoalExecutionInputError('Goal execution context responsibilityId must be a non-empty string.');
    }
    if (typeof context.requestedAt !== 'string' || context.requestedAt.trim() === '') {
      throw new InvalidGoalExecutionInputError('Goal execution context requestedAt must be a non-empty string.');
    }
  }
}

/** Per-call, single-use run: keeps the orchestrator instance itself stateless and reusable across many goals. */
class GoalExecutionRun {
  private readonly steps: GoalExecutionStepRecord[] = [];
  private readonly decisions: GoalExecutionDecisionRecord[] = [];
  private readonly filesChanged: string[] = [];
  private stepCounter = 0;
  /** Set once `investigateFailure` is reached - i.e. the validation genuinely failed, not merely "no fix was attempted". Read only by `performCognitively`, never by the deterministic path. */
  private validationConfirmedFailing = false;

  public constructor(
    private readonly specializedTool: SpecializedTool,
    private readonly maxSteps: number,
    private readonly goal: GoalDefinition,
    private readonly context: GoalExecutionContext,
  ) {}

  public perform(): GoalExecutionResult {
    const statusOutcome = this.act('inspect', GIT_STATUS_TOOL_ID, {});
    if (statusOutcome.kind !== 'output') {
      return this.conclude(this.statusFor(statusOutcome), this.reasonFor(statusOutcome));
    }
    this.recordGitStep(this.currentStepId(), 'inspect', GIT_STATUS_TOOL_ID, statusOutcome.output);

    if (this.goal.fix && this.goal.authorization === 'writeAuthorized') {
      return this.performFix();
    }
    return this.performInvestigation();
  }

  private performInvestigation(): GoalExecutionResult {
    const validationOutcome = this.act('verify', this.goal.validationToolId, {});
    if (validationOutcome.kind !== 'output') {
      return this.conclude(this.statusFor(validationOutcome), this.reasonFor(validationOutcome));
    }

    const validation = this.recordValidationStep('verify', validationOutcome.output);
    if (!validation.ranAsValidation) {
      return this.conclude('failed', validation.reasonCode ?? 'validationRejected');
    }

    if (validation.succeeded) {
      this.decisions.push({
        afterStepId: this.currentStepId(),
        observation: `Validação "${this.goal.validationToolId}" está passando.`,
        decision: 'Hipótese de falha não confirmada; encerrando investigação sem aprofundar.',
      });
      return this.conclude('completed', undefined, this.composeInvestigationMessage(validation.exitCode));
    }

    return this.investigateFailure(validation.exitCode, validationOutcome.output);
  }

  /**
   * Reached only once the validation is confirmed to actually be failing.
   * Shared by both authorization tiers: extracts real evidence from the
   * validation's own output and discovers candidate source files from the
   * failing test's own imports. `writeAuthorized` goes on to attempt an
   * autonomous fix from that evidence; `readOnly` only uses it to produce a
   * genuinely useful diagnosis, never an edit.
   */
  private investigateFailure(exitCode: unknown, validationOutput: Readonly<Record<string, unknown>>): GoalExecutionResult {
    this.validationConfirmedFailing = true;
    const evidence = this.extractEvidence(validationOutput);

    const candidatesOutcome = this.discoverCandidateFiles(evidence.testFilePath);
    if (candidatesOutcome.kind === 'stop') {
      return candidatesOutcome.result;
    }
    const candidates = candidatesOutcome.candidates;

    this.decisions.push({
      afterStepId: this.currentStepId(),
      observation: `Validação "${this.goal.validationToolId}" está falhando (exit code ${exitCode}).`,
      decision:
        candidates.length > 0
          ? `${candidates.length} arquivo(s) candidato(s) identificado(s) a partir das importações do teste: ${candidates.join(', ')}.`
          : 'Nenhum arquivo candidato identificável a partir da evidência disponível.',
    });

    if (this.goal.authorization === 'writeAuthorized') {
      return this.pursueAutonomousFix(exitCode, evidence, candidates);
    }

    return this.reportDiagnosis(exitCode, evidence, candidates);
  }

  private reportDiagnosis(
    exitCode: unknown,
    evidence: FailureEvidence,
    candidates: readonly string[],
  ): GoalExecutionResult {
    const diffOutcome = this.act('evidence', GIT_DIFF_TOOL_ID, {});
    if (diffOutcome.kind !== 'output') {
      return this.conclude(this.statusFor(diffOutcome), this.reasonFor(diffOutcome));
    }
    this.recordGitStep(this.currentStepId(), 'evidence', GIT_DIFF_TOOL_ID, diffOutcome.output);

    return this.conclude('completed', undefined, this.composeDiagnosisMessage(exitCode, evidence, candidates));
  }

  /**
   * The central new behavior of this block: tries, in order, up to
   * `MAX_FIX_ATTEMPTS` hypotheses - each one an `fs.replaceText` on the
   * first candidate whose current content still contains the hypothesis's
   * "actual" literal, followed immediately by re-running the validation as
   * verification. A hypothesis that does not make the validation pass is
   * never reverted; a fresh hypothesis is instead formed from that new
   * failure's own evidence (`FailureEvidenceParser` runs again on the new
   * output) - genuine reconsideration grounded in new observation, not a
   * blind retry.
   */
  private pursueAutonomousFix(
    initialExitCode: unknown,
    initialEvidence: FailureEvidence,
    candidates: readonly string[],
  ): GoalExecutionResult {
    let currentEvidence = initialEvidence;
    let attempts = 0;

    while (
      attempts < MAX_FIX_ATTEMPTS &&
      currentEvidence.actualLiteral !== undefined &&
      currentEvidence.expectedLiteral !== undefined &&
      candidates.length > 0
    ) {
      const applyOutcome = this.tryApplyHypothesis(candidates, currentEvidence.actualLiteral, currentEvidence.expectedLiteral);
      if (applyOutcome.kind === 'stop') {
        return applyOutcome.result;
      }
      if (applyOutcome.kind === 'none') {
        break;
      }

      attempts += 1;

      const verifyOutcome = this.act('verify', this.goal.validationToolId, {});
      if (verifyOutcome.kind !== 'output') {
        return this.conclude(this.statusFor(verifyOutcome), this.reasonFor(verifyOutcome));
      }
      const verification = this.recordValidationStep('verify', verifyOutcome.output);
      if (!verification.ranAsValidation) {
        return this.conclude('failed', verification.reasonCode ?? 'validationRejected');
      }

      if (verification.succeeded) {
        return this.concludeAfterFinalEvidence(
          'completed',
          undefined,
          this.composeFixSuccessMessage(applyOutcome.path, currentEvidence, attempts, verification.exitCode),
        );
      }

      this.decisions.push({
        afterStepId: this.currentStepId(),
        observation: `A hipótese aplicada em "${applyOutcome.path}" não resolveu; validação ainda falha (exit code ${verification.exitCode}).`,
        decision:
          attempts < MAX_FIX_ATTEMPTS
            ? 'Reconsiderando a hipótese com base na nova evidência.'
            : 'Limite de tentativas de correção atingido.',
      });

      currentEvidence = this.extractEvidence(verifyOutcome.output);
    }

    if (this.filesChanged.length > 0) {
      return this.concludeAfterFinalEvidence(
        'failed',
        'verificationFailed',
        this.composeFixExhaustedMessage(initialExitCode),
      );
    }

    return this.reportDiagnosis(initialExitCode, initialEvidence, candidates);
  }

  /** Tries each candidate, in order, as the target of `fs.replaceText(candidate, actualLiteral, expectedLiteral)`, stopping at the first one accepted. */
  private tryApplyHypothesis(
    candidates: readonly string[],
    actualLiteral: string,
    expectedLiteral: string,
  ): { readonly kind: 'applied'; readonly path: string } | { readonly kind: 'none' } | { readonly kind: 'stop'; readonly result: GoalExecutionResult } {
    for (const candidate of candidates) {
      const attemptOutcome = this.act('act', FILESYSTEM_REPLACE_TEXT_TOOL_ID, {
        path: candidate,
        searchText: actualLiteral,
        replaceText: expectedLiteral,
      });
      if (attemptOutcome.kind !== 'output') {
        return { kind: 'stop', result: this.conclude(this.statusFor(attemptOutcome), this.reasonFor(attemptOutcome)) };
      }

      const output = attemptOutcome.output;
      const applied = output.outcome === 'ok';
      const path = typeof output.path === 'string' ? output.path : candidate;
      const message = typeof output.message === 'string' ? output.message : 'Edição recusada.';

      this.steps.push({
        stepId: this.currentStepId(),
        phase: 'act',
        toolId: FILESYSTEM_REPLACE_TEXT_TOOL_ID,
        outcome: applied ? 'ok' : 'rejected',
        summary: applied
          ? `Arquivo "${path}" atualizado (hipótese: "${actualLiteral}" → "${expectedLiteral}").`
          : message,
      });

      if (applied) {
        this.filesChanged.push(path);
        return { kind: 'applied', path };
      }

      this.decisions.push({
        afterStepId: this.currentStepId(),
        observation: message,
        decision: 'Candidato não se aplica a esta hipótese; tentando o próximo, se houver.',
      });
    }

    return { kind: 'none' };
  }

  /**
   * Reads the failing test file exactly once (never more) and parses its
   * own `require`/`import` statements for candidate source files - the only
   * discovery mechanism this block uses. Absent evidence of a test file, or
   * a file that cannot be read, simply yields no candidates rather than
   * falling back to any broader search.
   */
  private discoverCandidateFiles(
    testFilePath: string | undefined,
  ): { readonly kind: 'ok'; readonly candidates: readonly string[] } | { readonly kind: 'stop'; readonly result: GoalExecutionResult } {
    if (testFilePath === undefined) {
      return { kind: 'ok', candidates: [] };
    }

    const readOutcome = this.act('inspect', FILESYSTEM_READ_FILE_TOOL_ID, { path: testFilePath });
    if (readOutcome.kind !== 'output') {
      return { kind: 'stop', result: this.conclude(this.statusFor(readOutcome), this.reasonFor(readOutcome)) };
    }

    const output = readOutcome.output;
    const ok = output.outcome === 'ok' && typeof output.content === 'string';
    this.steps.push({
      stepId: this.currentStepId(),
      phase: 'inspect',
      toolId: FILESYSTEM_READ_FILE_TOOL_ID,
      outcome: ok ? 'ok' : 'rejected',
      summary: ok
        ? `Arquivo de teste "${testFilePath}" inspecionado em busca de arquivos relacionados.`
        : typeof output.message === 'string'
          ? output.message
          : `Não foi possível ler "${testFilePath}".`,
    });

    if (!ok) {
      return { kind: 'ok', candidates: [] };
    }

    const candidates = extractImportedRelativePaths(output.content as string, testFilePath).slice(0, MAX_CANDIDATE_FILES);
    return { kind: 'ok', candidates };
  }

  private extractEvidence(validationOutput: Readonly<Record<string, unknown>>): FailureEvidence {
    const stdout = typeof validationOutput.stdout === 'string' ? validationOutput.stdout : '';
    const stderr = typeof validationOutput.stderr === 'string' ? validationOutput.stderr : '';
    return parseFailureEvidence(`${stdout}\n${stderr}`);
  }

  private concludeAfterFinalEvidence(status: GoalExecutionStatus, reason: string | undefined, message?: string): GoalExecutionResult {
    const diffOutcome = this.act('evidence', GIT_DIFF_TOOL_ID, {});
    if (diffOutcome.kind !== 'output') {
      return this.conclude(this.statusFor(diffOutcome), this.reasonFor(diffOutcome));
    }
    this.recordGitStep(this.currentStepId(), 'evidence', GIT_DIFF_TOOL_ID, diffOutcome.output);
    return this.conclude(status, reason, message);
  }

  /**
   * SPEC-048's cognitive DECIDE point. Reached only from
   * `GoalExecutionOrchestrator.executeWithCognition`, and only ever runs the
   * deterministic SPEC-046/047 cycle first - the cognitive engine is
   * consulted exclusively as a fallback for the exact gap SPEC-047 could not
   * close: a `writeAuthorized` goal whose validation is genuinely failing,
   * yet for which no hypothesis could even be formed (no usable
   * actual/expected literal, or no candidate file at all - a structural bug,
   * not a simple literal mismatch). If SPEC-047 already succeeded, or the
   * goal is `readOnly`, or nothing ever confirmed a failure in the first
   * place, this returns the deterministic result unchanged - the cognitive
   * engine never second-guesses a result the cheaper path already reached.
   */
  public async performCognitively(
    cognitiveModelProvider: CognitiveModelProvider,
    budget: CognitiveExecutionBudget,
  ): Promise<GoalExecutionResult> {
    const deterministicResult = this.perform();

    const shouldEngageCognition =
      this.goal.authorization === 'writeAuthorized' &&
      this.validationConfirmedFailing &&
      this.filesChanged.length === 0 &&
      this.steps.length < this.maxSteps;

    if (!shouldEngageCognition) {
      return deterministicResult;
    }

    return this.runCognitiveLoop(cognitiveModelProvider, budget);
  }

  /**
   * The cognitive DECIDE ↔ ACT ↔ OBSERVE loop: on every iteration, asks the
   * model for exactly one structured decision, validates it against the
   * closed `CognitiveToolPolicy` (never trusting the model's own toolId or
   * `requiresAuthorization` claim), executes it through the exact same
   * `act()` choke point every other path in this class uses, and folds the
   * observation back into the next request. Ends the moment a
   * model-selected validation call both succeeds and at least one file has
   * actually been changed in this loop - "ação executada ≠ objetivo
   * concluído" is enforced by never trusting a model's own
   * `concludeCompleted` claim on its own.
   */
  private async runCognitiveLoop(
    cognitiveModelProvider: CognitiveModelProvider,
    budget: CognitiveExecutionBudget,
  ): Promise<GoalExecutionResult> {
    const filesRead: Array<{ readonly path: string; readonly content: string }> = [];
    const decisionSignatures: string[] = [];
    let consecutiveInvalid = 0;

    for (let attempt = 0; attempt < budget.maxCognitiveDecisions; attempt += 1) {
      if (this.steps.length >= this.maxSteps) {
        return this.conclude('incomplete', 'stepLimitExceeded');
      }

      const request = this.buildCognitiveDecisionRequest(filesRead, budget);
      const result = await this.callCognitiveModelWithTimeout(cognitiveModelProvider, request, budget.decisionTimeoutMs);

      if (result.outcome === 'timeout') {
        return this.conclude('failed', 'cognitiveTimeout');
      }
      if (result.outcome === 'unavailable') {
        return this.conclude('failed', 'cognitiveUnavailable');
      }
      if (result.outcome === 'invalidResponse') {
        consecutiveInvalid += 1;
        this.decisions.push({
          afterStepId: this.currentStepId(),
          observation: 'O motor cognitivo retornou uma resposta fora do schema esperado.',
          decision:
            consecutiveInvalid >= budget.maxConsecutiveInvalidDecisions
              ? 'Encerrando: respostas inválidas repetidas.'
              : 'Solicitando nova decisão.',
        });
        if (consecutiveInvalid >= budget.maxConsecutiveInvalidDecisions) {
          return this.conclude('failed', 'cognitiveInvalidResponse');
        }
        continue;
      }

      consecutiveInvalid = 0;
      const decision = result.decision;

      if (decision.confidence < budget.minConfidence) {
        this.decisions.push({
          afterStepId: this.currentStepId(),
          observation: `Confiança insuficiente do motor cognitivo (${decision.confidence.toFixed(2)}).`,
          decision: decision.reasoningSummary,
        });
        return this.conclude('failed', 'lowConfidence');
      }

      if (decision.nextAction === 'concludeFailed') {
        this.decisions.push({
          afterStepId: this.currentStepId(),
          observation: 'O motor cognitivo concluiu que o objetivo não pode ser alcançado com segurança.',
          decision: decision.reasoningSummary,
        });
        return this.conclude('failed', 'cognitiveConcludedFailure');
      }

      if (decision.nextAction === 'concludeCompleted') {
        this.decisions.push({
          afterStepId: this.currentStepId(),
          observation: 'O motor cognitivo sinalizou conclusão sem uma verificação real nesta execução.',
          decision: 'Conclusão não aceita sem verificação real; encerrando com segurança.',
        });
        return this.conclude('failed', 'cognitiveUnverifiedCompletion');
      }

      if (decision.nextAction === 'requestMoreEvidence') {
        this.decisions.push({
          afterStepId: this.currentStepId(),
          observation: 'O motor cognitivo pediu mais evidência sem propor uma ação concreta.',
          decision: decision.reasoningSummary,
        });
        return this.conclude('failed', 'cognitiveNoActionableDecision');
      }

      const policy = this.validateCognitiveToolInvocation(decision);
      if (!policy.allowed) {
        this.decisions.push({
          afterStepId: this.currentStepId(),
          observation: `Ação proposta (${decision.toolId ?? 'desconhecida'}) recusada pela política de execução.`,
          decision: decision.reasoningSummary,
        });
        return this.conclude('blocked', policy.reasonCode);
      }

      const signature = `${policy.toolId}::${JSON.stringify(policy.toolArguments)}`;
      const repeatCount = decisionSignatures.filter((entry) => entry === signature).length;
      if (repeatCount >= budget.maxRepeatedDecisions) {
        this.decisions.push({
          afterStepId: this.currentStepId(),
          observation: `A mesma ação ("${policy.toolId}") foi proposta repetidamente sem evidência nova.`,
          decision: 'Encerrando para evitar um laço sem progresso.',
        });
        return this.conclude('failed', 'cognitiveRepeatedDecision');
      }
      decisionSignatures.push(signature);

      const phase: GoalExecutionStepPhase =
        policy.toolId === this.goal.validationToolId
          ? 'verify'
          : policy.toolId === FILESYSTEM_REPLACE_TEXT_TOOL_ID
            ? 'act'
            : 'inspect';

      const actOutcome = this.act(phase, policy.toolId, policy.toolArguments);
      if (actOutcome.kind !== 'output') {
        return this.conclude(this.statusFor(actOutcome), this.reasonFor(actOutcome));
      }

      const stepOutcome = this.recordCognitiveToolStep(policy.toolId, actOutcome.output);
      this.decisions.push({
        afterStepId: this.currentStepId(),
        observation: stepOutcome.succeeded ? 'Ação executada com sucesso.' : 'A Tool recusou ou não concluiu a ação proposta.',
        decision: decision.reasoningSummary,
      });

      if (policy.toolId === FILESYSTEM_READ_FILE_TOOL_ID && stepOutcome.succeeded) {
        const content = typeof actOutcome.output.content === 'string' ? actOutcome.output.content : '';
        const path = typeof actOutcome.output.path === 'string' ? actOutcome.output.path : 'arquivo';
        filesRead.push({ path, content });
      }

      if (policy.toolId === this.goal.validationToolId && stepOutcome.succeeded && this.filesChanged.length > 0) {
        const exitCode = (actOutcome.output as { readonly exitCode?: unknown }).exitCode;
        const changed = Array.from(new Set(this.filesChanged)).join(', ');
        return this.concludeAfterFinalEvidence(
          'completed',
          undefined,
          `Correção formulada pelo motor cognitivo e verificada: "${changed}" foi(ram) alterado(s) e a validação "${this.goal.validationToolId}" agora passa (exit code ${exitCode}).`,
        );
      }
    }

    return this.conclude('failed', 'cognitiveBudgetExceeded');
  }

  private buildCognitiveDecisionRequest(
    filesRead: readonly { readonly path: string; readonly content: string }[],
    budget: CognitiveExecutionBudget,
  ): CognitiveDecisionRequest {
    return {
      objective: this.goal.objective,
      authorization: this.goal.authorization,
      relevantMemory: (this.context.relevantMemory ?? []).map((fact) => ({ content: fact.content })),
      recentObservations: this.steps.map((step) => ({
        stepId: step.stepId,
        toolId: step.toolId,
        outcome: step.outcome,
        summary: step.summary.slice(0, budget.maxObservationChars),
      })),
      filesRead: filesRead.map((file) => ({ path: file.path, content: file.content.slice(0, budget.maxObservationChars) })),
      availableTools: describeCognitiveToolMenu(this.goal.validationToolId),
      stepsTaken: this.steps.length,
      stepsRemaining: Math.max(0, this.maxSteps - this.steps.length),
      requestedAt: this.context.requestedAt,
    };
  }

  /**
   * Races the provider's own `decide()` against an orchestrator-owned
   * timeout, so a call is bounded even if the provider never implements a
   * timeout itself (or never resolves at all, as a stuck local runtime
   * might). A rejected promise is treated the same as a network failure -
   * `unavailable`, never an uncaught rejection.
   */
  private async callCognitiveModelWithTimeout(
    provider: CognitiveModelProvider,
    request: CognitiveDecisionRequest,
    timeoutMs: number,
  ): Promise<CognitiveDecisionResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<CognitiveDecisionResult>((resolve) => {
      timer = setTimeout(() => resolve({ outcome: 'timeout' }), timeoutMs);
    });

    try {
      return await Promise.race([
        provider.decide(request).catch(
          (error: unknown): CognitiveDecisionResult => ({
            outcome: 'unavailable',
            reason: error instanceof Error ? error.message : 'Falha inesperada ao consultar o motor cognitivo.',
          }),
        ),
        timeoutPromise,
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * The policy gate every cognitive decision must pass before it is ever
   * allowed near `act()`: the toolId must be exactly one of the (at most
   * three) tools built for this goal's own validationToolId - never an
   * invented or hallucinated one - a write-requiring tool is refused unless
   * the goal itself is `writeAuthorized`, the same authorization-aware
   * allow-list `execute()` already enforces is re-checked independently, and
   * every argument the tool actually requires must be present with the
   * right type - closing the exact gap that would otherwise let a malformed
   * or adversarial decision reach a Tool call that throws synchronously
   * instead of failing safely.
   */
  private validateCognitiveToolInvocation(
    decision: CognitiveDecision,
  ):
    | { readonly allowed: true; readonly toolId: string; readonly toolArguments: Readonly<Record<string, unknown>> }
    | { readonly allowed: false; readonly reasonCode: string } {
    const toolId = decision.toolId;
    if (!toolId) {
      return { allowed: false, reasonCode: 'cognitiveMissingToolId' };
    }

    const entry = findCognitiveToolPolicyEntry(this.goal.validationToolId, toolId);
    if (!entry) {
      return { allowed: false, reasonCode: 'cognitiveToolNotInMenu' };
    }

    if (!this.isToolAllowed(toolId)) {
      return { allowed: false, reasonCode: 'toolNotAuthorized' };
    }

    if (entry.requiresAuthorization && this.goal.authorization !== 'writeAuthorized') {
      return { allowed: false, reasonCode: 'toolNotAuthorized' };
    }

    if (!validateCognitiveToolArguments(entry, decision.toolArguments)) {
      return { allowed: false, reasonCode: 'cognitiveInvalidToolArguments' };
    }

    return { allowed: true, toolId, toolArguments: decision.toolArguments ?? {} };
  }

  /** Mirrors recordGitStep/recordValidationStep for the (at most three) toolIds a cognitive decision may ever invoke. */
  private recordCognitiveToolStep(toolId: string, output: Readonly<Record<string, unknown>>): { readonly succeeded: boolean } {
    if (toolId === this.goal.validationToolId) {
      const verification = this.recordValidationStep('verify', output);
      return { succeeded: verification.succeeded };
    }

    const path = typeof output.path === 'string' ? output.path : 'arquivo';

    if (toolId === FILESYSTEM_READ_FILE_TOOL_ID) {
      const ok = output.outcome === 'ok' && typeof output.content === 'string';
      this.steps.push({
        stepId: this.currentStepId(),
        phase: 'inspect',
        toolId,
        outcome: ok ? 'ok' : 'rejected',
        summary: ok
          ? `Arquivo "${path}" lido pelo motor cognitivo.`
          : typeof output.message === 'string'
            ? output.message
            : `Não foi possível ler "${path}".`,
      });
      return { succeeded: ok };
    }

    const applied = output.outcome === 'ok';
    const message = typeof output.message === 'string' ? output.message : 'Edição recusada.';
    this.steps.push({
      stepId: this.currentStepId(),
      phase: 'act',
      toolId,
      outcome: applied ? 'ok' : 'rejected',
      summary: applied ? `Arquivo "${path}" atualizado pelo motor cognitivo.` : message,
    });
    if (applied) {
      this.filesChanged.push(path);
    }
    return { succeeded: applied };
  }

  private performFix(): GoalExecutionResult {
    const fix = this.goal.fix;
    if (!fix) {
      return this.conclude('failed', 'missingFixAction');
    }

    const fixOutcome = this.act('act', FILESYSTEM_REPLACE_TEXT_TOOL_ID, {
      path: fix.path,
      searchText: fix.searchText,
      replaceText: fix.replaceText,
    });
    if (fixOutcome.kind !== 'output') {
      return this.conclude(this.statusFor(fixOutcome), this.reasonFor(fixOutcome));
    }

    const replaceOutput = fixOutcome.output;
    const replaceOk = replaceOutput.outcome === 'ok';
    const path = typeof replaceOutput.path === 'string' ? replaceOutput.path : fix.path;
    const message = typeof replaceOutput.message === 'string' ? replaceOutput.message : 'Edição recusada.';

    this.steps.push({
      stepId: this.currentStepId(),
      phase: 'act',
      toolId: FILESYSTEM_REPLACE_TEXT_TOOL_ID,
      outcome: replaceOk ? 'ok' : 'rejected',
      summary: replaceOk ? `Arquivo "${path}" atualizado.` : message,
    });

    if (!replaceOk) {
      const reasonCode = typeof replaceOutput.reasonCode === 'string' ? replaceOutput.reasonCode : 'editRejected';
      this.decisions.push({
        afterStepId: this.currentStepId(),
        observation: message,
        decision: 'Edição recusada; interrompendo antes de verificar, nada foi alterado.',
      });
      return this.conclude('blocked', reasonCode, message);
    }

    this.filesChanged.push(path);
    this.decisions.push({
      afterStepId: this.currentStepId(),
      observation: `Arquivo "${path}" atualizado.`,
      decision: `Verificando a correção executando a validação "${this.goal.validationToolId}".`,
    });

    const verifyOutcome = this.act('verify', this.goal.validationToolId, {});
    if (verifyOutcome.kind !== 'output') {
      return this.conclude(this.statusFor(verifyOutcome), this.reasonFor(verifyOutcome));
    }
    const verification = this.recordValidationStep('verify', verifyOutcome.output);
    if (verification.outcome === 'failed' && !verification.ranAsValidation) {
      return this.conclude('failed', verification.reasonCode ?? 'validationRejected');
    }

    const diffOutcome = this.act('evidence', GIT_DIFF_TOOL_ID, {});
    if (diffOutcome.kind !== 'output') {
      return this.conclude(this.statusFor(diffOutcome), this.reasonFor(diffOutcome));
    }
    this.recordGitStep(this.currentStepId(), 'evidence', GIT_DIFF_TOOL_ID, diffOutcome.output);

    if (verification.succeeded) {
      return this.conclude(
        'completed',
        undefined,
        `Correção aplicada e verificada: "${path}" foi alterado e a validação "${this.goal.validationToolId}" agora passa (exit code ${verification.exitCode}).`,
      );
    }

    return this.conclude(
      'failed',
      'verificationFailed',
      `Correção aplicada em "${path}", mas a validação "${this.goal.validationToolId}" ainda falha (exit code ${verification.exitCode}); a alteração foi preservada para revisão.`,
    );
  }

  /**
   * The single point every Tool invocation goes through: enforces the step
   * limit before acting (never after), enforces the fixed, authorization-aware
   * allow-list, and turns a genuinely unexpected Tool failure into a safe
   * stop - exactly the same defense-in-depth discipline already established
   * by `DevelopmentTaskOrchestrator`.
   */
  private act(phase: GoalExecutionStepPhase, toolId: string, toolInput: Readonly<Record<string, unknown>>): ActOutcome {
    if (this.steps.length >= this.maxSteps) {
      return { kind: 'incomplete' };
    }
    if (!this.isToolAllowed(toolId)) {
      this.stepCounter += 1;
      this.steps.push({
        stepId: `step-${this.stepCounter}`,
        phase,
        toolId,
        outcome: 'failed',
        summary: `Tool "${toolId}" não está autorizada para esta execução orientada a objetivo.`,
      });
      return { kind: 'unauthorized' };
    }

    this.stepCounter += 1;
    const toolResult: SpecializedToolInvocationResult = this.specializedTool.invoke({
      toolId,
      executionId: this.context.executionId,
      responsibilityId: this.context.responsibilityId,
      requestedAt: this.context.requestedAt,
      payload: toolInput,
    });

    if (!this.isSuccessfulInvocation(toolResult)) {
      this.steps.push({
        stepId: `step-${this.stepCounter}`,
        phase,
        toolId,
        outcome: 'failed',
        summary: `A etapa com "${toolId}" falhou inesperadamente.`,
      });
      return { kind: 'toolFailure' };
    }

    return { kind: 'output', output: toolResult.output };
  }

  private isSuccessfulInvocation(
    result: SpecializedToolInvocationResult,
  ): result is { readonly status: 'completed'; readonly output: Readonly<Record<string, unknown>> } {
    return (
      !!result &&
      typeof result === 'object' &&
      result.status === 'completed' &&
      !!result.output &&
      typeof result.output === 'object' &&
      !Array.isArray(result.output)
    );
  }

  private isToolAllowed(toolId: string): boolean {
    if (READ_ONLY_TOOL_IDS.has(toolId) || toolId.startsWith(VALIDATION_TOOL_ID_PREFIX)) {
      return true;
    }
    if (toolId === FILESYSTEM_REPLACE_TEXT_TOOL_ID) {
      return this.goal.authorization === 'writeAuthorized';
    }
    return false;
  }

  private recordGitStep(stepId: string, phase: GoalExecutionStepPhase, toolId: string, output: Readonly<Record<string, unknown>>): void {
    if (output.outcome !== 'ok') {
      this.steps.push({ stepId, phase, toolId, outcome: 'ok', summary: 'Este workspace não é um repositório Git.' });
      return;
    }

    if (toolId === GIT_STATUS_TOOL_ID) {
      const clean = output.clean === true;
      const branch = typeof output.branch === 'string' ? output.branch : 'desconhecida';
      const summary = clean ? `Branch "${branch}", sem alterações pendentes.` : `Branch "${branch}", com alterações pendentes.`;
      this.steps.push({ stepId, phase, toolId, outcome: 'ok', summary });
      return;
    }

    const diff = typeof output.diff === 'string' ? output.diff : '';
    const hasChanges = diff.trim() !== '';
    const truncated = output.truncated === true;
    const summary = hasChanges
      ? `Há alterações não commitadas${truncated ? ' (diff truncado)' : ''}.`
      : 'Não há alterações no momento.';
    this.steps.push({ stepId, phase, toolId, outcome: 'ok', summary });
  }

  private recordValidationStep(
    phase: GoalExecutionStepPhase,
    output: Readonly<Record<string, unknown>>,
  ): { readonly outcome: 'ok' | 'failed'; readonly succeeded: boolean; readonly exitCode: unknown; readonly reasonCode?: string; readonly ranAsValidation: boolean } {
    const stepId = this.currentStepId();

    if (output.outcome === 'ok') {
      const succeeded = output.succeeded === true;
      const exitCode = typeof output.exitCode === 'number' || output.exitCode === null ? output.exitCode : 'desconhecido';
      this.steps.push({
        stepId,
        phase,
        toolId: this.goal.validationToolId,
        outcome: succeeded ? 'ok' : 'failed',
        summary: `Validação "${this.goal.validationToolId}" ${succeeded ? 'concluída com sucesso' : 'falhou'} (exit code ${exitCode}).`,
      });
      return { outcome: succeeded ? 'ok' : 'failed', succeeded, exitCode, ranAsValidation: true };
    }

    const reasonCode = typeof output.reasonCode === 'string' ? output.reasonCode : 'validationRejected';
    const message = typeof output.message === 'string' ? output.message : 'Validação recusada.';
    this.steps.push({ stepId, phase, toolId: this.goal.validationToolId, outcome: 'failed', summary: message });
    return { outcome: 'failed', succeeded: false, exitCode: undefined, reasonCode, ranAsValidation: false };
  }

  private composeInvestigationMessage(exitCode: unknown): string {
    return `Investigação concluída: a validação "${this.goal.validationToolId}" está passando atualmente (exit code ${exitCode}); não encontrei evidência de falha para investigar mais a fundo.`;
  }

  /**
   * Used both when a `readOnly` goal reaches its final report, and when a
   * `writeAuthorized` goal's autonomous fix never even found a hypothesis to
   * try - the same honest, evidence-grounded diagnosis either way, differing
   * only in the closing sentence about what authorization would still be
   * needed.
   */
  private composeDiagnosisMessage(exitCode: unknown, evidence: FailureEvidence, candidates: readonly string[]): string {
    const base = `Investigação concluída: a validação "${this.goal.validationToolId}" está falhando (exit code ${exitCode}).`;
    const evidenceSentence =
      evidence.actualLiteral !== undefined && evidence.expectedLiteral !== undefined
        ? ` O teste esperava ${evidence.expectedLiteral} mas obteve ${evidence.actualLiteral}.`
        : '';
    const candidateSentence = candidates.length > 0 ? ` Possível causa em: ${candidates.join(', ')}.` : '';
    const closing =
      this.goal.authorization === 'writeAuthorized'
        ? ' Não foi possível determinar uma correção segura e concreta automaticamente a partir dessa evidência; informe o texto exato a ser substituído para eu aplicar a correção.'
        : ' Corrigir isso exigiria autorização explícita para alterar arquivos.';
    return `${base}${evidenceSentence}${candidateSentence}${closing}`;
  }

  private composeFixSuccessMessage(path: string, evidence: FailureEvidence, attempts: number, exitCode: unknown): string {
    const hypothesisSentence =
      evidence.actualLiteral !== undefined && evidence.expectedLiteral !== undefined
        ? ` (hipótese: ${evidence.actualLiteral} → ${evidence.expectedLiteral})`
        : '';
    const reconsideredSentence = attempts > 1 ? ' após reconsiderar a hipótese inicial' : '';
    return `Correção aplicada e verificada${reconsideredSentence}: "${path}" foi alterado${hypothesisSentence} e a validação "${this.goal.validationToolId}" agora passa (exit code ${exitCode}).`;
  }

  private composeFixExhaustedMessage(initialExitCode: unknown): string {
    const files = Array.from(new Set(this.filesChanged));
    return `Tentei ${files.length} hipótese(s) de correção (${files.join(', ')}), mas a validação "${this.goal.validationToolId}" continua falhando; nenhuma alteração foi revertida automaticamente - revise manualmente.`;
  }

  private statusFor(outcome: ActOutcome): GoalExecutionStatus {
    if (outcome.kind === 'incomplete') {
      return 'incomplete';
    }
    return 'failed';
  }

  private reasonFor(outcome: ActOutcome): string {
    if (outcome.kind === 'incomplete') {
      return 'stepLimitExceeded';
    }
    if (outcome.kind === 'unauthorized') {
      return 'toolNotAuthorized';
    }
    return 'unexpectedToolFailure';
  }

  private currentStepId(): string {
    return `step-${this.stepCounter}`;
  }

  private conclude(status: GoalExecutionStatus, reason: string | undefined, explicitMessage?: string): GoalExecutionResult {
    const message = explicitMessage ?? this.composeFallbackMessage(status, reason);
    return {
      objective: this.goal.objective,
      authorization: this.goal.authorization,
      status,
      steps: Object.freeze([...this.steps]),
      decisions: Object.freeze([...this.decisions]),
      filesChanged: Object.freeze(Array.from(new Set(this.filesChanged))),
      ...(reason === undefined ? {} : { reason }),
      message,
    };
  }

  private composeFallbackMessage(status: GoalExecutionStatus, reason: string | undefined): string {
    if (status === 'incomplete') {
      return `Não consegui concluir o objetivo dentro do limite de ${this.maxSteps} passos; parando com segurança. Evidências reunidas até aqui: ${this.summarizeSteps()}.`;
    }
    if (status === 'blocked') {
      return `Objetivo interrompido antes de qualquer alteração: ${this.friendlyReason(reason)}`;
    }
    return `Objetivo não concluído: ${this.friendlyReason(reason)}`;
  }

  private summarizeSteps(): string {
    if (this.steps.length === 0) {
      return 'nenhuma';
    }
    return this.steps.map((step) => step.summary).join(' ');
  }

  private friendlyReason(reason: string | undefined): string {
    switch (reason) {
      case 'toolNotAuthorized':
        return 'uma etapa exigiria uma ferramenta não autorizada para este objetivo.';
      case 'unexpectedToolFailure':
        return 'uma etapa falhou de forma inesperada.';
      case 'validationRejected':
        return 'a validação necessária não está autorizada.';
      case 'missingFixAction':
        return 'nenhuma correção concreta foi especificada.';
      case 'cognitiveTimeout':
        return 'o motor cognitivo não respondeu dentro do tempo limite.';
      case 'cognitiveUnavailable':
        return 'o motor cognitivo local não está disponível no momento.';
      case 'cognitiveInvalidResponse':
        return 'o motor cognitivo retornou respostas fora do formato esperado repetidamente.';
      case 'lowConfidence':
        return 'o motor cognitivo não teve confiança suficiente para prosseguir com segurança.';
      case 'cognitiveConcludedFailure':
        return 'o motor cognitivo concluiu que o objetivo não pode ser alcançado com segurança.';
      case 'cognitiveUnverifiedCompletion':
        return 'o motor cognitivo sinalizou conclusão sem uma verificação real.';
      case 'cognitiveNoActionableDecision':
        return 'o motor cognitivo não propôs uma ação concreta e executável.';
      case 'cognitiveToolNotInMenu':
      case 'cognitiveMissingToolId':
        return 'o motor cognitivo propôs uma ferramenta fora do conjunto permitido para este objetivo.';
      case 'cognitiveInvalidToolArguments':
        return 'o motor cognitivo propôs argumentos inválidos para a ferramenta escolhida.';
      case 'cognitiveRepeatedDecision':
        return 'a mesma ação foi proposta repetidamente sem evidência nova; encerrando para evitar um laço sem progresso.';
      case 'cognitiveBudgetExceeded':
        return 'o limite de decisões cognitivas para este objetivo foi atingido.';
      default:
        return reason ? `motivo: ${reason}.` : 'motivo não especificado.';
    }
  }
}
