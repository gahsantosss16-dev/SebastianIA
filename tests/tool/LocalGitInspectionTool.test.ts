import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GIT_STATUS_TOOL_ID,
  GIT_DIFF_TOOL_ID,
  LocalGitInspectionTool,
} from '../../core/tool/LocalGitInspectionTool.js';
import { InvalidSpecializedToolInvocationInputError } from '../../core/tool/SpecializedToolInvocationErrors.js';
import type { SpecializedToolInvocationInput } from '../../core/tool/SpecializedToolInvocationContract.js';

function withFixtureRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-git-tool-'));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function initGitRepo(dir: string): void {
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Sebastian Test'], { cwd: dir });
}

function commitAll(dir: string, message: string): void {
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

function invocation(toolId: string): SpecializedToolInvocationInput {
  return {
    toolId,
    executionId: 'converse:2026-08-12T00:00:00.000Z',
    responsibilityId: 'capability.execute.converse',
    requestedAt: '2026-08-12T00:00:00.000Z',
    payload: {},
  };
}

test('reports a clean status for a repository with no changes', () => {
  withFixtureRoot((root) => {
    initGitRepo(root);
    writeFileSync(join(root, 'a.txt'), 'x');
    commitAll(root, 'initial commit');

    const tool = new LocalGitInspectionTool(root);
    const result = tool.invoke(invocation(GIT_STATUS_TOOL_ID));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.outcome, 'ok');
    assert.equal(result.output.clean, true);
    assert.deepEqual(result.output.changedFiles, []);
    assert.ok((result.output.message as string).includes('sem alterações pendentes'));
  });
});

test('reports the current branch and changed files for a repository with modifications', () => {
  withFixtureRoot((root) => {
    initGitRepo(root);
    writeFileSync(join(root, 'a.txt'), 'original');
    commitAll(root, 'initial commit');
    writeFileSync(join(root, 'a.txt'), 'changed');
    writeFileSync(join(root, 'b.txt'), 'new file');

    const tool = new LocalGitInspectionTool(root);
    const result = tool.invoke(invocation(GIT_STATUS_TOOL_ID));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.outcome, 'ok');
    assert.equal(result.output.clean, false);
    assert.equal(typeof result.output.branch, 'string');
    const changedFiles = result.output.changedFiles as ReadonlyArray<{ path: string }>;
    assert.deepEqual(
      changedFiles.map((entry) => entry.path).sort(),
      ['a.txt', 'b.txt'],
    );
  });
});

test('reports a friendly rejection for status/diff when the workspace is not a Git repository', () => {
  withFixtureRoot((root) => {
    const tool = new LocalGitInspectionTool(root);

    const statusResult = tool.invoke(invocation(GIT_STATUS_TOOL_ID));
    assert.equal(statusResult.status, 'completed');
    if (statusResult.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(statusResult.output.outcome, 'rejected');
    assert.equal(statusResult.output.reasonCode, 'notAGitRepository');

    const diffResult = tool.invoke(invocation(GIT_DIFF_TOOL_ID));
    assert.equal(diffResult.status, 'completed');
    if (diffResult.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(diffResult.output.outcome, 'rejected');
    assert.equal(diffResult.output.reasonCode, 'notAGitRepository');
  });
});

test('reports no changes clearly when diff is requested on a clean repository', () => {
  withFixtureRoot((root) => {
    initGitRepo(root);
    writeFileSync(join(root, 'a.txt'), 'x');
    commitAll(root, 'initial commit');

    const tool = new LocalGitInspectionTool(root);
    const result = tool.invoke(invocation(GIT_DIFF_TOOL_ID));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.outcome, 'ok');
    assert.equal(result.output.message, 'Não há alterações no momento.');
  });
});

test('reports the real unstaged diff content for a modified file', () => {
  withFixtureRoot((root) => {
    initGitRepo(root);
    writeFileSync(join(root, 'a.txt'), 'linha original\n');
    commitAll(root, 'initial commit');
    writeFileSync(join(root, 'a.txt'), 'linha modificada\n');

    const tool = new LocalGitInspectionTool(root);
    const result = tool.invoke(invocation(GIT_DIFF_TOOL_ID));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.outcome, 'ok');
    const diff = result.output.diff as string;
    assert.ok(diff.includes('linha modificada'));
    assert.ok((result.output.message as string).startsWith('Diff atual:'));
  });
});

test('scopes status and diff to the allowed root, never revealing changes outside it', () => {
  withFixtureRoot((parent) => {
    const root = join(parent, 'projeto');
    const outside = join(parent, 'fora');
    mkdirSync(root);
    mkdirSync(outside);
    initGitRepo(parent);
    writeFileSync(join(root, 'dentro.txt'), 'x');
    writeFileSync(join(outside, 'fora.txt'), 'x');
    commitAll(parent, 'initial commit');
    writeFileSync(join(root, 'dentro.txt'), 'mudou');
    writeFileSync(join(outside, 'fora.txt'), 'mudou');

    const tool = new LocalGitInspectionTool(root);
    const result = tool.invoke(invocation(GIT_STATUS_TOOL_ID));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    // git reports paths relative to the repository root ("projeto" is a
    // subdirectory of the actual repo root here) - the security property
    // under test is that "fora.txt" (outside the allowed root) never
    // appears, regardless of the exact path prefix git chooses to print.
    const changedFiles = result.output.changedFiles as ReadonlyArray<{ path: string }>;
    assert.equal(changedFiles.length, 1);
    assert.ok(changedFiles[0]?.path.endsWith('dentro.txt'));
    assert.ok(!changedFiles.some((entry) => entry.path.includes('fora.txt')));
  });
});

test('rejects an unsupported toolId', () => {
  withFixtureRoot((root) => {
    const tool = new LocalGitInspectionTool(root);

    assert.throws(
      () => tool.invoke(invocation('git.commit')),
      (error: unknown) => {
        assert.ok(error instanceof InvalidSpecializedToolInvocationInputError);
        return true;
      },
    );
  });
});

test('rejects a non-empty allowed root argument requirement', () => {
  assert.throws(
    () => new LocalGitInspectionTool('   '),
    (error: unknown) => {
      assert.ok(error instanceof InvalidSpecializedToolInvocationInputError);
      return true;
    },
  );
});
