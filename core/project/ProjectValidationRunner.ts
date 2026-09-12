import { LocalAuthorizedCommandTool, type AuthorizedCommandDefinition } from '../tool/LocalAuthorizedCommandTool.js';
import type { ProjectDescriptor } from './ProjectTypes.js';

export interface ProjectValidationOutcome {
  readonly toolId: string;
  readonly succeeded: boolean;
  readonly message: string;
}

/**
 * Runs exactly the validations a project's own configuration registered
 * (`project.workspace.validations`) - never a command invented from user
 * text or from Etapa 3's closure logic. Shared by `ProjectTaskOrchestrator`
 * (after a FAZ edit) and `GitCloseOrchestrator` (immediately before commit,
 * against the exact state about to be committed) so the two never diverge
 * on how a validation is invoked.
 */
export function runProjectValidations(
  project: ProjectDescriptor,
  root: string,
  executionId: string,
  requestedAt: string,
): readonly ProjectValidationOutcome[] {
  const definitions = project.workspace?.validations ?? [];
  if (definitions.length === 0) return [];
  const commandDefinitions: readonly AuthorizedCommandDefinition[] = definitions.map((definition) => ({
    toolId: definition.id,
    executable: definition.executable,
    args: definition.args,
    ...(definition.timeoutMs === undefined ? {} : { timeoutMs: definition.timeoutMs }),
  }));
  const tool = new LocalAuthorizedCommandTool(root, commandDefinitions);
  return commandDefinitions.map((definition) => {
    const invocation = tool.invoke({
      toolId: definition.toolId,
      executionId,
      responsibilityId: 'project-task-executor',
      requestedAt,
      payload: {},
    });
    if (invocation.status !== 'completed') {
      return { toolId: definition.toolId, succeeded: false, message: 'Falha ao executar a validação.' };
    }
    const output = invocation.output as { readonly succeeded?: boolean; readonly message?: string };
    return { toolId: definition.toolId, succeeded: output.succeeded === true, message: output.message ?? 'Sem detalhes.' };
  });
}
