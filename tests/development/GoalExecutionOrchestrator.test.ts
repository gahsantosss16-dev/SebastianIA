import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GoalExecutionOrchestrator,
  MAX_GOAL_EXECUTION_STEPS,
  type GoalExecutionContext,
  type GoalDefinition,
} from '../../core/development/index.js';
import { InvalidGoalExecutionInputError } from '../../core/development/GoalExecutionErrors.js';
import { FILESYSTEM_REPLACE_TEXT_TOOL_ID } from '../../core/tool/LocalFilesystemInspectionTool.js';
import { GIT_STATUS_TOOL_ID, GIT_DIFF_TOOL_ID } from '../../core/tool/LocalGitInspectionTool.js';
import type {
  SpecializedTool,
  SpecializedToolInvocationInput,
  SpecializedToolInvocationResult,
} from '../../core/tool/SpecializedToolInvocationContract.js';

const VALIDATION_TOOL_ID = 'validation.test';

function ok(output: Readonly<Record<string, unknown>>): SpecializedToolInvocationResult {
  return { status: 'completed', output };
}

function failed(): SpecializedToolInvocationResult {
  return { status: 'failed', error: new Error('boom') };
}

function scriptedTool(responses: Readonly<Record<string, readonly SpecializedToolInvocationResult[]>>): {
  readonly tool: SpecializedTool;
  readonly calls: SpecializedToolInvocationInput[];
} {
  const queues = new Map<string, SpecializedToolInvocationResult[]>(
    Object.entries(responses).map(([toolId, results]) => [toolId, [...results]]),
  );
  const calls: SpecializedToolInvocationInput[] = [];

  return {
    calls,
    tool: {
      invoke(input) {
        calls.push(input);
        const queue = queues.get(input.toolId);
        const next = queue?.shift();
        if (!next) {
          throw new Error(`Unexpected invocation of toolId "${input.toolId}" in test double.`);
        }
        return next;
      },
    },
  };
}

function context(): GoalExecutionContext {
  return { executionId: 'exec-1', responsibilityId: 'resp-1', requestedAt: '2026-08-12T00:00:00.000Z' };
}

function investigateGoal(overrides: Partial<GoalDefinition> = {}): GoalDefinition {
  return {
    objective: 'Descubra por que os testes estão falhando.',
    authorization: 'readOnly',
    validationToolId: VALIDATION_TOOL_ID,
    ...overrides,
  };
}

function statusOk(clean: boolean): SpecializedToolInvocationResult {
  return ok({ operation: 'status', outcome: 'ok', branch: 'main', clean, changedFiles: clean ? [] : [{ status: 'M', path: 'exemplo.ts' }] });
}

function diffOk(hasChanges: boolean): SpecializedToolInvocationResult {
  return ok({ operation: 'diff', outcome: 'ok', diff: hasChanges ? '- a\n+ b\n' : '', truncated: false });
}

function validationOk(succeeded: boolean, exitCode: number): SpecializedToolInvocationResult {
  return ok({ operation: 'validation', outcome: 'ok', toolId: VALIDATION_TOOL_ID, succeeded, exitCode });
}

test('investigate: validation already passing adapts the plan, skipping the diff step, and concludes completed', () => {
  const { tool, calls } = scriptedTool({
    [GIT_STATUS_TOOL_ID]: [statusOk(true)],
    [VALIDATION_TOOL_ID]: [validationOk(true, 0)],
  });
  const orchestrator = new GoalExecutionOrchestrator(tool);

  const result = orchestrator.execute(investigateGoal(), context());

  assert.equal(result.status, 'completed');
  assert.equal(result.authorization, 'readOnly');
  assert.deepEqual(result.filesChanged, []);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.toolId), [GIT_STATUS_TOOL_ID, VALIDATION_TOOL_ID]);
  assert.ok(result.message.includes('passando'));
  assert.equal(result.decisions.length, 1);
});

