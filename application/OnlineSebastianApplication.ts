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
import { KNOWLEDGE_SEARCH_TOOL_ID, KnowledgeSearchTool, KnowledgeStore } from '../core/knowledge/index.js';
import { FileMemoryStore, resolveMemoryFilePath } from '../core/memory/index.js';
import { createGitHubProjectRegistry, createGitHubReadOnlyTool } from './GitHubProjectRegistryConfiguration.js';
import { createSebastianApplication } from './SebastianApplication.js';
import type { ProjectConversationContext } from '../core/project/ProjectConversationContext.js';

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
 * Knowledge Layer V1 (docs/knowledge-layer-v1.md). Generic by design: the
 * `domain` filter (e.g. "programming") is data configured at ingestion time,
 * never a constant baked into this catalog entry - adding a new library
 * domain later needs no change here. Still deliberately without
 * `deterministicIntent`/`answerFromSuccessfulObservation` (see
 * docs/knowledge-layer-v1.md, sections 2 and 8): this Tool's evidence always
 * goes through `synthesize()`, never a pre-model shortcut. `broadApplicabilityProbe`
 * is a separate, narrower opt-in (see `OperationalToolPolicyEntry` in
 * CognitiveOperationalOrchestrator.ts): it only widens the pre-existing
 * "is the operational engine even worth entering / is this an untried
 * capability worth one recovery attempt" checks, using the real indexed
 * corpus itself as the relevance signal - never a per-topic keyword list.
 */
function knowledgeOperationalTools(knowledgeTool: KnowledgeSearchTool): readonly OperationalToolPolicyEntry[] {
  return [
    {
      toolId: KNOWLEDGE_SEARCH_TOOL_ID,
      description: 'Busca trechos relevantes em bibliotecas de conhecimento configuradas (ex.: programação), com metadados de autoridade e proveniência.',
      requiresAuthorization: false,
      requiredStringArguments: ['query'],
      broadApplicabilityProbe: (objective: string) => knowledgeTool.hasRelevantMatch(objective),
    },
  ];
}

/**
 * A message unambiguously about GitHub and about commits specifically (both
 * words present, any order/casing) - matched deterministically here only to
 * decide WHICH read-only capability to force-run first; the model still
 * composes the actual reply from the resulting observation.
 */
const GITHUB_COMMIT_INTENT_PATTERN = /^(?=.*\bgithub\b)(?=.*\bcommits?\b)/i;
const GITHUB_COMMIT_CONTINUATION_PATTERN = /(?:último|ultimo|recentes?|mais\s+recente)(?:(?!\n).)*\bcommits?\b|\bcommits?\b(?:(?!\n).)*(?:último|ultimo|recentes?|mais\s+recente)/i;
const GITHUB_IMMEDIATE_CONTEXT_PATTERN = /\bgithub\b/i;
export const GITHUB_COMMIT_NOUN_PATTERN = /commits?/i;
/** A direct GitHub capability/project-access question; broader semantic questions remain cognitive. */
const GITHUB_GENERAL_INTENT_PATTERN = /^\s*github\s*[?!.]*\s*$|^(?=.*\bgithub\b)(?=.*\b(?:projet\w*|acesso|acessar)\b|.*\bconsegue\s+ver\b)(?!.*\bcommits?\b)/i;

/**
 * Generic "how many" extraction for a deterministic route's built argument -
 * not a parser for one specific sentence. Recognizes an explicit number
 * adjacent to the counted noun ("últimos 3 commits", "5 commits") or to a
 * quantity word ("últimos/últimas/top/primeiros N"), and a singular
 * reference with no plural ("último commit") as exactly 1. Returns
 * `undefined` when no quantity is expressed, so the caller falls back to
 * whatever default it already has - deliberately narrow (the number must be
 * directly adjacent to the quantity/counted-noun word) so an unrelated
 * number elsewhere in the sentence (a version, a date, part of a name) is
 * never mistaken for the requested count.
 */
