import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGitCommand } from '../../core/tool/LocalGitCommandRunner.js';

function withFixtureRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-git-runner-'));
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

test('reports ranAsGitRepo: false for a directory that is not a git repository', () => {
  withFixtureRoot((root) => {
    const outcome = runGitCommand(root, ['status', '--porcelain=v1']);

    assert.equal(outcome.ranAsGitRepo, false);
  });
});

test('reports ranAsGitRepo: true and captures stdout for a real git repository', () => {
  withFixtureRoot((root) => {
    initGitRepo(root);
    writeFileSync(join(root, 'a.txt'), 'x');
    commitAll(root, 'initial commit');

    const outcome = runGitCommand(root, ['status', '--porcelain=v1']);

    assert.equal(outcome.ranAsGitRepo, true);
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.stdout.trim(), '');
  });
});

test('captures real, non-empty status output for a modified file', () => {
  withFixtureRoot((root) => {
    initGitRepo(root);
    writeFileSync(join(root, 'a.txt'), 'original');
    commitAll(root, 'initial commit');
    writeFileSync(join(root, 'a.txt'), 'changed');

    const outcome = runGitCommand(root, ['status', '--porcelain=v1']);

    assert.equal(outcome.ranAsGitRepo, true);
    assert.ok(outcome.stdout.includes('a.txt'));
  });
});

test('never throws for a nonexistent git executable scenario surrogate (unsupported subcommand)', () => {
  withFixtureRoot((root) => {
    initGitRepo(root);

    const outcome = runGitCommand(root, ['not-a-real-git-subcommand']);

    assert.equal(outcome.ranAsGitRepo, false);
  });
});

test('scopes status to a specific pathspec when provided', () => {
  withFixtureRoot((root) => {
    initGitRepo(root);
    writeFileSync(join(root, 'a.txt'), 'original');
    writeFileSync(join(root, 'b.txt'), 'original');
    commitAll(root, 'initial commit');
    writeFileSync(join(root, 'a.txt'), 'changed');
    writeFileSync(join(root, 'b.txt'), 'changed');

    const outcome = runGitCommand(root, ['status', '--porcelain=v1', '--', 'a.txt']);

    assert.equal(outcome.ranAsGitRepo, true);
    assert.ok(outcome.stdout.includes('a.txt'));
    assert.ok(!outcome.stdout.includes('b.txt'));
  });
});
