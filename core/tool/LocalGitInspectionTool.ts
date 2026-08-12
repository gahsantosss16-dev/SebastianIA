import {
  type SpecializedTool,
  type SpecializedToolInvocationInput,
  type SpecializedToolInvocationResult,
} from './SpecializedToolInvocationContract.js';
import {
  InvalidSpecializedToolInvocationInputError,
  SpecializedToolInvocationFailureError,
} from './SpecializedToolInvocationErrors.js';
import { runGitCommand } from './LocalGitCommandRunner.js';

export const GIT_STATUS_TOOL_ID = 'git.status';
export const GIT_DIFF_TOOL_ID = 'git.diff';

const MAX_DIFF_OUTPUT_BYTES = 64 * 1024;
const MAX_STATUS_ENTRIES = 500;
const NOT_A_GIT_REPOSITORY_MESSAGE = 'Este workspace não é um repositório Git.';

type GitOperation = 'status' | 'diff';

interface GitChangedFile {
  readonly status: string;
  readonly path: string;
}

interface GitOperationOkOutput {
  readonly operation: GitOperation;
  readonly outcome: 'ok';
  readonly message: string;
  readonly branch?: string;
  readonly clean?: boolean;
  readonly changedFiles?: readonly GitChangedFile[];
  readonly diff?: string;
  readonly truncated?: boolean;
}

interface GitOperationRejectedOutput {
  readonly operation: GitOperation;
  readonly outcome: 'rejected';
  readonly reasonCode: 'notAGitRepository';
  readonly message: string;
}

type GitOperationOutput = GitOperationOkOutput | GitOperationRejectedOutput;

/**
 * Read-only Git inspection, scoped to the allowed root exactly like every
 * other Tool in this family (`-- .` restricts both status and diff to the
 * allowed root's own subtree, so a root that happens to be a subdirectory
 * of a larger repository never reveals changes elsewhere in that repo).
 * Only two fixed, non-mutating git invocations exist here - there is no
 * path from user text to an arbitrary git subcommand.
 */
export class LocalGitInspectionTool implements SpecializedTool {
  private readonly allowedRoot: string;

  public constructor(allowedRoot: string) {
    if (typeof allowedRoot !== 'string' || allowedRoot.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError(
        'Local git inspection tool allowed root must be a non-empty string.',
      );
    }
    this.allowedRoot = allowedRoot;
  }

  public invoke(input: SpecializedToolInvocationInput): SpecializedToolInvocationResult {
    this.validateInput(input);
    const operation = this.resolveOperation(input.toolId);

    try {
      const output = operation === 'status' ? this.status() : this.diff();
      return {
        status: 'completed',
        output: Object.freeze({ ...output }) as Readonly<Record<string, unknown>>,
      };
    } catch (error) {
      return {
        status: 'failed',
        error: new SpecializedToolInvocationFailureError('Local git inspection tool invocation failed.', {
          cause: error,
        }),
      };
    }
  }

  private status(): GitOperationOutput {
    const outcome = runGitCommand(this.allowedRoot, ['status', '--porcelain=v1', '--branch', '--', '.']);
    if (!outcome.ranAsGitRepo) {
      return this.rejected('status');
    }

    const lines = outcome.stdout.split('\n').filter((line) => line !== '');
    const branchLine = lines.find((line) => line.startsWith('## '));
    const branch = this.parseBranch(branchLine);
    const changedLines = lines.filter((line) => !line.startsWith('## '));
    const truncated = changedLines.length > MAX_STATUS_ENTRIES;
    const changedFiles: readonly GitChangedFile[] = changedLines.slice(0, MAX_STATUS_ENTRIES).map((line) => ({
      status: line.slice(0, 2).trim(),
      path: line.slice(3),
    }));
    const clean = changedLines.length === 0;

    const message = clean
      ? `Branch "${branch}", sem alterações pendentes.`
      : `Branch "${branch}", ${changedLines.length} arquivo(s) alterado(s): ${changedFiles
          .map((entry) => entry.path)
          .join(', ')}.${truncated ? ' (lista truncada)' : ''}`;

    return { operation: 'status', outcome: 'ok', branch, clean, changedFiles, message };
  }

  private diff(): GitOperationOutput {
    const outcome = runGitCommand(this.allowedRoot, ['diff', '--', '.']);
    if (!outcome.ranAsGitRepo) {
      return this.rejected('diff');
    }

    const raw = outcome.stdout;
    const truncated = Buffer.byteLength(raw, 'utf8') > MAX_DIFF_OUTPUT_BYTES;
    const diff = truncated ? `${this.truncateToBytes(raw, MAX_DIFF_OUTPUT_BYTES)}\n… (diff truncado)` : raw;
    const message = diff.trim() === '' ? 'Não há alterações no momento.' : `Diff atual:\n${diff}`;

    return { operation: 'diff', outcome: 'ok', diff, truncated, message };
  }

  private truncateToBytes(text: string, maxBytes: number): string {
    return Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
  }

  private parseBranch(branchLine: string | undefined): string {
    if (!branchLine) {
      return 'desconhecida';
    }
    const match = branchLine.match(/^## ([^.\s]+(?: \(no branch\))?)/);
    return match?.[1] ?? branchLine.replace(/^## /, '');
  }

  private rejected(operation: GitOperation): GitOperationOutput {
    return {
      operation,
      outcome: 'rejected',
      reasonCode: 'notAGitRepository',
      message: NOT_A_GIT_REPOSITORY_MESSAGE,
    };
  }

  private resolveOperation(toolId: string): GitOperation {
    if (toolId === GIT_STATUS_TOOL_ID) {
      return 'status';
    }
    if (toolId === GIT_DIFF_TOOL_ID) {
      return 'diff';
    }
    throw new InvalidSpecializedToolInvocationInputError(
      `Local git inspection tool does not support toolId "${toolId}".`,
    );
  }

  private validateInput(input: SpecializedToolInvocationInput): void {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    if (!isObject) {
      throw new InvalidSpecializedToolInvocationInputError('Specialized tool invocation input must be an object.');
    }

    if (typeof input.toolId !== 'string' || input.toolId.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError('Specialized tool toolId must be a non-empty string.');
    }

    if (typeof input.executionId !== 'string' || input.executionId.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError('Specialized tool executionId must be a non-empty string.');
    }

    if (typeof input.responsibilityId !== 'string' || input.responsibilityId.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError(
        'Specialized tool responsibilityId must be a non-empty string.',
      );
    }

    if (typeof input.requestedAt !== 'string' || input.requestedAt.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError('Specialized tool requestedAt must be a non-empty string.');
    }

    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
      throw new InvalidSpecializedToolInvocationInputError('Specialized tool payload must be an object.');
    }
  }
}
