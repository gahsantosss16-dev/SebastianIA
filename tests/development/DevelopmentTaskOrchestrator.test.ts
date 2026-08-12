import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DevelopmentTaskOrchestrator,
  MAX_DEVELOPMENT_TASK_STEPS,
  type DevelopmentTaskExecutionContext,
  type DevelopmentTaskPlan,
} from '../../core/development/index.js';
import { InvalidDevelopmentTaskPlanError } from '../../core/development/DevelopmentTaskErrors.js';
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

/** Scripted fake: one queue of results per toolId, consumed in call order; records every invocation for assertions. */
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

function context(): DevelopmentTaskExecutionContext {
  return { executionId: 'exec-1', responsibilityId: 'resp-1', requestedAt: '2026-08-11T00:00:00.000Z' };
}

function fullPlan(): DevelopmentTaskPlan {
  return {
    objective: 'Substituir texto em "exemplo.ts" e executar a validação "validation.test".',
    steps: [
      {
        stepId: 'edit',
        description: 'Substituir o texto indicado em "exemplo.ts".',
        toolId: FILESYSTEM_REPLACE_TEXT_TOOL_ID,
        toolInput: { path: 'exemplo.ts', searchText: 'const x = 1;', replaceText: 'const x = 2;' },
      },
      {
        stepId: 'validate',
        description: 'Executar a validação "validation.test".',
        toolId: VALIDATION_TOOL_ID,
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

test('execute runs a full plan to completion when every step succeeds', () => {
  const { tool, calls } = scriptedTool({
    [FILESYSTEM_REPLACE_TEXT_TOOL_ID]: [
      ok({ operation: 'replaceText', outcome: 'ok', path: 'exemplo.ts', message: 'Arquivo "exemplo.ts" atualizado.' }),
    ],
    [VALIDATION_TOOL_ID]: [
      ok({ operation: 'validation', outcome: 'ok', toolId: VALIDATION_TOOL_ID, succeeded: true, exitCode: 0 }),
    ],
    [GIT_STATUS_TOOL_ID]: [ok({ operation: 'status', outcome: 'ok', branch: 'main', clean: false, changedFiles: [{ status: 'M', path: 'exemplo.ts' }] })],
    [GIT_DIFF_TOOL_ID]: [ok({ operation: 'diff', outcome: 'ok', diff: '- const x = 1;\n+ const x = 2;\n', truncated: false })],
  });

  const orchestrator = new DevelopmentTaskOrchestrator(tool);
  const result = orchestrator.execute(fullPlan(), context());

  assert.equal(result.status, 'completed');
  assert.equal(result.reason, undefined);
  assert.deepEqual(result.filesChanged, ['exemplo.ts']);
  assert.equal(result.steps.length, 4);
  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.map((call) => call.toolId),
    [FILESYSTEM_REPLACE_TEXT_TOOL_ID, VALIDATION_TOOL_ID, GIT_STATUS_TOOL_ID, GIT_DIFF_TOOL_ID],
  );
  assert.ok(!result.message.includes('const x'));
  assert.ok(!JSON.stringify(result).includes('const x = 2'));
});

test('execute stops and reports blocked when the edit step is refused for an already-modified file, skipping validation', () => {
  const { tool, calls } = scriptedTool({
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

  const orchestrator = new DevelopmentTaskOrchestrator(tool);
  const result = orchestrator.execute(fullPlan(), context());

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'fileAlreadyModified');
  assert.deepEqual(result.filesChanged, []);
  assert.equal(result.steps.length, 1);
  assert.equal(calls.length, 1, 'validation and Git steps must not run once the task is blocked');
});

test('execute reports blocked for any other edit rejection (e.g. ambiguous search text), not only the dirty-file case', () => {
  const { tool, calls } = scriptedTool({
    [FILESYSTEM_REPLACE_TEXT_TOOL_ID]: [
      ok({
        operation: 'replaceText',
        outcome: 'rejected',
        path: 'exemplo.ts',
        reasonCode: 'multipleOccurrences',
        message: 'O texto indicado aparece mais de uma vez em "exemplo.ts".',
      }),
    ],
  });

  const orchestrator = new DevelopmentTaskOrchestrator(tool);
  const result = orchestrator.execute(fullPlan(), context());

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'multipleOccurrences');
  assert.equal(calls.length, 1);
});

test('execute marks the task failed when validation fails, but still runs the remaining Git steps for the report', () => {
  const { tool, calls } = scriptedTool({
    [FILESYSTEM_REPLACE_TEXT_TOOL_ID]: [
      ok({ operation: 'replaceText', outcome: 'ok', path: 'exemplo.ts', message: 'Arquivo "exemplo.ts" atualizado.' }),
    ],
    [VALIDATION_TOOL_ID]: [
      ok({ operation: 'validation', outcome: 'ok', toolId: VALIDATION_TOOL_ID, succeeded: false, exitCode: 1 }),
    ],
    [GIT_STATUS_TOOL_ID]: [ok({ operation: 'status', outcome: 'ok', branch: 'main', clean: false, changedFiles: [{ status: 'M', path: 'exemplo.ts' }] })],
    [GIT_DIFF_TOOL_ID]: [ok({ operation: 'diff', outcome: 'ok', diff: '- const x = 1;\n+ const x = 2;\n', truncated: false })],
  });

  const orchestrator = new DevelopmentTaskOrchestrator(tool);
  const result = orchestrator.execute(fullPlan(), context());

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'validationFailed');
  assert.deepEqual(result.filesChanged, ['exemplo.ts']);
  assert.equal(result.steps.length, 4);
  assert.equal(calls.length, 4, 'git status/diff must still run after a failed validation so the report reflects real state');
});

test('execute marks the task failed and continues when validation itself is rejected as not authorized', () => {
  const { tool, calls } = scriptedTool({
    [FILESYSTEM_REPLACE_TEXT_TOOL_ID]: [
      ok({ operation: 'replaceText', outcome: 'ok', path: 'exemplo.ts', message: 'Arquivo "exemplo.ts" atualizado.' }),
    ],
    [VALIDATION_TOOL_ID]: [
      ok({ operation: 'validation', outcome: 'rejected', toolId: VALIDATION_TOOL_ID, reasonCode: 'notAuthorized', message: 'A validação não está autorizada.' }),
    ],
    [GIT_STATUS_TOOL_ID]: [ok({ operation: 'status', outcome: 'ok', branch: 'main', clean: false, changedFiles: [] })],
    [GIT_DIFF_TOOL_ID]: [ok({ operation: 'diff', outcome: 'ok', diff: '', truncated: false })],
  });

  const orchestrator = new DevelopmentTaskOrchestrator(tool);
  const result = orchestrator.execute(fullPlan(), context());

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'notAuthorized');
  assert.equal(calls.length, 4);
});

test('execute treats "not a Git repository" from status/diff steps as informational, never affecting task status', () => {
  const { tool } = scriptedTool({
    [FILESYSTEM_REPLACE_TEXT_TOOL_ID]: [
      ok({ operation: 'replaceText', outcome: 'ok', path: 'exemplo.ts', message: 'Arquivo "exemplo.ts" atualizado.' }),
    ],
    [VALIDATION_TOOL_ID]: [
      ok({ operation: 'validation', outcome: 'ok', toolId: VALIDATION_TOOL_ID, succeeded: true, exitCode: 0 }),
    ],
    [GIT_STATUS_TOOL_ID]: [ok({ operation: 'status', outcome: 'rejected', reasonCode: 'notAGitRepository', message: 'Este workspace não é um repositório Git.' })],
    [GIT_DIFF_TOOL_ID]: [ok({ operation: 'diff', outcome: 'rejected', reasonCode: 'notAGitRepository', message: 'Este workspace não é um repositório Git.' })],
  });

  const orchestrator = new DevelopmentTaskOrchestrator(tool);
  const result = orchestrator.execute(fullPlan(), context());

  assert.equal(result.status, 'completed');
  assert.equal(result.steps[2]?.outcome, 'ok');
  assert.equal(result.steps[3]?.outcome, 'ok');
});

test('execute stops immediately and fails the task when a Tool invocation fails unexpectedly', () => {
  const { tool, calls } = scriptedTool({
    [FILESYSTEM_REPLACE_TEXT_TOOL_ID]: [failed()],
  });

  const orchestrator = new DevelopmentTaskOrchestrator(tool);
  const result = orchestrator.execute(fullPlan(), context());

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'unexpectedToolFailure');
  assert.equal(calls.length, 1);
});