/**
 * Plain `\b` in JavaScript only recognizes ASCII word characters
 * (`[A-Za-z0-9_]`), so it silently fails to find a boundary right next to an
 * accented letter like the "ú" in "últimos" - `\búltimos\b` never matches
 * "últimos" at all. These two Unicode-aware equivalents (used with the `u`
 * flag) fix that without weakening the boundary check itself.
 */
const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}])';

export function extractRequestedQuantity(objective: string, countedNoun: RegExp): number | undefined {
  const nearQuantityWord = new RegExp(
    `${NOT_WORD_BEFORE}(?:últim[oa]s|ultim[oa]s|top|primeiros?)\\s+(\\d{1,3})${NOT_WORD_AFTER}`, 'iu',
  ).exec(objective);
  if (nearQuantityWord?.[1] !== undefined) {
    const value = Number(nearQuantityWord[1]);
    if (Number.isInteger(value) && value > 0) return value;
  }
  const nearCountedNoun = new RegExp(`${NOT_WORD_BEFORE}(\\d{1,3})\\s+(?:${countedNoun.source})`, 'iu').exec(objective);
  if (nearCountedNoun?.[1] !== undefined) {
    const value = Number(nearCountedNoun[1]);
    if (Number.isInteger(value) && value > 0) return value;
  }
  const isUnambiguousSingular = new RegExp(`${NOT_WORD_BEFORE}(?:o\\s+)?últim[oa]${NOT_WORD_AFTER}`, 'iu').test(objective) &&
    countedNoun.test(objective);
  return isUnambiguousSingular ? 1 : undefined;
}

/**
 * Investigation tools for GitHub projects previously registered by the
 * application (see `GitHubProjectRegistryConfiguration.ts`). `projectId` is
 * the only way any of these reach a repository - it is resolved against the
 * closed `ProjectRegistry`, never treated as an owner/repository/URL, and
 * every other field is a strictly-shaped, non-secret, mandatory string
 * argument (`path`, `ref`). `github.listCommits` additionally accepts the
 * optional integer `limit` (see `optionalNumberArguments` on
 * `OperationalToolPolicyEntry`) - a real, in-range count the deterministic
 * commit route resolves from the objective itself; the Tool already knows
 * how to read it (`GitHubReadOnlyTool.listCommits`), it was simply never
 * supplied before. None of these ever proposes a write, so none declares
 * `requiresAuthorization`.
 *
 * `github.getProject` and `github.listCommits` additionally declare a
 * `deterministicIntent` route (only when exactly one project is registered,
 * so there is never ambiguity about which one to use): a message
 * unambiguously about GitHub always causes the orchestrator to gather a real
 * observation from the configured project BEFORE the model is ever
 * consulted, so a model's first `concludeCompleted` can never claim missing
 * GitHub access without that Tool having actually been tried first.
 */
