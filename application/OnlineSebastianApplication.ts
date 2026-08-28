import type { Logger } from '../core/logger.js';
import {
  FILESYSTEM_READ_FILE_TOOL_ID,
  GIT_DIFF_TOOL_ID,
  GIT_STATUS_TOOL_ID,
  GITHUB_COMPARE_BRANCH_TOOL_ID,
  GITHUB_GET_PROJECT_TOOL_ID,
  GITHUB_LIST_COMMITS_TOOL_ID,
  GITHUB_LIST_TREE_TOOL_ID,
  GITHUB_READ_FILE_TOOL_ID,
  OnlineReadOnlyTool,
  PROJECT_SEARCH_TEXT_TOOL_ID,
  VALIDATION_BUILD_TOOL_ID,
  VALIDATION_TEST_TOOL_ID,
  VALIDATION_TYPECHECK_TOOL_ID,
  type AuthorizedCommandDefinition,
} from '../core/tool/index.js';
import type { CognitiveModelProvider, OperationalToolPolicyEntry } from '../core/cognition/index.js';
import { createGitHubProjectRegistry, createGitHubReadOnlyTool } from './GitHubProjectRegistryConfiguration.js';
import { createSebastianApplication } from './SebastianApplication.js';

/**
 * Online composition root. It uses the same SebastianApplication/Core/Agent
 * graph as the CLI, but replaces the local dispatcher with a Tool boundary
 * that cannot perform side effects. A cognitive provider is optional and
 * injected explicitly by the HTTP composition; persistent memory remains
 * outside this profile.
 */
const LOCAL_OPERATIONAL_TOOLS: readonly OperationalToolPolicyEntry[] = [
  { toolId: GIT_STATUS_TOOL_ID, description: 'Consulta branch e alterações pendentes do repositório atual.', requiresAuthorization: false, requiredStringArguments: [] },
  { toolId: GIT_DIFF_TOOL_ID, description: 'Lê o diff Git atual, limitado e sem modificar o repositório.', requiresAuthorization: false, requiredStringArguments: [] },
  { toolId: PROJECT_SEARCH_TEXT_TOOL_ID, description: 'Busca texto em arquivos permitidos do projeto; exige query.', requiresAuthorization: false, requiredStringArguments: ['query'] },
  { toolId: FILESYSTEM_READ_FILE_TOOL_ID, description: 'Lê arquivo textual não sensível dentro da raiz permitida; exige path relativo.', requiresAuthorization: false, requiredStringArguments: ['path'] },
  { toolId: VALIDATION_TYPECHECK_TOOL_ID, description: 'Executa somente o typecheck previamente cadastrado.', requiresAuthorization: false, requiredStringArguments: [] },
  { toolId: VALIDATION_BUILD_TOOL_ID, description: 'Executa somente o build previamente cadastrado.', requiresAuthorization: false, requiredStringArguments: [] },
  { toolId: VALIDATION_TEST_TOOL_ID, description: 'Executa somente os testes previamente cadastrados, com timeout rígido.', requiresAuthorization: false, requiredStringArguments: [] },
];

/**
 * Investigation tools for GitHub projects previously registered by the
 * application (see `GitHubProjectRegistryConfiguration.ts`). `projectId` is
 * the only way any of these reach a repository - it is resolved against the
 * closed `ProjectRegistry`, never treated as an owner/repository/URL, and
 * every other field is a strictly-shaped, non-secret, mandatory string
 * argument (`path`, `ref`) - the cognitive policy layer only supports
 * required string arguments, so operation-only knobs like `limit` remain a
 * Tool-level capability, not one the model can set. None of these ever
 * proposes a write, so none declares `requiresAuthorization`.
 */
const GITHUB_OPERATIONAL_TOOLS: readonly OperationalToolPolicyEntry[] = [
  { toolId: GITHUB_GET_PROJECT_TOOL_ID, description: 'Resolve um projeto GitHub autorizado por id, nome ou apelido cadastrado.', requiresAuthorization: false, requiredStringArguments: ['projectId'] },
  { toolId: GITHUB_LIST_TREE_TOOL_ID, description: 'Lista arquivos e pastas de um diretório do projeto GitHub autorizado; path vazio lista a raiz.', requiresAuthorization: false, requiredStringArguments: ['projectId', 'path'] },
  { toolId: GITHUB_READ_FILE_TOOL_ID, description: 'Lê um arquivo do projeto GitHub autorizado; exige path relativo.', requiresAuthorization: false, requiredStringArguments: ['projectId', 'path'] },
  { toolId: GITHUB_LIST_COMMITS_TOOL_ID, description: 'Lista commits recentes do projeto GitHub autorizado.', requiresAuthorization: false, requiredStringArguments: ['projectId'] },
  { toolId: GITHUB_COMPARE_BRANCH_TOOL_ID, description: 'Compara a branch principal do projeto GitHub autorizado com outra ref; exige ref.', requiresAuthorization: false, requiredStringArguments: ['projectId', 'ref'] },
];

export function createOnlineSebastianApplication(
  logger?: Logger,
  cognitiveModelProvider?: CognitiveModelProvider,
  dataDir?: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const root = process.cwd();
  const validations: readonly AuthorizedCommandDefinition[] = [
    { toolId: VALIDATION_TYPECHECK_TOOL_ID, executable: process.execPath, args: ['--run', 'typecheck'], timeoutMs: 12_000 },
    { toolId: VALIDATION_BUILD_TOOL_ID, executable: process.execPath, args: ['--run', 'build'], timeoutMs: 12_000 },
    { toolId: VALIDATION_TEST_TOOL_ID, executable: process.execPath, args: ['--run', 'test'], timeoutMs: 12_000 },
  ];

  // Fail-soft by design: absent or invalid SEBASTIAN_GITHUB_* project
  // configuration must never abort startup. GitHub investigation simply stays unavailable
  // (below, catalog + Tool omit it entirely) while Gemini, conversation,
  // memory and every local/read-only Tool continue exactly as before.
  let githubTool;
  try {
    const projectRegistry = createGitHubProjectRegistry(env, logger);
    // A token without any registered project is not a usable GitHub
    // integration - never expose the Tool/catalog for a registry that has
    // nothing to investigate.
    githubTool = projectRegistry.listDescriptors().length > 0
      ? createGitHubReadOnlyTool(env, projectRegistry, logger)
      : undefined;
  } catch {
    logger?.warn('GitHub integration disabled: invalid project registry configuration');
    githubTool = undefined;
  }

  return createSebastianApplication({
    ...(logger === undefined ? {} : { logger }),
    authorizedCommands: [],
    specializedTool: new OnlineReadOnlyTool(root, validations, githubTool),
    ...(cognitiveModelProvider === undefined ? {} : { cognitiveModelProvider }),
    cognitiveOperationalTools: githubTool === undefined
      ? LOCAL_OPERATIONAL_TOOLS
      : [...LOCAL_OPERATIONAL_TOOLS, ...GITHUB_OPERATIONAL_TOOLS],
    ...(dataDir === undefined ? {} : { dataDir }),
  });
}
