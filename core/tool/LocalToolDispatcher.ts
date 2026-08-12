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
  FILESYSTEM_REPLACE_TEXT_TOOL_ID,
  type LocalFilesystemInspectionTool,
} from './LocalFilesystemInspectionTool.js';
import { GIT_STATUS_TOOL_ID, GIT_DIFF_TOOL_ID, type LocalGitInspectionTool } from './LocalGitInspectionTool.js';
import type { LocalAuthorizedCommandTool } from './LocalAuthorizedCommandTool.js';

const FILESYSTEM_TOOL_IDS: ReadonlySet<string> = new Set([
  FILESYSTEM_LIST_DIRECTORY_TOOL_ID,
  FILESYSTEM_READ_FILE_TOOL_ID,
  FILESYSTEM_CREATE_TEXT_FILE_TOOL_ID,
  FILESYSTEM_APPEND_TEXT_FILE_TOOL_ID,
  FILESYSTEM_DESCRIBE_WORKSPACE_TOOL_ID,
  FILESYSTEM_REPLACE_TEXT_TOOL_ID,
]);

const GIT_TOOL_IDS: ReadonlySet<string> = new Set([GIT_STATUS_TOOL_ID, GIT_DIFF_TOOL_ID]);

/** Every authorized-command toolId is expected to use this prefix by convention, so the dispatcher never needs to know the dynamic, per-workspace list of registered commands. */
const AUTHORIZED_COMMAND_TOOL_ID_PREFIX = 'validation.';

/**
 * Minimal toolId-based dispatch, deliberately not a formal registry: routes
 * filesystem, git-inspection and authorized-command toolIds to their
 * respective real Tools, and leaves every other toolId (greeting, remember,
 * recall, and any other converse-driven toolId) on the pre-existing
 * fallback tool, unchanged. This preserves the single-`SpecializedTool`-
 * dependency shape of `SpecializedAgent` while letting several real Tools
 * coexist with the pass-through one.
 */
export class LocalToolDispatcher implements SpecializedTool {
  private readonly fallbackTool: SpecializedTool;
  private readonly filesystemTool: LocalFilesystemInspectionTool;
  private readonly gitTool: LocalGitInspectionTool;
  private readonly authorizedCommandTool: LocalAuthorizedCommandTool;

  public constructor(
    fallbackTool: SpecializedTool,
    filesystemTool: LocalFilesystemInspectionTool,
    gitTool: LocalGitInspectionTool,
    authorizedCommandTool: LocalAuthorizedCommandTool,
  ) {
    if (!fallbackTool || typeof fallbackTool.invoke !== 'function') {
      throw new InvalidSpecializedToolInvocationInputError('Local tool dispatcher fallback tool must provide invoke.');
    }
    if (!filesystemTool || typeof filesystemTool.invoke !== 'function') {
      throw new InvalidSpecializedToolInvocationInputError('Local tool dispatcher filesystem tool must provide invoke.');
    }
    if (!gitTool || typeof gitTool.invoke !== 'function') {
      throw new InvalidSpecializedToolInvocationInputError('Local tool dispatcher git tool must provide invoke.');
    }
    if (!authorizedCommandTool || typeof authorizedCommandTool.invoke !== 'function') {
      throw new InvalidSpecializedToolInvocationInputError(
        'Local tool dispatcher authorized command tool must provide invoke.',
      );
    }
    this.fallbackTool = fallbackTool;
    this.filesystemTool = filesystemTool;
    this.gitTool = gitTool;
    this.authorizedCommandTool = authorizedCommandTool;
  }

  public invoke(input: SpecializedToolInvocationInput): SpecializedToolInvocationResult {
    const toolId = input && typeof input === 'object' ? (input as { readonly toolId?: unknown }).toolId : undefined;

    if (typeof toolId === 'string' && FILESYSTEM_TOOL_IDS.has(toolId)) {
      return this.filesystemTool.invoke(input);
    }

    if (typeof toolId === 'string' && GIT_TOOL_IDS.has(toolId)) {
      return this.gitTool.invoke(input);
    }

    if (typeof toolId === 'string' && toolId.startsWith(AUTHORIZED_COMMAND_TOOL_ID_PREFIX)) {
      return this.authorizedCommandTool.invoke(input);
    }

    return this.fallbackTool.invoke(input);
  }
}
