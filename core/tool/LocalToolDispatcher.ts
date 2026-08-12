import type {
  SpecializedTool,
  SpecializedToolInvocationInput,
  SpecializedToolInvocationResult,
} from './SpecializedToolInvocationContract.js';
import { InvalidSpecializedToolInvocationInputError } from './SpecializedToolInvocationErrors.js';
import {
  FILESYSTEM_LIST_DIRECTORY_TOOL_ID,
  FILESYSTEM_READ_FILE_TOOL_ID,
  FILESYSTEM_CREATE_TEXT_FILE_TOOL_ID,
  FILESYSTEM_APPEND_TEXT_FILE_TOOL_ID,
  FILESYSTEM_DESCRIBE_WORKSPACE_TOOL_ID,
  type LocalFilesystemInspectionTool,
} from './LocalFilesystemInspectionTool.js';

const FILESYSTEM_TOOL_IDS: ReadonlySet<string> = new Set([
  FILESYSTEM_LIST_DIRECTORY_TOOL_ID,
  FILESYSTEM_READ_FILE_TOOL_ID,
  FILESYSTEM_CREATE_TEXT_FILE_TOOL_ID,
  FILESYSTEM_APPEND_TEXT_FILE_TOOL_ID,
  FILESYSTEM_DESCRIBE_WORKSPACE_TOOL_ID,
]);

/**
 * Minimal toolId-based dispatch, deliberately not a formal registry: routes
 * the filesystem toolIds to the real filesystem tool and leaves every other
 * toolId (greeting, remember, recall, and any other converse-driven toolId)
 * on the pre-existing fallback tool, unchanged. This preserves the
 * single-`SpecializedTool`-dependency shape of `SpecializedAgent` while
 * letting a real Tool coexist with the pass-through one.
 */
export class LocalToolDispatcher implements SpecializedTool {
  private readonly fallbackTool: SpecializedTool;
  private readonly filesystemTool: LocalFilesystemInspectionTool;

  public constructor(fallbackTool: SpecializedTool, filesystemTool: LocalFilesystemInspectionTool) {
    if (!fallbackTool || typeof fallbackTool.invoke !== 'function') {
      throw new InvalidSpecializedToolInvocationInputError('Local tool dispatcher fallback tool must provide invoke.');
    }
    if (!filesystemTool || typeof filesystemTool.invoke !== 'function') {
      throw new InvalidSpecializedToolInvocationInputError('Local tool dispatcher filesystem tool must provide invoke.');
    }
    this.fallbackTool = fallbackTool;
    this.filesystemTool = filesystemTool;
  }

  public invoke(input: SpecializedToolInvocationInput): SpecializedToolInvocationResult {
    const toolId = input && typeof input === 'object' ? (input as { readonly toolId?: unknown }).toolId : undefined;

    if (typeof toolId === 'string' && FILESYSTEM_TOOL_IDS.has(toolId)) {
      return this.filesystemTool.invoke(input);
    }

    return this.fallbackTool.invoke(input);
  }
}