test('investigate: validation failing gathers a diff as further evidence, and concludes completed with the evidence, never touching fs.replaceText', () => {
  const { tool, calls } = scriptedTool({
    [GIT_STATUS_TOOL_ID]: [statusOk(false)],
    [VALIDATION_TOOL_ID]: [validationOk(false, 1)],
    [GIT_DIFF_TOOL_ID]: [diffOk(true)],
  });
  const orchestrator = new GoalExecutionOrchestrator(tool);

  const result = orchestrator.execute(investigateGoal(), context());

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.filesChanged, []);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => call.toolId), [GIT_STATUS_TOOL_ID, VALIDATION_TOOL_ID, GIT_DIFF_TOOL_ID]);
  assert.ok(result.message.includes('falhando'));
  assert.ok(result.message.includes('autorização explícita para alterar arquivos'));
  assert.ok(!calls.some((call) => call.toolId === FILESYSTEM_REPLACE_TEXT_TOOL_ID));
});

test('investigate: write-authorized but with no concrete fix still never edits, and reports it could not determine a safe fix', () => {
  const { tool, calls } = scriptedTool({
    [GIT_STATUS_TOOL_ID]: [statusOk(false)],
    [VALIDATION_TOOL_ID]: [validationOk(false, 1)],
    [GIT_DIFF_TOOL_ID]: [diffOk(true)],
  });
  const orchestrator = new GoalExecutionOrchestrator(tool);
  const goal = investigateGoal({ authorization: 'writeAuthorized' });

  const result = orchestrator.execute(goal, context());

  assert.equal(result.status, 'completed');
  assert.ok(result.message.includes('Não foi possível determinar uma correção segura'));
  assert.ok(!calls.some((call) => call.toolId === FILESYSTEM_REPLACE_TEXT_TOOL_ID));
});

test('fix: applies the concrete edit and concludes completed once verification confirms the validation now passes', () => {
  const { tool, calls } = scriptedTool({
    [GIT_STATUS_TOOL_ID]: [statusOk(true)],
    [FILESYSTEM_REPLACE_TEXT_TOOL_ID]: [
      ok({ operation: 'replaceText', outcome: 'ok', path: 'exemplo.ts', message: 'Arquivo "exemplo.ts" atualizado.' }),
    ],
    [VALIDATION_TOOL_ID]: [validationOk(true, 0)],
    [GIT_DIFF_TOOL_ID]: [diffOk(true)],
  });
  const orchestrator = new GoalExecutionOrchestrator(tool);
  const goal: GoalDefinition = {
    objective: 'Corrija o arquivo exemplo.ts substituindo const x = 1; por const x = 2;',
    authorization: 'writeAuthorized',
    validationToolId: VALIDATION_TOOL_ID,
    fix: { path: 'exemplo.ts', searchText: 'const x = 1;', replaceText: 'const x = 2;' },
  };

  const result = orchestrator.execute(goal, context());

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.filesChanged, ['exemplo.ts']);
  assert.deepEqual(
    calls.map((call) => call.toolId),
    [GIT_STATUS_TOOL_ID, FILESYSTEM_REPLACE_TEXT_TOOL_ID, VALIDATION_TOOL_ID, GIT_DIFF_TOOL_ID],
  );
  assert.ok(result.message.includes('verificada'));
});

test('fix: an edit that does not make the validation pass is reported as failed, not completed - action executed is not the same as goal achieved', () => {
  const { tool } = scriptedTool({
    [GIT_STATUS_TOOL_ID]: [statusOk(true)],
    [FILESYSTEM_REPLACE_TEXT_TOOL_ID]: [
      ok({ operation: 'replaceText', outcome: 'ok', path: 'exemplo.ts', message: 'Arquivo "exemplo.ts" atualizado.' }),
    ],
    [VALIDATION_TOOL_ID]: [validationOk(false, 1)],
    [GIT_DIFF_TOOL_ID]: [diffOk(true)],
  });
  const orchestrator = new GoalExecutionOrchestrator(tool);
  const goal: GoalDefinition = {
    objective: 'Corrija o arquivo exemplo.ts substituindo const x = 1; por const x = 2;',
    authorization: 'writeAuthorized',
    validationToolId: VALIDATION_TOOL_ID,
    fix: { path: 'exemplo.ts', searchText: 'const x = 1;', replaceText: 'const x = 2;' },
  };

  const result = orchestrator.execute(goal, context());

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'verificationFailed');
  assert.deepEqual(result.filesChanged, ['exemplo.ts'], 'the edit must be preserved for review, never rolled back');
  assert.ok(result.message.includes('ainda falha'));
});