test('execute refuses a plan step naming a toolId outside the fixed allow-list, without invoking anything', () => {
  const { tool, calls } = scriptedTool({});
  const plan: DevelopmentTaskPlan = {
    objective: 'Tentativa maliciosa.',
    steps: [
      { stepId: 'shell', description: 'Executar comando arbitrário.', toolId: 'shell.run', toolInput: {} },
    ],
  };

  const orchestrator = new DevelopmentTaskOrchestrator(tool);
  const result = orchestrator.execute(plan, context());

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'toolNotAuthorized');
  assert.equal(calls.length, 0);
});

test('execute refuses a plan whose step count exceeds the hard step limit, without invoking anything', () => {
  const { tool, calls } = scriptedTool({});
  const steps = Array.from({ length: MAX_DEVELOPMENT_TASK_STEPS + 1 }, (_unused, index) => ({
    stepId: `status-${index}`,
    description: 'Consultar o estado do repositório Git.',
    toolId: GIT_STATUS_TOOL_ID,
    toolInput: {},
  }));

  const orchestrator = new DevelopmentTaskOrchestrator(tool);
  const result = orchestrator.execute({ objective: 'Plano longo demais.', steps }, context());

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'stepLimitExceeded');
  assert.equal(result.steps.length, 0);
  assert.equal(calls.length, 0);
});

