import { FILESYSTEM_READ_FILE_TOOL_ID, FILESYSTEM_REPLACE_TEXT_TOOL_ID } from '../tool/LocalFilesystemInspectionTool.js';
import type { CognitiveToolDescriptor } from './CognitiveModelProviderContract.js';

/** Every argument a policy entry requires is a required string field - the only shape any tool in this menu ever needs. */
export interface CognitiveToolPolicyEntry {
  readonly toolId: string;
  readonly description: string;
  readonly requiresAuthorization: boolean;
  readonly requiredStringArguments: readonly string[];
}

/**
 * The entire, closed set of Tools the cognitive engine is ever told about or
 * ever allowed to invoke for one goal - built fresh per goal so the single
 * validation toolId it names is exactly the one the goal itself is about.
 * Nothing here is a general registry: three fixed entries, matching the
 * read → edit → verify shape every autonomous fix already follows
 * (SPEC-047's own hypothesis/apply/verify cycle, just with the hypothesis
 * now coming from the model instead of only from parsed assertion output).
 * A `toolId` outside this list can never be described to the model and can
 * never pass `isCognitiveToolAllowed` below, regardless of what a
 * (potentially hallucinating, or maliciously prompt-injected) model output
 * claims.
 */
export function buildCognitiveToolMenu(validationToolId: string): readonly CognitiveToolPolicyEntry[] {
  return [
    {
      toolId: FILESYSTEM_READ_FILE_TOOL_ID,
      description: 'Lê o conteúdo textual de um arquivo dentro da área permitida do workspace.',
      requiresAuthorization: false,
      requiredStringArguments: ['path'],
    },
    {
      toolId: validationToolId,
      description: 'Executa a validação (teste/build/typecheck) associada a este objetivo e relata o resultado.',
      requiresAuthorization: false,
      requiredStringArguments: [],
    },
    {
      toolId: FILESYSTEM_REPLACE_TEXT_TOOL_ID,
      description:
        'Substitui uma única ocorrência exata de texto em um arquivo dentro da área permitida do workspace. Requer autorização de escrita.',
      requiresAuthorization: true,
      requiredStringArguments: ['path', 'searchText', 'replaceText'],
    },
  ];
}

export function describeCognitiveToolMenu(validationToolId: string): readonly CognitiveToolDescriptor[] {
  return buildCognitiveToolMenu(validationToolId).map((entry) => ({
    toolId: entry.toolId,
    description: entry.description,
    requiresAuthorization: entry.requiresAuthorization,
  }));
}

/**
 * Whether a proposed `(toolId, toolArguments)` pair may ever reach
 * `SpecializedTool.invoke` for this goal - checked in addition to, never
 * instead of, `GoalExecutionOrchestrator`'s own authorization-aware
 * allow-list. Rejects, before any Tool is touched: a toolId outside the
 * fixed menu above (closes off an invented or hallucinated toolId), a
 * write-requiring tool proposed against a `readOnly` goal, and arguments
 * missing (or not a string for) any field the tool actually requires -
 * the underlying filesystem Tool throws a synchronous, uncaught error for a
 * missing required field instead of a safe rejected outcome, so this check
 * exists specifically to stop that from ever happening with model-produced
 * input.
 */
export function findCognitiveToolPolicyEntry(
  validationToolId: string,
  toolId: string,
): CognitiveToolPolicyEntry | undefined {
  return buildCognitiveToolMenu(validationToolId).find((entry) => entry.toolId === toolId);
}

export function validateCognitiveToolArguments(
  entry: CognitiveToolPolicyEntry,
  toolArguments: Readonly<Record<string, unknown>> | undefined,
): boolean {
  const args = toolArguments ?? {};
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return false;
  }
  return entry.requiredStringArguments.every((field) => typeof (args as Record<string, unknown>)[field] === 'string');
}
