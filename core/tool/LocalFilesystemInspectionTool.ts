import { readFileSync, readdirSync, statSync } from 'node:fs';
import {
  type SpecializedTool,
  type SpecializedToolInvocationInput,
  type SpecializedToolInvocationResult,
} from './SpecializedToolInvocationContract.js';
import {
  InvalidSpecializedToolInvocationInputError,
  SpecializedToolInvocationFailureError,
} from './SpecializedToolInvocationErrors.js';
import {
  canonicalizeAllowedRoot,
  resolvePathWithinAllowedRoot,
  type LocalFilesystemPathRejectionReason,
} from './LocalFilesystemPathGuard.js';

export const FILESYSTEM_LIST_DIRECTORY_TOOL_ID = 'fs.listDirectory';
export const FILESYSTEM_READ_FILE_TOOL_ID = 'fs.readFile';

const MAX_READ_FILE_BYTES = 256 * 1024;
const MAX_DIRECTORY_ENTRIES = 500;

type FilesystemOperation = 'listDirectory' | 'readFile';

type FilesystemRejectionReason = LocalFilesystemPathRejectionReason | 'notADirectory' | 'notAFile' | 'fileTooLarge' | 'binaryFile' | 'listingLimitExceeded';

interface FilesystemEntrySummary {
  readonly name: string;
  readonly type: 'file' | 'directory' | 'other';
}

interface FilesystemOperationOkOutput {
  readonly operation: FilesystemOperation;
  readonly outcome: 'ok';
  readonly path: string;
  readonly message: string;
  readonly entries?: readonly FilesystemEntrySummary[];
  readonly content?: string;
  readonly sizeBytes?: number;
}

interface FilesystemOperationRejectedOutput {
  readonly operation: FilesystemOperation;
  readonly outcome: 'rejected';
  readonly path: string;
  readonly reasonCode: FilesystemRejectionReason;
  readonly message: string;
}

type FilesystemOperationOutput = FilesystemOperationOkOutput | FilesystemOperationRejectedOutput;

/**
 * Read-only inspection of a local filesystem subtree rooted at an explicit
 * allowed root captured at composition time (never from user text). Every
 * expected failure mode (missing path, traversal, symlink escape, wrong
 * type, oversized file, binary content, listing too large) is reported as a
 * normal, safe `outcome: 'rejected'` result with a user-facing message -
 * never as a thrown error or a partial read. `status: 'failed'` is reserved
 * for genuinely unexpected I/O failures the guard did not anticipate.
 */
export class LocalFilesystemInspectionTool implements SpecializedTool {
  private readonly allowedRoot: string;
  private canonicalAllowedRoot: string | undefined;

  public constructor(allowedRoot: string) {
    if (typeof allowedRoot !== 'string' || allowedRoot.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError(
        'Local filesystem inspection tool allowed root must be a non-empty string.',
      );
    }
    this.allowedRoot = allowedRoot;
  }

  public invoke(input: SpecializedToolInvocationInput): SpecializedToolInvocationResult {
    this.validateInput(input);
    const operation = this.resolveOperation(input.toolId);
    const requestedPath = this.extractRequestedPath(input.payload);

    try {
      const canonicalRoot = this.getCanonicalAllowedRoot();
      const resolution = resolvePathWithinAllowedRoot(canonicalRoot, requestedPath);

      const output =
        resolution.outcome === 'rejected'
          ? this.rejected(operation, requestedPath, resolution.reason)
          : operation === 'listDirectory'
            ? this.listDirectory(resolution.absolutePath, requestedPath)
            : this.readFile(resolution.absolutePath, requestedPath);

      return {
        status: 'completed',
        output: Object.freeze({ ...output }) as Readonly<Record<string, unknown>>,
      };
    } catch (error) {
      return {
        status: 'failed',
        error: new SpecializedToolInvocationFailureError('Local filesystem inspection tool invocation failed.', {
          cause: error,
        }),
      };
    }
  }