function githubOperationalTools(defaultProjectId: string | undefined): readonly OperationalToolPolicyEntry[] {
  const generalRoute = defaultProjectId === undefined ? {} : {
    deterministicIntent: {
      pattern: GITHUB_GENERAL_INTENT_PATTERN,
      buildArguments: () => ({ projectId: defaultProjectId }),
      answerFromSuccessfulObservation: (observation: { readonly summary: string }) => observation.summary,
    },
  };
  const commitRoute = defaultProjectId === undefined ? {} : {
    deterministicIntent: {
      pattern: GITHUB_COMMIT_INTENT_PATTERN,
      immediateContext: {
        objectivePattern: GITHUB_COMMIT_CONTINUATION_PATTERN,
        contextPattern: GITHUB_IMMEDIATE_CONTEXT_PATTERN,
      },
      buildArguments: (objective: string) => {
        const quantity = extractRequestedQuantity(objective, GITHUB_COMMIT_NOUN_PATTERN);
        return quantity === undefined ? { projectId: defaultProjectId } : { projectId: defaultProjectId, limit: quantity };
      },
      answerFromSuccessfulObservation: (observation: { readonly summary: string }) =>
        `Commits recentes no GitHub:\n${observation.summary}`,
      // Skips synthesize() only when this exact objective resolved a real,
      // explicit quantity - the Tool then already returns exactly (or, if
      // fewer exist, at most) that many commits, in order, so there is no
      // remaining quantity/order/format ambiguity left for an LLM to
      // resolve. An objective with no explicit quantity (or one the Tool
      // itself rejects as out of its safe range) still goes through
      // `synthesize()` exactly as before.
      requiresSynthesis: (objective: string) => extractRequestedQuantity(objective, GITHUB_COMMIT_NOUN_PATTERN) === undefined,
    },
  };
  return [
    { toolId: GITHUB_GET_PROJECT_TOOL_ID, description: 'Resolve um projeto GitHub autorizado por id, nome ou apelido cadastrado.', requiresAuthorization: false, requiredStringArguments: ['projectId'], ...generalRoute },
    { toolId: GITHUB_LIST_TREE_TOOL_ID, description: 'Lista arquivos e pastas de um diretório do projeto GitHub autorizado; path vazio lista a raiz.', requiresAuthorization: false, requiredStringArguments: ['projectId', 'path'] },
    { toolId: GITHUB_READ_FILE_TOOL_ID, description: 'Lê um arquivo do projeto GitHub autorizado; exige path relativo.', requiresAuthorization: false, requiredStringArguments: ['projectId', 'path'] },
    { toolId: GITHUB_LIST_COMMITS_TOOL_ID, description: 'Lista commits recentes do projeto GitHub autorizado.', requiresAuthorization: false, requiredStringArguments: ['projectId'], optionalNumberArguments: ['limit'], ...commitRoute },
    { toolId: GITHUB_COMPARE_BRANCH_TOOL_ID, description: 'Compara a branch principal do projeto GitHub autorizado com outra ref; exige ref.', requiresAuthorization: false, requiredStringArguments: ['projectId', 'ref'] },
  ];
}

export function createOnlineSebastianApplication(
  logger?: Logger,
  cognitiveModelProvider?: CognitiveModelProvider,
  dataDir?: string,
  env: NodeJS.ProcessEnv = process.env,
  projectContext?: ProjectConversationContext,
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
  let defaultGitHubProjectId: string | undefined;
  try {
    const projectRegistry = projectContext?.registry ?? createGitHubProjectRegistry(env, logger);
    const registeredProjects = projectRegistry.listDescriptors();
    // A token without any registered project is not a usable GitHub
    // integration - never expose the Tool/catalog for a registry that has
    // nothing to investigate.
    githubTool = registeredProjects.length > 0
      ? createGitHubReadOnlyTool(env, projectRegistry, logger)
      : undefined;
    // Only set a deterministic default when exactly one project is
    // registered - with more than one, guessing which one a bare mention of
    // "GitHub" refers to would be inventing a target, never done here.
    defaultGitHubProjectId = registeredProjects.length === 1 ? registeredProjects[0]!.id : undefined;
  } catch {
    logger?.warn('GitHub integration disabled: invalid project registry configuration');
    githubTool = undefined;
    defaultGitHubProjectId = undefined;
  }

  // Knowledge Layer V1 (docs/knowledge-layer-v1.md): the store needs a real
  // file to persist to, exactly like conversation memory - without a
  // dataDir there is nowhere durable to keep ingested sources/chunks, so the
  // capability simply stays out of the catalog (fail-soft, same pattern as
  // the GitHub integration above).
  const knowledgeTool = dataDir === undefined
    ? undefined
    : new KnowledgeSearchTool(new KnowledgeStore(new FileMemoryStore(resolveMemoryFilePath(dataDir))));

  return createSebastianApplication({
    ...(projectContext === undefined ? {} : { projectContext }),
    ...(logger === undefined ? {} : { logger }),
    authorizedCommands: [],
    specializedTool: new OnlineReadOnlyTool(root, validations, githubTool, knowledgeTool),
    ...(cognitiveModelProvider === undefined ? {} : { cognitiveModelProvider }),
    cognitiveOperationalTools: [
      ...LOCAL_OPERATIONAL_TOOLS,
      ...(githubTool === undefined ? [] : githubOperationalTools(defaultGitHubProjectId)),
      ...(knowledgeTool === undefined ? [] : knowledgeOperationalTools(knowledgeTool)),
    ],
    ...(dataDir === undefined ? {} : { dataDir }),
  });
}
