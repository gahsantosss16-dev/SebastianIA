import { realpathSync } from 'node:fs';
import { isAbsolute, join, normalize, relative } from 'node:path';

export type LocalFilesystemPathRejectionReason = 'absolutePathRejected' | 'outsideRoot' | 'notFound';

export interface LocalFilesystemPathResolutionOk {
  readonly outcome: 'ok';
  readonly absolutePath: string;
}

export interface LocalFilesystemPathResolutionRejected {
  readonly outcome: 'rejected';
  readonly reason: LocalFilesystemPathRejectionReason;
}

export type LocalFilesystemPathResolution = LocalFilesystemPathResolutionOk | LocalFilesystemPathResolutionRejected;

/**
 * Canonicalizes the allowed root once, resolving symlinks so every later
 * containment check compares real, on-disk locations rather than raw
 * strings - the only way to avoid both the "C:\projeto" vs
 * "C:\projeto-malicioso" textual-prefix trap and drive/case quirks.
 */
export function canonicalizeAllowedRoot(root: string): string {
  return realpathSync(root);
}

/**
 * Resolves a user-requested relative path against the (already
 * canonicalized) allowed root, rejecting anything that is not a genuine,
 * read-only-safe descendant of that root:
 *
 * - absolute paths are rejected outright, whether or not they would
 *   textually land inside the root;
 * - lexical traversal ("../..") is caught before any disk access, so a
 *   syntactic escape attempt against a path that does not even exist never
 *   reaches the filesystem;
 * - the final, realpath-resolved location is re-checked for containment,
 *   which is what catches a symlink that lexically sits inside the root but
 *   whose target escapes it.
 */
export function resolvePathWithinAllowedRoot(
  canonicalAllowedRoot: string,
  requestedPath: string,
): LocalFilesystemPathResolution {
  if (isAbsolute(requestedPath)) {
    return { outcome: 'rejected', reason: 'absolutePathRejected' };
  }

  const lexicalTarget = normalize(join(canonicalAllowedRoot, requestedPath));
  if (!isWithinRoot(canonicalAllowedRoot, lexicalTarget)) {
    return { outcome: 'rejected', reason: 'outsideRoot' };
  }

  let canonicalTarget: string;
  try {
    canonicalTarget = realpathSync(lexicalTarget);
  } catch {
    return { outcome: 'rejected', reason: 'notFound' };
  }

  if (!isWithinRoot(canonicalAllowedRoot, canonicalTarget)) {
    return { outcome: 'rejected', reason: 'outsideRoot' };
  }

  return { outcome: 'ok', absolutePath: canonicalTarget };
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  if (relativePath === '') {
    return true;
  }
  return !relativePath.startsWith('..') && !isAbsolute(relativePath);
}
