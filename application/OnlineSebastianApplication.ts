import { type AsyncMemoryStore, AsyncFileMemoryStore } from '../core/memory/AsyncMemoryStore.js';
import type { Logger } from '../core/logger.js';
import {
  FILESYSTEM_READ_FILE_TOOL_ID,
  GIT_DIFF_TOOL_ID,
  GIT_STATUS_TOOL_ID,
  GITHUB_COMPARE_BRANCH_TOOL_ID,
  GITHUB_GET_PROJECT_TOOL_ID,
  GITHUB_LIST_PROJECTS_TOOL_ID,
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
import { FileMemoryStore, resolveMemoryFilePath, resolveSebastianStoreDriver } from '../core/memory/index.js';
import { createGitHubControlledWriteTool, createGitHubProjectRegistry, createGitHubReadOnlyTool } from './GitHubProjectRegistryConfiguration.js';
import { GITHUB_CREATE_BRANCH_TOOL_ID, GITHUB_OPEN_PULL_REQUEST_TOOL_ID, GITHUB_UPSERT_FILE_TOOL_ID } from '../core/tool/GitHubControlledWriteTool.js';
import { createSebastianApplication } from './SebastianApplication.js';
import type { ProjectConversationContext } from '../core/project/ProjectConversationContext.js';
import type { ProjectTaskOrchestrator } from '../core/project/ProjectTaskOrchestrator.js';
import type { ProjectDescriptor } from '../core/project/ProjectTypes.js';

/**
 * Online composition root. It uses the same SebastianApplication/Core/Agent
 * graph as the CLI, but replaces the local dispatcher with a Tool boundary
 * that cannot perform side effects. A cognitive provider is optional and
 * injected explicitly by the HTTP composition; persistent memory remains
 * outside this profile.
 */
const LOCAL_OPERATIONAL_TOOLS: readonly OperationalToolPolicyEntry[] = [
  { toolId: GIT_STATUS_TOOL_ID, description: 'Consulta branch e alterações pendentes do repositório atual.', requiresAuthorization: false, requiredStringArguments: [], applicabilityTerms: ['git', 'status', 'branch', 'repositório', 'repo', 'alterações pendentes', 'working tree', 'commit'] },
  { toolId: GIT_DIFF_TOOL_ID, description: 'Lê o diff Git atual, limitado e sem modificar o repositório.', requiresAuthorization: false, requiredStringArguments: [], applicabilityTerms: ['git', 'diff', 'repositório', 'repo', 'alterações no código', 'mudanças no código'] },
  { toolId: PROJECT_SEARCH_TEXT_TOOL_ID, description: 'Busca texto em arquivos permitidos do projeto; exige query.', requiresAuthorization: false, requiredStringArguments: ['query'], applicabilityTerms: ['código', 'codebase', 'grep', 'arquivos do projeto', 'código do projeto', 'repositório', 'repo'] },
  { toolId: FILESYSTEM_READ_FILE_TOOL_ID, description: 'Lê arquivo textual não sensível dentro da raiz permitida; exige path relativo.', requiresAuthorization: false, requiredStringArguments: ['path'], applicabilityTerms: ['arquivo', 'readme', 'json', 'ts', 'md', 'código'] },
  { toolId: VALIDATION_TYPECHECK_TOOL_ID, description: 'Executa somente o typecheck previamente cadastrado.', requiresAuthorization: false, requiredStringArguments: [], applicabilityTerms: ['typecheck', 'tsc', 'tipagem'] },
  { toolId: VALIDATION_BUILD_TOOL_ID, description: 'Executa somente o build previamente cadastrado.', requiresAuthorization: false, requiredStringArguments: [], applicabilityTerms: ['build', 'compilação', 'compilar'] },
  { toolId: VALIDATION_TEST_TOOL_ID, description: 'Executa somente os testes previamente cadastrados, com timeout rígido.', requiresAuthorization: false, requiredStringArguments: [], applicabilityTerms: ['testes', 'teste', 'test', 'suíte'] },
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
      broadApplicabilityProbe: async (objective: string) => (await knowledgeTool.hasRelevantMatch(objective)),
      // Relevance comes from the real indexed corpus (probe above) or explicit references to documentation.
      applicabilityTerms: ['documentação', 'norma', 'normas', 'referência técnica', 'biblioteca de conhecimento'],
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
/**
 * Read-only project-capability questions for the single configured GitHub
 * project. These are deterministic so an ordinary `respond` turn cannot
 * falsely deny the configured integration, and a short "No GitHub?"
 * continuation never asks the model to invent the mandatory projectId.
 */
export const GITHUB_GENERAL_INTENT_PATTERN =
  /^\s*(?:github|(?:e\s+)?no\s+github)\s*[?!.]*\s*$|^\s*(?:você\s+)?consegue\s+(?:ver|acessar)\s+(?:os?\s+)?(?:meus?\s+)?projet\w*\s*[?!.]*$|^(?=.*\bgithub\b)(?=.*\b(?:projet\w*|acesso|acessar)\b|.*\bconsegue\s+ver\b)(?!.*\bcommits?\b)/i;
export const GITHUB_LIST_PROJECTS_INTENT_PATTERN = /(?=.*\b(?:todos?|listar|liste|quais)\b)(?=.*\bprojet\w*\b)(?=.*\b(?:github|autorizad\w*|cadastrad\w*)\b)/iu;

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
function projectReferencePattern(project: ProjectDescriptor): string {
  const references = [project.id, project.displayName, ...project.aliases]
    .sort((left, right) => right.length - left.length)
    .map((reference) => reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return `(?:${references.join('|')})`;
}

/**
 * Lookahead that is satisfied only by a real mention of the project. A
 * leading vocative addressing the assistant itself ("Sebastian, ...") is
 * not a project reference, even when a project alias shares that name -
 * otherwise "Sebastian, no projeto LUMARKIS ..." silently targets the
 * SebastianIA repository.
 */
function projectMentionLookahead(project: ProjectDescriptor): string {
  const reference = projectReferencePattern(project);
  return `(?=.*?(?:(?<!^\\s*)${reference}|${reference}(?!\\s*[,:!])))`;
}

/**
 * Extracts the element/text the user explicitly asked to locate inside a
 * named file ("localize o botão Salvar cliente", "encontre \"X\""), so the
 * file read can return the real matching lines. Undefined when none is named.
 */
export function extractExplicitLocateTarget(objective: string): string | undefined {
  const quoted = /(?:localiz\w*|encontr\w*|procur\w*|busqu\w*|busc\w*|ach\w*)[^"“”]{0,40}["“]([^"“”]{2,80})["”]/iu.exec(objective);
  if (quoted?.[1] !== undefined) return quoted[1].trim();
  const named = /(?:localiz\w*|encontr\w*|procur\w*|busqu\w*|busc\w*|ach\w*)\s+(?:(?:o|a|os|as)\s+)?(?:(?:botão|botao|botões|campo|função|funcao|texto|elemento|link|seção|secao|título|titulo|rótulo|rotulo)\s+)?(?:(?:de|do|da)\s+)?([^,.;:!?\n]{2,80}?)(?=\s*(?:[,.;:!?\n]|\s+e\s+(?:informe|diga|me|mostre|proponha))|$)/iu.exec(objective);
  const target = named?.[1]?.trim();
  return target === undefined || target === '' ? undefined : target;
}

/** Extracts only a bounded relative file path explicitly supplied by the user. */
export function extractExplicitGitHubPath(objective: string): string | undefined {
  const match = /(?:\barquivo\s+)?([A-Za-z0-9][A-Za-z0-9._/-]*\.[A-Za-z0-9]{1,10})\b/u.exec(objective);
  return match?.[1];
}

export function githubOperationalTools(projects: readonly ProjectDescriptor[]): readonly OperationalToolPolicyEntry[] {
  const defaultProjectId = projects.length === 1 ? projects[0]!.id : undefined;
  const projectTerms = projects.flatMap((project) => [project.id, project.displayName, ...project.aliases]);
  // Domain vocabulary plus the real names/aliases of the registered projects.
  const githubTerms = ['github', ...projectTerms];
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
  const namedRoutes = projects.length > 1 ? projects.flatMap((project) => {
    const mention = projectMentionLookahead(project);
    const namedProjectPattern = new RegExp(`${mention}(?=.*\\b(?:projet\\w*|repo(?:sitório)?|veja|ver|acess\\w*|github)\\b)(?!.*\\bcommits?\\b)`, 'iu');
    const namedCommitPattern = new RegExp(`${mention}(?=.*\\bcommits?\\b)`, 'iu');
    const namedFilePattern = new RegExp(`${mention}(?=.*\\b(?:arquivo\\s+)?[A-Za-z0-9][A-Za-z0-9._/-]*\\.[A-Za-z0-9]{1,10}\\b)`, 'iu');
    return [
      {
        toolId: GITHUB_READ_FILE_TOOL_ID,
        applicabilityTerms: [project.id, project.displayName, ...project.aliases, 'arquivo'],
        description: 'Lê um arquivo explicitamente nomeado no projeto GitHub autorizado.',
        requiresAuthorization: false,
        requiredStringArguments: ['projectId', 'path'],
        optionalStringArguments: ['query'],
        deterministicIntent: {
          pattern: namedFilePattern,
          buildArguments: (objective: string) => {
            const query = extractExplicitLocateTarget(objective);
            const path = extractExplicitGitHubPath(objective) ?? '';
            return query === undefined ? { projectId: project.id, path } : { projectId: project.id, path, query };
          },
          // With a located target, the evidence-only fallback is the matched
          // excerpt itself, never a dump of the file's first characters.
          answerFromSuccessfulObservation: (observation: { readonly summary: string }) =>
            observation.summary.startsWith('Trechos de ') || / não foi encontrado em /u.test(observation.summary.split('\n')[0] ?? '')
              ? observation.summary.split('\n\nConteúdo de ')[0]!
              : observation.summary,
          answerFromRejectedObservation: (observation: { readonly summary: string }, objective: string) =>
            `Não consegui ler "${extractExplicitGitHubPath(objective) ?? 'o arquivo indicado'}" no projeto ${project.displayName} (repositório autorizado ${project.remoteRepository.owner}/${project.remoteRepository.repository}, branch ${project.remoteRepository.defaultBranch}): ${observation.summary}`,
        },
      },
      {
        toolId: GITHUB_GET_PROJECT_TOOL_ID,
        applicabilityTerms: [project.id, project.displayName, ...project.aliases, 'projeto', 'repo'],
        description: 'Resolve um projeto GitHub autorizado explicitamente nomeado.',
        requiresAuthorization: false,
        requiredStringArguments: ['projectId'],
        deterministicIntent: {
          pattern: namedProjectPattern,
          buildArguments: () => ({ projectId: project.id }),
          answerFromSuccessfulObservation: (observation: { readonly summary: string }) => observation.summary,
        },
      },
      {
        toolId: GITHUB_LIST_COMMITS_TOOL_ID,
        applicabilityTerms: [project.id, project.displayName, ...project.aliases, 'commit'],
        description: 'Lista commits do projeto GitHub autorizado explicitamente nomeado.',
        requiresAuthorization: false,
        requiredStringArguments: ['projectId'],
        optionalNumberArguments: ['limit'],
        deterministicIntent: {
          pattern: namedCommitPattern,
          buildArguments: (objective: string) => {
            const quantity = extractRequestedQuantity(objective, GITHUB_COMMIT_NOUN_PATTERN);
            return quantity === undefined ? { projectId: project.id } : { projectId: project.id, limit: quantity };
          },
          answerFromSuccessfulObservation: (observation: { readonly summary: string }) => `Commits recentes no GitHub:\n${observation.summary}`,
          requiresSynthesis: (objective: string) => extractRequestedQuantity(objective, GITHUB_COMMIT_NOUN_PATTERN) === undefined,
        },
      },
    ] satisfies OperationalToolPolicyEntry[];
  }) : [];
  return [
    {
      toolId: GITHUB_LIST_PROJECTS_TOOL_ID,
      applicabilityTerms: ['todos os projetos', 'projetos github', 'projetos autorizados'],
      description: 'Lista exatamente todos os projetos GitHub autorizados no cadastro fechado.',
      requiresAuthorization: false,
      requiredStringArguments: [],
      deterministicIntent: {
        pattern: GITHUB_LIST_PROJECTS_INTENT_PATTERN,
        buildArguments: () => ({}),
        answerFromSuccessfulObservation: (observation: { readonly summary: string }) => observation.summary,
        requiresSynthesis: () => false,
      },
    },
    ...namedRoutes,
    { toolId: GITHUB_GET_PROJECT_TOOL_ID, applicabilityTerms: [...githubTerms, 'repositório', 'repo'], description: 'Resolve um projeto GitHub autorizado por id, nome ou apelido cadastrado.', requiresAuthorization: false, requiredStringArguments: ['projectId'], ...generalRoute },
    { toolId: GITHUB_LIST_TREE_TOOL_ID, applicabilityTerms: [...githubTerms, 'pasta', 'pastas', 'diretório', 'estrutura de arquivos'], description: 'Lista arquivos e pastas de um diretório do projeto GitHub autorizado; path vazio lista a raiz.', requiresAuthorization: false, requiredStringArguments: ['projectId', 'path'] },
    { toolId: GITHUB_READ_FILE_TOOL_ID, applicabilityTerms: [...githubTerms, 'arquivo', 'readme'], description: 'Lê um arquivo do projeto GitHub autorizado; exige path relativo.', requiresAuthorization: false, requiredStringArguments: ['projectId', 'path'] },
    { toolId: GITHUB_LIST_COMMITS_TOOL_ID, applicabilityTerms: [...githubTerms, 'commit'], description: 'Lista commits recentes do projeto GitHub autorizado.', requiresAuthorization: false, requiredStringArguments: ['projectId'], optionalNumberArguments: ['limit'], ...commitRoute },
    { toolId: GITHUB_COMPARE_BRANCH_TOOL_ID, applicabilityTerms: [...githubTerms, 'branch', 'pull request', 'merge'], description: 'Compara a branch principal do projeto GitHub autorizado com outra ref; exige ref.', requiresAuthorization: false, requiredStringArguments: ['projectId', 'ref'] },
  ];
}

export function createOnlineSebastianApplication(
  logger?: Logger,
  cognitiveModelProvider?: CognitiveModelProvider,
  dataDir?: string,
  env: NodeJS.ProcessEnv = process.env,
  projectContext?: ProjectConversationContext,
  projectTaskOrchestrator?: ProjectTaskOrchestrator,
  memoryStore?: AsyncMemoryStore,
) {
  if (resolveSebastianStoreDriver(env) === 'supabase' && memoryStore === undefined) {
    throw new Error('Supabase composition requires the shared async memory store.');
  }
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
  let githubWriteTool;
  let registeredGitHubProjects: readonly ProjectDescriptor[] = [];
  try {
    const projectRegistry = projectContext?.registry ?? createGitHubProjectRegistry(env, logger);
    const registeredProjects = projectRegistry.listDescriptors();
    // A token without any registered project is not a usable GitHub
    // integration - never expose the Tool/catalog for a registry that has
    // nothing to investigate.
    githubTool = registeredProjects.length > 0
      ? createGitHubReadOnlyTool(env, projectRegistry, logger)
      : undefined;
    githubWriteTool = registeredProjects.length > 0 ? createGitHubControlledWriteTool(env, projectRegistry, logger) : undefined;
    // Only set a deterministic default when exactly one project is
    // registered - with more than one, guessing which one a bare mention of
    // "GitHub" refers to would be inventing a target, never done here.
    registeredGitHubProjects = registeredProjects;
  } catch {
    logger?.warn('GitHub integration disabled: invalid project registry configuration');
    githubTool = undefined;
    githubWriteTool = undefined;
    registeredGitHubProjects = [];
  }

  const knowledgeStore = memoryStore ?? (dataDir === undefined
    ? undefined
    : new AsyncFileMemoryStore(new FileMemoryStore(resolveMemoryFilePath(dataDir))));
  const knowledgeTool = knowledgeStore === undefined ? undefined : new KnowledgeSearchTool(new KnowledgeStore(knowledgeStore));

  return createSebastianApplication({
    ...(memoryStore === undefined ? {} : { memoryStore }),
    ...(projectContext === undefined ? {} : { projectContext }),
    ...(projectTaskOrchestrator === undefined ? {} : { projectTaskOrchestrator }),
    ...(logger === undefined ? {} : { logger }),
    authorizedCommands: [],
    specializedTool: new OnlineReadOnlyTool(root, validations, githubTool, knowledgeTool, githubWriteTool),
    ...(cognitiveModelProvider === undefined ? {} : { cognitiveModelProvider }),
    cognitiveOperationalTools: [
      ...LOCAL_OPERATIONAL_TOOLS,
      ...(githubTool === undefined ? [] : githubOperationalTools(registeredGitHubProjects)),
      // GitHub writes change the remote LUMARKIS project: SebastianIA's own
      // local `validation.test` never covers it, so these report only what
      // GitHub itself confirmed and never claim the target was tested.
      ...(githubWriteTool === undefined ? [] : [
        { toolId: GITHUB_CREATE_BRANCH_TOOL_ID, description: 'Cria uma branch sebastian/ isolada a partir da branch principal; exige autorização explícita.', requiresAuthorization: true, resultEvidence: 'toolOutcomeOnly' as const, risk: 'cria uma branch remota sem modificar a main', requiredStringArguments: ['projectId', 'branch'], applicabilityTerms: ['branch', 'criar branch', 'alteração'] },
        { toolId: GITHUB_UPSERT_FILE_TOOL_ID, description: 'Cria ou edita um arquivo não sensível em uma branch sebastian/ e registra um commit; exige autorização explícita.', requiresAuthorization: true, resultEvidence: 'toolOutcomeOnly' as const, risk: 'grava arquivo e commit somente em branch de tarefa', requiredStringArguments: ['projectId', 'branch', 'path', 'content', 'message'], applicabilityTerms: ['editar arquivo', 'criar arquivo', 'alteração'] },
        { toolId: GITHUB_OPEN_PULL_REQUEST_TOOL_ID, description: 'Abre pull request de uma branch sebastian/ para revisão; exige autorização explícita.', requiresAuthorization: true, resultEvidence: 'toolOutcomeOnly' as const, risk: 'abre PR sem merge ou deploy', requiredStringArguments: ['projectId', 'branch', 'title'], applicabilityTerms: ['pull request', 'abrir pr'] },
      ]),
      ...(knowledgeTool === undefined ? [] : knowledgeOperationalTools(knowledgeTool)),
    ],
    ...(dataDir === undefined ? {} : { dataDir }),
  });
}