test('fix: refused when the target already has uncommitted changes, stopping before any verification', () => {
  const { tool, calls } = scriptedTool({
    [GIT_STATUS_TOOL_ID]: [statusOk(false)],
    [FILESYSTEM_REPLACE_TEXT_TOOL_ID]: [
      ok({
        operation: 'replaceText',
        outcome: 'rejected',
        path: 'exemplo.ts',
        reasonCode: 'fileAlreadyModified',
        message: '"exemplo.ts" já possui alterações não commitadas; não vou editá-lo automaticamente.',
      }),
    ],
  });
  const orchestrator = new GoalExecutionOrchestrator(tool);
  const goal: GoalDefinition = {
    objective: 'Corrija o arquivo exemplo.ts substituindo X por Y',
    authorization: 'writeAuthorized',
    validationToolId: VALIDATION_TOOL_ID,
    fix: { path: 'exemplo.ts', searchText: 'X', replaceText: 'Y' },
  };

  const result = orchestrator.execute(goal, context());

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'fileAlreadyModified');
  assert.deepEqual(result.filesChanged, []);
  assert.equal(calls.length, 2, 'must stop right after the refused edit, never reaching verification');
});

test('a read-only goal that happens to also carry a concrete fix never invokes fs.replaceText - it investigates instead', () => {
  const { tool, calls } = scriptedTool({
    [GIT_STATUS_TOOL_ID]: [statusOk(true)],
    [VALIDATION_TOOL_ID]: [validationOk(true, 0)],
  });
  const orchestrator = new GoalExecutionOrchestrator(tool);
  const goal: GoalDefinition = {
    objective: 'x',
    authorization: 'readOnly',
    validationToolId: VALIDATION_TOOL_ID,
    fix: { path: 'exemplo.ts', searchText: 'X', replaceText: 'Y' },
  };

  const result = orchestrator.execute(goal, context());

  assert.equal(result.status, 'completed');
  assert.ok(!calls.some((call) => call.toolId === FILESYSTEM_REPLACE_TEXT_TOOL_ID));
});

test('git.status/git.diff "not a git repository" is treated as informational and never changes the outcome', () => {
  const { tool } = scriptedTool({
    [GIT_STATUS_TOOL_ID]: [ok({ operation: 'status', outcome: 'rejected', reasonCode: 'notAGitRepository', message: 'x' })],
    [VALIDATION_TOOL_ID]: [validationOk(false, 1)],
    [GIT_DIFF_TOOL_ID]: [ok({ operation: 'diff', outcome: 'rejected', reasonCode: 'notAGitRepository', message: 'x' })],
  });
  const orchestrator = new GoalExecutionOrchestrator(tool);

  const result = orchestrator.execute(investigateGoal(), context());

  assert.equal(result.status, 'completed');
  assert.equal(result.steps[0]?.outcome, 'ok');
  assert.equal(result.steps[2]?.outcome, 'ok');
});

test('a validation toolId outside the fixed allow-list is refused as a safe stop, without ever being invoked', () => {
  const { tool, calls } = scriptedTool({ [GIT_STATUS_TOOL_ID]: [statusOk(true)] });
  const orchestrator = new GoalExecutionOrchestrator(tool);

  const result = orchestrator.execute(investigateGoal({ validationToolId: 'shell.run' }), context());

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'toolNotAuthorized');
  assert.equal(calls.length, 1, 'only the initial git.status inspection should have run');
  assert.ok(!calls.some((call) => call.toolId === 'shell.run'));
});

