import type { SpecializedTool, SpecializedToolInvocationInput, SpecializedToolInvocationResult } from './SpecializedToolInvocationContract.js';
import { GIT_STATUS_TOOL_ID, LocalGitInspectionTool } from './LocalGitInspectionTool.js';
import { RestrictedOnlineTool } from './RestrictedOnlineTool.js';

/** Explicit online allow-list: only bounded Git status inspection is exposed. */
export class OnlineReadOnlyTool implements SpecializedTool {
  private readonly git: LocalGitInspectionTool;
  private readonly restricted = new RestrictedOnlineTool();

  public constructor(allowedRoot: string) {
    this.git = new LocalGitInspectionTool(allowedRoot);
  }

  public invoke(input: SpecializedToolInvocationInput): SpecializedToolInvocationResult {
    return input.toolId === GIT_STATUS_TOOL_ID ? this.git.invoke(input) : this.restricted.invoke(input);
  }
}