  private listDirectory(absolutePath: string, requestedPath: string): FilesystemOperationOutput {
    const stat = statSync(absolutePath);
    const displayPath = this.displayPath(requestedPath);

    if (!stat.isDirectory()) {
      return this.rejected('listDirectory', requestedPath, 'notADirectory');
    }

    const dirents = readdirSync(absolutePath, { withFileTypes: true });
    if (dirents.length > MAX_DIRECTORY_ENTRIES) {
      return this.rejected('listDirectory', requestedPath, 'listingLimitExceeded');
    }

    const entries: readonly FilesystemEntrySummary[] = dirents
      .map((dirent) => ({
        name: dirent.name,
        type: dirent.isDirectory() ? ('directory' as const) : dirent.isFile() ? ('file' as const) : ('other' as const),
      }))
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name));

    const message =
      entries.length === 0
        ? `A pasta "${displayPath}" está vazia.`
        : `Arquivos em "${displayPath}": ${entries.map((entry) => entry.name).join(', ')}.`;

    return { operation: 'listDirectory', outcome: 'ok', path: displayPath, entries, message };
  }

  private readFile(absolutePath: string, requestedPath: string): FilesystemOperationOutput {
    const stat = statSync(absolutePath);
    const displayPath = this.displayPath(requestedPath);

    if (!stat.isFile()) {
      return this.rejected('readFile', requestedPath, 'notAFile');
    }

    if (stat.size > MAX_READ_FILE_BYTES) {
      return this.rejected('readFile', requestedPath, 'fileTooLarge');
    }

    const buffer = readFileSync(absolutePath);
    if (buffer.includes(0)) {
      return this.rejected('readFile', requestedPath, 'binaryFile');
    }

    const content = buffer.toString('utf8');
    return {
      operation: 'readFile',
      outcome: 'ok',
      path: displayPath,
      content,
      sizeBytes: stat.size,
      message: `Conteúdo de "${displayPath}":\n${content}`,
    };
  }

  private rejected(
    operation: FilesystemOperation,
    requestedPath: string,
    reasonCode: FilesystemRejectionReason,
  ): FilesystemOperationRejectedOutput {
    const displayPath = this.displayPath(requestedPath);
    return {
      operation,
      outcome: 'rejected',
      path: displayPath,
      reasonCode,
      message: this.friendlyRejectionMessage(reasonCode, displayPath),
    };
  }

  private friendlyRejectionMessage(reasonCode: FilesystemRejectionReason, displayPath: string): string {
    switch (reasonCode) {
      case 'absolutePathRejected':
        return 'Não posso acessar caminhos absolutos. Use um caminho relativo dentro da área permitida.';
      case 'outsideRoot':
        return `O caminho "${displayPath}" está fora da área permitida.`;
      case 'notFound':
        return `Não encontrei "${displayPath}".`;
      case 'notADirectory':
        return `"${displayPath}" não é uma pasta.`;
      case 'notAFile':
        return `"${displayPath}" não é um arquivo.`;
      case 'fileTooLarge':
        return `O arquivo "${displayPath}" é grande demais para ser lido (limite de 256 KiB).`;
      case 'binaryFile':
        return `"${displayPath}" parece ser um arquivo binário e não pode ser lido como texto.`;
      case 'listingLimitExceeded':
        return `A pasta "${displayPath}" tem itens demais para listar (limite de 500).`;
    }
  }

  private displayPath(requestedPath: string): string {
    const trimmed = requestedPath.trim();
    return trimmed === '' ? '.' : trimmed;
  }

  private resolveOperation(toolId: string): FilesystemOperation {
    if (toolId === FILESYSTEM_LIST_DIRECTORY_TOOL_ID) {
      return 'listDirectory';
    }
    if (toolId === FILESYSTEM_READ_FILE_TOOL_ID) {
      return 'readFile';
    }
    throw new InvalidSpecializedToolInvocationInputError(
      `Local filesystem inspection tool does not support toolId "${toolId}".`,
    );
  }

  private extractRequestedPath(payload: Readonly<Record<string, unknown>>): string {
    const path = (payload as { readonly path?: unknown }).path;
    if (typeof path !== 'string') {
      throw new InvalidSpecializedToolInvocationInputError(
        'Local filesystem inspection tool payload must include a string path.',
      );
    }
    return path;
  }

  private getCanonicalAllowedRoot(): string {
    if (this.canonicalAllowedRoot === undefined) {
      this.canonicalAllowedRoot = canonicalizeAllowedRoot(this.allowedRoot);
    }
    return this.canonicalAllowedRoot;
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
