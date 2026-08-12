import { readFileSync, readdirSync, statSync, writeFileSync, appendFileSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
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
import { runGitCommand } from './LocalGitCommandRunner.js';

export const FILESYSTEM_LIST_DIRECTORY_TOOL_ID = 'fs.listDirectory';
export const FILESYSTEM_READ_FILE_TOOL_ID = 'fs.readFile';
export const FILESYSTEM_CREATE_TEXT_FILE_TOOL_ID = 'fs.createTextFile';
export const FILESYSTEM_APPEND_TEXT_FILE_TOOL_ID = 'fs.appendTextFile';
export const FILESYSTEM_DESCRIBE_WORKSPACE_TOOL_ID = 'fs.describeWorkspace';
export const FILESYSTEM_REPLACE_TEXT_TOOL_ID = 'fs.replaceText';

/** Shared ceiling for both reading and writing text content - a file can never exceed this size through this Tool, read or write. */
const MAX_TEXT_FILE_BYTES = 256 * 1024;
const MAX_DIRECTORY_ENTRIES = 500;

type FilesystemOperation =
  | 'listDirectory'
  | 'readFile'
  | 'createTextFile'
  | 'appendTextFile'
  | 'describeWorkspace'
  | 'replaceText';

type FilesystemRejectionReason =
  | LocalFilesystemPathRejectionReason
  | 'notADirectory'
  | 'notAFile'
  | 'fileTooLarge'
  | 'binaryFile'
  | 'listingLimitExceeded'
  | 'invalidPath'
  | 'alreadyExists'
  | 'contentTooLarge'
  | 'appendExceedsLimit'
  | 'searchTextNotFound'
  | 'multipleOccurrences'
  | 'fileAlreadyModified';

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
  readonly name?: string;
  readonly entryCount?: number;
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
 * Local filesystem access rooted at an explicit allowed root captured at
 * composition time (never from user text): read-only inspection
 * (`listDirectory`/`readFile`), controlled write (`createTextFile` - never
 * overwrites - and `appendTextFile` - never creates implicitly, never
 * truncates existing content), and a minimal, local, zero-dependency
 * workspace identity (`describeWorkspace`). Every expected failure mode
 * (missing path, traversal, symlink escape, wrong type, oversized content,
 * binary content, listing too large, already-exists, invalid filename) is
 * reported as a normal, safe `outcome: 'rejected'` result with a
 * user-facing message - never as a thrown error or a partial read/write.
 * `status: 'failed'` is reserved for genuinely unexpected I/O failures the
 * guard did not anticipate.
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

    // Contract-shape validation (missing/invalid path or content) happens
    // outside the try block and throws synchronously, exactly like
    // validateInput above - only genuine filesystem I/O below is caught and
    // turned into a `status: 'failed'` result.
    if (operation === 'describeWorkspace') {
      try {
        return this.completed(this.describeWorkspace());
      } catch (error) {
        return this.failed(error);
      }
    }

    const requestedPath = this.extractRequestedPath(input.payload);
    const content =
      operation === 'createTextFile' || operation === 'appendTextFile' ? this.extractContent(input.payload) : '';
    const searchText = operation === 'replaceText' ? this.extractRequiredStringField(input.payload, 'searchText') : '';
    const replacementText =
      operation === 'replaceText' ? this.extractRequiredStringField(input.payload, 'replaceText') : '';

    try {
      const canonicalRoot = this.getCanonicalAllowedRoot();

      if (operation === 'createTextFile') {
        return this.completed(this.createTextFile(canonicalRoot, requestedPath, content));
      }

      const resolution = resolvePathWithinAllowedRoot(canonicalRoot, requestedPath);
      if (resolution.outcome === 'rejected') {
        return this.completed(this.rejected(operation, requestedPath, resolution.reason));
      }

      if (operation === 'listDirectory') {
        return this.completed(this.listDirectory(resolution.absolutePath, requestedPath));
      }
      if (operation === 'readFile') {
        return this.completed(this.readFile(resolution.absolutePath, requestedPath));
      }
      if (operation === 'replaceText') {
        return this.completed(
          this.replaceText(canonicalRoot, resolution.absolutePath, requestedPath, searchText, replacementText),
        );
      }

      return this.completed(this.appendTextFile(resolution.absolutePath, requestedPath, content));
    } catch (error) {
      return this.failed(error);
    }
  }

  private failed(error: unknown): SpecializedToolInvocationResult {
    return {
      status: 'failed',
      error: new SpecializedToolInvocationFailureError('Local filesystem inspection tool invocation failed.', {
        cause: error,
      }),
    };
  }

  private completed(output: FilesystemOperationOutput): SpecializedToolInvocationResult {
    return {
      status: 'completed',
      output: Object.freeze({ ...output }) as Readonly<Record<string, unknown>>,
    };
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

    if (stat.size > MAX_TEXT_FILE_BYTES) {
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

  /**
   * Never overwrites: uses the OS-level exclusive-create flag ("wx") so the
   * existence check and the write itself are atomic - there is no window
   * between "check it doesn't exist" and "create it" for a race to exploit.
   */
  private createTextFile(canonicalRoot: string, requestedPath: string, content: string): FilesystemOperationOutput {
    const displayPath = this.displayPath(requestedPath);
    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes > MAX_TEXT_FILE_BYTES) {
      return this.rejected('createTextFile', requestedPath, 'contentTooLarge');
    }

    const filename = basename(requestedPath);
    if (filename === '' || filename === '.' || filename === '..') {
      return this.rejected('createTextFile', requestedPath, 'invalidPath');
    }

    const parentResolution = resolvePathWithinAllowedRoot(canonicalRoot, dirname(requestedPath));
    if (parentResolution.outcome === 'rejected') {
      return this.rejected('createTextFile', requestedPath, parentResolution.reason);
    }

    if (!statSync(parentResolution.absolutePath).isDirectory()) {
      return this.rejected('createTextFile', requestedPath, 'notADirectory');
    }

    const targetPath = join(parentResolution.absolutePath, filename);

    try {
      writeFileSync(targetPath, content, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return this.rejected('createTextFile', requestedPath, 'alreadyExists');
      }
      throw error;
    }

    return {
      operation: 'createTextFile',
      outcome: 'ok',
      path: displayPath,
      sizeBytes: contentBytes,
      message: `Nota "${displayPath}" criada.`,
    };
  }

  /** Only ever appends to an existing text file - never creates it, never truncates what was already there. */
  private appendTextFile(
    absolutePath: string,
    requestedPath: string,
    content: string,
  ): FilesystemOperationOutput {
    const stat = statSync(absolutePath);
    const displayPath = this.displayPath(requestedPath);

    if (!stat.isFile()) {
      return this.rejected('appendTextFile', requestedPath, 'notAFile');
    }

    const existingBuffer = readFileSync(absolutePath);
    if (existingBuffer.includes(0)) {
      return this.rejected('appendTextFile', requestedPath, 'binaryFile');
    }

    const additionalBytes = Buffer.byteLength(content, 'utf8');
    const resultingSize = existingBuffer.length + additionalBytes;
    if (resultingSize > MAX_TEXT_FILE_BYTES) {
      return this.rejected('appendTextFile', requestedPath, 'appendExceedsLimit');
    }

    appendFileSync(absolutePath, content, 'utf8');

    return {
      operation: 'appendTextFile',
      outcome: 'ok',
      path: displayPath,
      sizeBytes: resultingSize,
      message: `Conteúdo acrescentado a "${displayPath}".`,
    };
  }

  /**
   * Reads the target's current content, requires the search text to match
   * exactly once (never guesses among multiple matches, never silently
   * no-ops when the text isn't found), and writes the result through a
   * temp-file-then-rename in the same directory - the file is either fully
   * the old content or fully the new content, never partially written. When
   * the allowed root is a Git repository and the target already carries
   * uncommitted changes, the edit is refused before any write, so Sebastian
   * never silently compounds unrelated in-progress work.
   */
  private replaceText(
    canonicalRoot: string,
    absolutePath: string,
    requestedPath: string,
    searchText: string,
    replacementText: string,
  ): FilesystemOperationOutput {
    const stat = statSync(absolutePath);
    const displayPath = this.displayPath(requestedPath);

    if (!stat.isFile()) {
      return this.rejected('replaceText', requestedPath, 'notAFile');
    }

    if (stat.size > MAX_TEXT_FILE_BYTES) {
      return this.rejected('replaceText', requestedPath, 'fileTooLarge');
    }

    const buffer = readFileSync(absolutePath);
    if (buffer.includes(0)) {
      return this.rejected('replaceText', requestedPath, 'binaryFile');
    }

    const currentContent = buffer.toString('utf8');
    const occurrences = this.countOccurrences(currentContent, searchText);
    if (occurrences === 0) {
      return this.rejected('replaceText', requestedPath, 'searchTextNotFound');
    }
    if (occurrences > 1) {
      return this.rejected('replaceText', requestedPath, 'multipleOccurrences');
    }

    const newContent = currentContent.replace(searchText, replacementText);
    const newContentBytes = Buffer.byteLength(newContent, 'utf8');
    if (newContentBytes > MAX_TEXT_FILE_BYTES) {
      return this.rejected('replaceText', requestedPath, 'contentTooLarge');
    }

    if (this.hasUncommittedChanges(canonicalRoot, requestedPath)) {
      return this.rejected('replaceText', requestedPath, 'fileAlreadyModified');
    }

    this.writeAtomically(absolutePath, newContent);

    return {
      operation: 'replaceText',
      outcome: 'ok',
      path: displayPath,
      sizeBytes: newContentBytes,
      message: `Arquivo "${displayPath}" atualizado.`,
    };
  }

  private countOccurrences(content: string, searchText: string): number {
    if (searchText === '') {
      return 0;
    }
    return content.split(searchText).length - 1;
  }

  /**
   * Best-effort, scoped to this single file: when the allowed root is not a
   * Git repository (or git itself is unavailable), this returns false and
   * the edit proceeds - filesystem protections alone remain in force, per
   * the documented "still works outside Git" behavior.
   */
  private hasUncommittedChanges(canonicalRoot: string, requestedPath: string): boolean {
    const outcome = runGitCommand(canonicalRoot, ['status', '--porcelain=v1', '--', requestedPath]);
    return outcome.ranAsGitRepo && outcome.stdout.trim() !== '';
  }

  private writeAtomically(targetPath: string, content: string): void {
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    writeFileSync(tempPath, content, 'utf8');
    renameSync(tempPath, targetPath);
  }

  /**
   * Minimal, local, zero-dependency workspace identity: the allowed root's
   * own folder name plus a top-level entry count. No indexing, no
   * embeddings, no external service - just what the filesystem already
   * knows about itself.
   */
  private describeWorkspace(): FilesystemOperationOutput {
    const canonicalRoot = this.getCanonicalAllowedRoot();
    const name = basename(canonicalRoot);
    const entryCount = readdirSync(canonicalRoot).length;

    return {
      operation: 'describeWorkspace',
      outcome: 'ok',
      path: '.',
      name,
      entryCount,
      message: `Você está no workspace "${name}", com ${entryCount} ${entryCount === 1 ? 'item' : 'itens'} na raiz.`,
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
      case 'invalidPath':
        return `"${displayPath}" não é um nome de arquivo válido.`;
      case 'alreadyExists':
        return `Já existe um arquivo em "${displayPath}"; não vou sobrescrevê-lo.`;
      case 'contentTooLarge':
        return `O conteúdo é grande demais para criar "${displayPath}" (limite de 256 KiB).`;
      case 'appendExceedsLimit':
        return `Acrescentar esse conteúdo faria "${displayPath}" ultrapassar o limite de 256 KiB.`;
      case 'searchTextNotFound':
        return `Não encontrei o texto indicado em "${displayPath}".`;
      case 'multipleOccurrences':
        return `O texto indicado aparece mais de uma vez em "${displayPath}"; seja mais específico para evitar uma edição ambígua.`;
      case 'fileAlreadyModified':
        return `"${displayPath}" já possui alterações não commitadas; não vou editá-lo automaticamente.`;
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
    if (toolId === FILESYSTEM_CREATE_TEXT_FILE_TOOL_ID) {
      return 'createTextFile';
    }
    if (toolId === FILESYSTEM_APPEND_TEXT_FILE_TOOL_ID) {
      return 'appendTextFile';
    }
    if (toolId === FILESYSTEM_DESCRIBE_WORKSPACE_TOOL_ID) {
      return 'describeWorkspace';
    }
    if (toolId === FILESYSTEM_REPLACE_TEXT_TOOL_ID) {
      return 'replaceText';
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

  private extractContent(payload: Readonly<Record<string, unknown>>): string {
    return this.extractRequiredStringField(payload, 'content');
  }

  private extractRequiredStringField(payload: Readonly<Record<string, unknown>>, field: string): string {
    const value = (payload as Record<string, unknown>)[field];
    if (typeof value !== 'string') {
      throw new InvalidSpecializedToolInvocationInputError(
        `Local filesystem inspection tool payload must include a string ${field} for this operation.`,
      );
    }
    return value;
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