test('an unexpected Tool failure stops the goal immediately as failed', () => {
  const { tool, calls } = scriptedTool({ [GIT_STATUS_TOOL_ID]: [failed()] });
  const orchestrator = new GoalExecutionOrchestrator(tool);

  const result = orchestrator.execute(investigateGoal(), context());

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'unexpectedToolFailure');
  assert.equal(calls.length, 1);
});

test('an objective incapable of converging stops deterministically at the step limit instead of looping (SPEC-046 required proof)', () => {
  const { tool, calls } = scriptedTool({ [GIT_STATUS_TOOL_ID]: [statusOk(true)] });
  const orchestrator = new GoalExecutionOrchestrator(tool, 1);

  const result = orchestrator.execute(investigateGoal(), context());

  assert.equal(result.status, 'incomplete');
  assert.equal(result.reason, 'stepLimitExceeded');
  assert.equal(calls.length, 1, 'the orchestrator must stop before attempting a second Tool call');
  assert.equal(result.steps.length, 1, 'the one evidence-gathering step already taken must be preserved in the report');
  assert.ok(result.message.includes('limite de 1'));
});

test('the default step limit is centralized as an exported constant, not scattered magic numbers', () => {
  assert.equal(typeof MAX_GOAL_EXECUTION_STEPS, 'number');
  assert.ok(MAX_GOAL_EXECUTION_STEPS >= 1);
});

test('a custom, smaller maxSteps is honored by the orchestrator constructor', () => {
  const { tool, calls } = scriptedTool({
    [GIT_STATUS_TOOL_ID]: [statusOk(false)],
    [VALIDATION_TOOL_ID]: [validationOk(false, 1)],
  });
  const orchestrator = new GoalExecutionOrchestrator(tool, 2);

  const result = orchestrator.execute(investigateGoal(), context());

  assert.equal(result.status, 'incomplete');
  assert.equal(calls.length, 2, 'must stop right after the second step (validation), never reaching the diff step');
});

test('constructor rejects a specialized tool dependency without invoke', () => {
  assert.throws(
    () => new GoalExecutionOrchestrator({} as never),
    (error: unknown) => {
      assert.ok(error instanceof InvalidGoalExecutionInputError);
      return true;
    },
  );
});

test('constructor rejects a non-positive-integer maxSteps', () => {
  const { tool } = scriptedTool({});
  assert.throws(
    () => new GoalExecutionOrchestrator(tool, 0),
    (error: unknown) => {
      assert.ok(error instanceof InvalidGoalExecutionInputError);
      return true;
    },
  );
});

test('execute rejects a goal with an invalid authorization value', () => {
  const { tool } = scriptedTool({});
  const orchestrator = new GoalExecutionOrchestrator(tool);

  assert.throws(
    () => orchestrator.execute(investigateGoal({ authorization: 'admin' as never }), context()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidGoalExecutionInputError);
      return true;
    },
  );
});

test('execute rejects a goal with a malformed fix action', () => {
  const { tool } = scriptedTool({});
  const orchestrator = new GoalExecutionOrchestrator(tool);
  const goal = investigateGoal({ authorization: 'writeAuthorized', fix: { path: '', searchText: 'x', replaceText: 'y' } });

  assert.throws(
    () => orchestrator.execute(goal, context()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidGoalExecutionInputError);
      return true;
    },
  );
});

test('execute rejects an invalid execution context', () => {
  const { tool } = scriptedTool({});
  const orchestrator = new GoalExecutionOrchestrator(tool);

  assert.throws(
    () => orchestrator.execute(investigateGoal(), {} as never),
    (error: unknown) => {
      assert.ok(error instanceof InvalidGoalExecutionInputError);
      return true;
    },
  );
});
