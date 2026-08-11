import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalizeAllowedRoot,
  resolvePathWithinAllowedRoot,
} from '../../core/tool/LocalFilesystemPathGuard.js';

function withFixtureRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-path-guard-'));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('resolves a plain relative path inside the allowed root', () => {
  withFixtureRoot((root) => {
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'notes.txt'), 'hello');
    const canonicalRoot = canonicalizeAllowedRoot(root);

    const resolution = resolvePathWithinAllowedRoot(canonicalRoot, join('docs', 'notes.txt'));

    assert.equal(resolution.outcome, 'ok');
    if (resolution.outcome !== 'ok') {
      assert.fail('Expected ok outcome.');
    }
    assert.equal(resolution.absolutePath, canonicalizeAllowedRoot(join(root, 'docs', 'notes.txt')));
  });
});

test('resolves the root itself for an empty or "." request', () => {
  withFixtureRoot((root) => {
    const canonicalRoot = canonicalizeAllowedRoot(root);

    assert.deepEqual(resolvePathWithinAllowedRoot(canonicalRoot, '.'), {
      outcome: 'ok',
      absolutePath: canonicalRoot,
    });
    assert.deepEqual(resolvePathWithinAllowedRoot(canonicalRoot, ''), {
      outcome: 'ok',
      absolutePath: canonicalRoot,
    });
  });
});

test('rejects an absolute path regardless of whether it would land inside the root', () => {
  withFixtureRoot((root) => {
    mkdirSync(join(root, 'docs'));
    const canonicalRoot = canonicalizeAllowedRoot(root);

    assert.deepEqual(resolvePathWithinAllowedRoot(canonicalRoot, join(root, 'docs')), {
      outcome: 'rejected',
      reason: 'absolutePathRejected',
    });
  });
});

test('rejects lexical traversal without touching the filesystem', () => {
  withFixtureRoot((root) => {
    const canonicalRoot = canonicalizeAllowedRoot(root);

    assert.deepEqual(resolvePathWithinAllowedRoot(canonicalRoot, join('..', '..', 'etc', 'passwd')), {
      outcome: 'rejected',
      reason: 'outsideRoot',
    });
  });
});

test('rejects traversal that lexically escapes to a real sibling directory', () => {
  const parent = mkdtempSync(join(tmpdir(), 'sebastian-path-guard-parent-'));
  const root = join(parent, 'projeto');
  const sibling = join(parent, 'projeto-secreto');
  mkdirSync(root);
  mkdirSync(sibling);
  writeFileSync(join(sibling, 'segredo.txt'), 'top secret');

  try {
    const canonicalRoot = canonicalizeAllowedRoot(root);

    assert.deepEqual(
      resolvePathWithinAllowedRoot(canonicalRoot, join('..', 'projeto-secreto', 'segredo.txt')),
      { outcome: 'rejected', reason: 'outsideRoot' },
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('does not confuse a sibling directory that textually shares the root as a prefix', () => {
  const parent = mkdtempSync(join(tmpdir(), 'sebastian-path-guard-prefix-'));
  const root = join(parent, 'projeto');
  const lookalike = join(parent, 'projeto-malicioso');
  mkdirSync(root);
  mkdirSync(lookalike);
  writeFileSync(join(lookalike, 'x.txt'), 'x');

  try {
    const canonicalRoot = canonicalizeAllowedRoot(root);

    // A naive string-prefix check would treat "projeto-malicioso" as being
    // "inside" "projeto" because the text starts the same way; the guard
    // must reject it because it is a sibling, not a descendant.
    const resolution = resolvePathWithinAllowedRoot(canonicalRoot, join('..', 'projeto-malicioso', 'x.txt'));
    assert.deepEqual(resolution, { outcome: 'rejected', reason: 'outsideRoot' });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('reports notFound for a path that does not exist inside the root', () => {
  withFixtureRoot((root) => {
    const canonicalRoot = canonicalizeAllowedRoot(root);

    assert.deepEqual(resolvePathWithinAllowedRoot(canonicalRoot, 'nao-existe.txt'), {
      outcome: 'rejected',
      reason: 'notFound',
    });
  });
});

test('rejects a directory symlink whose real target escapes the allowed root', () => {
  const parent = mkdtempSync(join(tmpdir(), 'sebastian-path-guard-symlink-'));
  const root = join(parent, 'projeto');
  const outside = join(parent, 'fora-da-raiz');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, 'segredo.txt'), 'top secret');

  const linkPath = join(root, 'atalho');
  let symlinkCreated = true;
  try {
    symlinkSync(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    symlinkCreated = false;
  }

  try {
    if (!symlinkCreated) {
      return;
    }

    const canonicalRoot = canonicalizeAllowedRoot(root);
    const resolution = resolvePathWithinAllowedRoot(canonicalRoot, join('atalho', 'segredo.txt'));

    assert.deepEqual(resolution, { outcome: 'rejected', reason: 'outsideRoot' });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