test('a custom, smaller maxSteps is honored by the orchestrator constructor', () => {
  const { tool, calls } = scriptedTool({});
  const steps = Array.from({ length: 3 }, (_unused, index) => ({
    stepId: `status-${index}`,
    description: 'Consultar o estado do repositório Git.',
    toolId: GIT_STATUS_TOOL_ID,
    toolInput: {},
  }));

  const orchestrator = new DevelopmentTaskOrchestrator(tool, 2);
  const result = orchestrator.execute({ objective: 'Plano acima do limite customizado.', steps }, context());

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'stepLimitExceeded');
  assert.equal(calls.length, 0);
});

test('execute never runs past the hard step limit even when every step individually succeeds', () => {
  const { tool, calls } = scriptedTool({
    [GIT_STATUS_TOOL_ID]: Array.from({ length: MAX_DEVELOPMENT_TASK_STEPS }, () =>
      ok({ operation: 'status', outcome: 'ok', branch: 'main', clean: true, changedFiles: [] }),
    ),
  });
  const steps = Array.from({ length: MAX_DEVELOPMENT_TASK_STEPS }, (_unused, index) => ({
    stepId: `status-${index}`,
    description: 'Consultar o estado do repositório Git.',
    toolId: GIT_STATUS_TOOL_ID,
    toolInput: {},
  }));

  const orchestrator = new DevelopmentTaskOrchestrator(tool);
  const result = orchestrator.execute({ objective: 'Plano no limite exato.', steps }, context());

  assert.equal(result.status, 'completed');
  assert.equal(result.steps.length, MAX_DEVELOPMENT_TASK_STEPS);
  assert.equal(calls.length, MAX_DEVELOPMENT_TASK_STEPS);
});

test('constructor rejects a specialized tool dependency without invoke', () => {
  assert.throws(
    () => new DevelopmentTaskOrchestrator({} as never),
    (error: unknown) => {
      assert.ok(error instanceof InvalidDevelopmentTaskPlanError);
      return true;
    },
  );
});

test('constructor rejects a non-positive-integer maxSteps', () => {
  const { tool } = scriptedTool({});
  assert.throws(
    () => new DevelopmentTaskOrchestrator(tool, 0),
    (error: unknown) => {
      assert.ok(error instanceof InvalidDevelopmentTaskPlanError);
      return true;
    },
  );
});

test('execute rejects a plan with no steps', () => {
  const { tool } = scriptedTool({});
  const orchestrator = new DevelopmentTaskOrchestrator(tool);

  assert.throws(
    () => orchestrator.execute({ objective: 'x', steps: [] }, context()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidDevelopmentTaskPlanError);
      return true;
    },
  );
});

test('execute rejects a plan step missing required fields', () => {
  const { tool } = scriptedTool({});
  const orchestrator = new DevelopmentTaskOrchestrator(tool);
  const plan = { objective: 'x', steps: [{ stepId: '', description: 'y', toolId: GIT_STATUS_TOOL_ID, toolInput: {} }] } as DevelopmentTaskPlan;

  assert.throws(
    () => orchestrator.execute(plan, context()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidDevelopmentTaskPlanError);
      return true;
    },
  );
});

test('execute rejects an invalid execution context', () => {
  const { tool } = scriptedTool({});
  const orchestrator = new DevelopmentTaskOrchestrator(tool);

  assert.throws(
    () => orchestrator.execute(fullPlan(), {} as never),
    (error: unknown) => {
      assert.ok(error instanceof InvalidDevelopmentTaskPlanError);
      return true;
    },
  );
});
