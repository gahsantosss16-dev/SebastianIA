import type { ProjectDescriptor, ProjectRegistry } from '../project/index.js';
import type { Logger } from '../logger.js';
import {
  type SpecializedTool,
  type SpecializedToolInvocationInput,
  type SpecializedToolInvocationResult,
} from './SpecializedToolInvocationContract.js';
import { InvalidSpecializedToolInvocationInputError } from './SpecializedToolInvocationErrors.js';

export const GITHUB_GET_PROJECT_TOOL_ID = 'github.getProject';
export const GITHUB_LIST_TREE_TOOL_ID = 'github.listTree';
export const GITHUB_READ_FILE_TOOL_ID = 'github.readFile';
export const GITHUB_LIST_COMMITS_TOOL_ID = 'github.listCommits';
export const GITHUB_COMPARE_BRANCH_TOOL_ID = 'github.compareBranch';

const GITHUB_API_ORIGIN = 'https://api.github.com';
export const DEFAULT_GITHUB_TIMEOUT_MS = 8_000;
export const MAX_GITHUB_RESPONSE_BYTES = 512 * 1024;
const MAX_FILE_CONTENT_CHARS = 64 * 1024;
const MAX_TREE_ENTRIES = 200;
const MAX_COMMITS = 20;
const DEFAULT_COMMITS_LIMIT = 10;
const MAX_PATH_CHARS = 400;
const MAX_PROJECT_ID_CHARS = 200;
const REF_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;
const CONTROL_CHARACTER_PATTERN = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}]`);

type FetchLike = (input: string, init: Readonly<Record<string, unknown>>) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}>;

export interface GitHubReadOnlyToolOptions {
  readonly token: string;
  readonly registry: ProjectRegistry;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchLike;
  readonly logger?: Logger;
}

/**
 * Read-only, closed GitHub boundary. Every operation resolves its
 * `owner`/`repository`/`defaultBranch` from a `ProjectRegistry` entry the
 * application already authorized - the model only ever supplies a
 * `projectId` (an id, displayName or alias) plus operation-specific,
 * strictly-shaped arguments (`path`, `ref`, `limit`). There is no argument
 * through which a repository, owner, URL or credential could be supplied
 * directly, and no toolId here performs a write, branch, commit, push, PR
 * or workflow-dispatch operation - this Tool physically cannot reach any
 * GitHub endpoint other than the five read endpoints implemented below.
 */
export class GitHubReadOnlyTool implements SpecializedTool {
  private readonly token: string;
  private readonly registry: ProjectRegistry;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly logger: Logger | undefined;

  public constructor(options: GitHubReadOnlyToolOptions) {
    if (!options || typeof options !== 'object') {
      throw new InvalidSpecializedToolInvocationInputError('GitHub read-only tool options must be an object.');
    }
    if (typeof options.token !== 'string' || options.token.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError('GitHub read-only tool token must be a non-empty string.');
    }
    if (!options.registry || typeof options.registry.resolve !== 'function') {
      throw new InvalidSpecializedToolInvocationInputError('GitHub read-only tool registry must provide resolve.');
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_GITHUB_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs >= 20_000) {
      throw new InvalidSpecializedToolInvocationInputError(
        'GitHub read-only tool timeout must be an integer between 1 and 19999 milliseconds.',
      );
    }

    this.token = options.token;
    this.registry = options.registry;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.logger = options.logger;
  }

  public async invoke(input: SpecializedToolInvocationInput): Promise<SpecializedToolInvocationResult> {
    this.validateInput(input);

    try {
      if (input.toolId === GITHUB_GET_PROJECT_TOOL_ID) {
        return this.completed(await this.getProject(input.payload));
      }
      if (input.toolId === GITHUB_LIST_TREE_TOOL_ID) {
        return this.completed(await this.listTree(input.payload));
      }
      if (input.toolId === GITHUB_READ_FILE_TOOL_ID) {
        return this.completed(await this.readFile(input.payload));
      }
      if (input.toolId === GITHUB_LIST_COMMITS_TOOL_ID) {
        return this.completed(await this.listCommits(input.payload));
      }
      if (input.toolId === GITHUB_COMPARE_BRANCH_TOOL_ID) {
        return this.completed(await this.compareBranch(input.payload));
      }
      return this.completed(this.rejected(undefined, 'unsupportedOperation', `A operação "${input.toolId}" não é suportada por este limite GitHub.`));
    } catch {
      return this.completed(this.rejected(undefined, 'unexpectedFailure', 'A consulta ao GitHub não pôde ser concluída com segurança.'));
    }
  }

  private async getProject(payload: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const projectId = this.readProjectId(payload, ['projectId']);
    if (projectId === undefined) return this.invalidPayload();

    const project = this.registry.resolve(projectId);
    if (!project) return this.rejected('getProject', 'projectNotFound', `Nenhum projeto autorizado corresponde a "${projectId}".`);

    return {
      operation: 'getProject',
      outcome: 'ok',
      projectId: project.id,
      displayName: project.displayName,
      resourceKind: project.resourceKind,
      owner: project.remoteRepository.owner,
      repository: project.remoteRepository.repository,
      defaultBranch: project.remoteRepository.defaultBranch,
      access: project.permissions.access,
      message: `Projeto "${project.displayName}" (${project.remoteRepository.owner}/${project.remoteRepository.repository}, branch "${project.remoteRepository.defaultBranch}", acesso ${project.permissions.access}).`,
    };
  }

  private async listTree(payload: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const projectId = this.readProjectId(payload, ['projectId', 'path']);
    if (projectId === undefined) return this.invalidPayload();
    const path = this.readOptionalPath(payload);
    if (path === false) return this.invalidPayload();

    const project = this.resolveOrReject(projectId);
    if ('rejected' in project) return project.rejected;

    const result = await this.request(project.value, this.contentsPath(path ?? ''), {
      ref: project.value.remoteRepository.defaultBranch,
    });
    if ('rejected' in result) return result.rejected;

    const body = result.body;
    if (!Array.isArray(body)) {
      return this.rejected('listTree', 'pathIsFile', `"${path ?? ''}" é um arquivo, não um diretório; use github.readFile.`);
    }
    const truncated = body.length > MAX_TREE_ENTRIES;
    const entries = body.slice(0, MAX_TREE_ENTRIES).map((entry) => {
      const record = entry as Record<string, unknown>;
      return {
        name: typeof record.name === 'string' ? record.name : '',
        path: typeof record.path === 'string' ? record.path : '',
        type: record.type === 'dir' ? 'dir' : 'file',
        size: typeof record.size === 'number' ? record.size : 0,
      };
    });
    return {
      operation: 'listTree',
      outcome: 'ok',
      projectId: project.value.id,
      path: path ?? '',
      entries,
      truncated,
      message: entries.length === 0
        ? `O diretório "${path ?? '/'}" está vazio.`
        : `${entries.length} item(ns) em "${path ?? '/'}": ${entries.map((entry) => `${entry.name}${entry.type === 'dir' ? '/' : ''}`).join(', ')}${truncated ? ' (lista truncada)' : ''}.`,
    };
  }

  private async readFile(payload: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const projectId = this.readProjectId(payload, ['projectId', 'path']);
    if (projectId === undefined) return this.invalidPayload();
    const path = this.readRequiredPath(payload);
    if (path === undefined) return this.invalidPayload();

    const project = this.resolveOrReject(projectId);
    if ('rejected' in project) return project.rejected;

    const result = await this.request(project.value, this.contentsPath(path), {
      ref: project.value.remoteRepository.defaultBranch,
    });
    if ('rejected' in result) return result.rejected;

    const body = result.body as Record<string, unknown>;
    if (Array.isArray(result.body) || body.type === 'dir') {
      return this.rejected('readFile', 'pathIsDirectory', `"${path}" é um diretório, não um arquivo; use github.listTree.`);
    }
    if (typeof body.content !== 'string' || body.encoding !== 'base64') {
      return this.rejected('readFile', 'unsupportedFileEncoding', `O conteúdo de "${path}" não pôde ser lido como texto.`);
    }

    let decoded: string;
    try {
      decoded = Buffer.from(body.content.replace(/\n/g, ''), 'base64').toString('utf8');
    } catch {
      return this.rejected('readFile', 'unsupportedFileEncoding', `O conteúdo de "${path}" não pôde ser decodificado.`);
    }
    const truncated = decoded.length > MAX_FILE_CONTENT_CHARS;
    const content = truncated ? decoded.slice(0, MAX_FILE_CONTENT_CHARS) : decoded;
    return {
      operation: 'readFile',
      outcome: 'ok',
      projectId: project.value.id,
      path,
      content,
      truncated,
      message: `Conteúdo de "${path}" (branch "${project.value.remoteRepository.defaultBranch}")${truncated ? ', truncado' : ''}:\n${content}`,
    };
  }

  private async listCommits(payload: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const projectId = this.readProjectId(payload, ['projectId', 'path', 'limit']);
    if (projectId === undefined) return this.invalidPayload();
    const path = this.readOptionalPath(payload);
    if (path === false) return this.invalidPayload();
    const limit = this.readOptionalLimit(payload);
    if (limit === false) return this.invalidPayload();

    const project = this.resolveOrReject(projectId);
    if ('rejected' in project) return project.rejected;

    const query: Record<string, string> = {
      sha: project.value.remoteRepository.defaultBranch,
      per_page: String(limit ?? DEFAULT_COMMITS_LIMIT),
    };
    if (path !== undefined && path !== '') query.path = path;

    const result = await this.request(project.value, '/commits', query);
    if ('rejected' in result) return result.rejected;

    const body = Array.isArray(result.body) ? result.body : [];
    const commits = body.slice(0, MAX_COMMITS).map((entry) => {
      const record = entry as Record<string, unknown>;
      const commit = (record.commit as Record<string, unknown> | undefined) ?? {};
      const author = (commit.author as Record<string, unknown> | undefined) ?? {};
      const message = typeof commit.message === 'string' ? commit.message.split('\n')[0] : '';
      return {
        sha: typeof record.sha === 'string' ? record.sha.slice(0, 12) : '',
        message: message ?? '',
        authorName: typeof author.name === 'string' ? author.name : 'desconhecido',
        date: typeof author.date === 'string' ? author.date : '',
      };
    });
    return {
      operation: 'listCommits',
      outcome: 'ok',
      projectId: project.value.id,
      commits,
      message: commits.length === 0
        ? 'Nenhum commit encontrado para o escopo solicitado.'
        : `${commits.length} commit(s) recentes:\n${commits.map((entry) => `${entry.sha} ${entry.message} (${entry.authorName}, ${entry.date})`).join('\n')}`,
    };
  }

  private async compareBranch(payload: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const projectId = this.readProjectId(payload, ['projectId', 'ref']);
    if (projectId === undefined) return this.invalidPayload();
    const ref = payload.ref;
    if (typeof ref !== 'string' || !REF_PATTERN.test(ref)) return this.invalidPayload();

    const project = this.resolveOrReject(projectId);
    if ('rejected' in project) return project.rejected;

    const base = project.value.remoteRepository.defaultBranch;
    const result = await this.request(
      project.value,
      `/compare/${encodeURIComponent(base)}...${encodeURIComponent(ref)}`,
      {},
    );
    if ('rejected' in result) return result.rejected;

    const body = result.body as Record<string, unknown>;
    const files = Array.isArray(body.files) ? body.files : [];
    const changedFiles = files.slice(0, 50).map((entry) => {
      const record = entry as Record<string, unknown>;
      return {
        filename: typeof record.filename === 'string' ? record.filename : '',
        status: typeof record.status === 'string' ? record.status : '',
        additions: typeof record.additions === 'number' ? record.additions : 0,
        deletions: typeof record.deletions === 'number' ? record.deletions : 0,
      };
    });
    return {
      operation: 'compareBranch',
      outcome: 'ok',
      projectId: project.value.id,
      base,
      head: ref,
      status: typeof body.status === 'string' ? body.status : 'unknown',
      aheadBy: typeof body.ahead_by === 'number' ? body.ahead_by : 0,
      behindBy: typeof body.behind_by === 'number' ? body.behind_by : 0,
      changedFiles,
      message: `Comparando "${base}...${ref}": ${changedFiles.length} arquivo(s) alterado(s), ${typeof body.ahead_by === 'number' ? body.ahead_by : 0} commit(s) à frente.`,
    };
  }

  private resolveOrReject(
    projectId: string,
  ): { readonly value: ProjectDescriptor } | { readonly rejected: Record<string, unknown> } {
    const project = this.registry.resolve(projectId);
    if (!project) {
      return { rejected: this.rejected(undefined, 'projectNotFound', `Nenhum projeto autorizado corresponde a "${projectId}".`) };
    }
    if (project.permissions.access !== 'read-only') {
      return { rejected: this.rejected(undefined, 'accessNotPermitted', `O projeto "${project.displayName}" não permite esta operação.`) };
    }
    return { value: project };
  }

  private async request(
    project: ProjectDescriptor,
    path: string,
    query: Readonly<Record<string, string>>,
  ): Promise<{ readonly body: unknown } | { readonly rejected: Record<string, unknown> }> {
    const { owner, repository } = project.remoteRepository;
    const searchParams = new URLSearchParams(query);
    const suffix = searchParams.toString();
    const endpoint = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}${path}${suffix ? `?${suffix}` : ''}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await this.fetchImpl(endpoint, {
        method: 'GET',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${this.token}`,
          'x-github-api-version': '2022-11-28',
          'user-agent': 'SebastianIA',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const category = categorizeGitHubStatus(response.status);
        this.logOutcome(category.reasonCode, response.status, startedAt);
        return { rejected: this.rejected(undefined, category.reasonCode, category.message) };
      }

      const rawBody = await response.text();
      if (Buffer.byteLength(rawBody, 'utf8') > MAX_GITHUB_RESPONSE_BYTES) {
        this.logOutcome('responseTooLarge', response.status, startedAt);
        return { rejected: this.rejected(undefined, 'responseTooLarge', 'A resposta do GitHub excedeu o limite permitido.') };
      }

      let body: unknown;
      try {
        body = JSON.parse(rawBody) as unknown;
      } catch {
        this.logOutcome('invalidResponse', response.status, startedAt);
        return { rejected: this.rejected(undefined, 'upstreamInvalidResponse', 'A resposta do GitHub não é JSON válido.') };
      }
      this.logOutcome('ok', response.status, startedAt);
      return { body };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logOutcome('timeout', undefined, startedAt);
        return { rejected: this.rejected(undefined, 'upstreamTimeout', 'A consulta ao GitHub excedeu o tempo limite.') };
      }
      this.logOutcome('networkError', undefined, startedAt);
      return { rejected: this.rejected(undefined, 'upstreamUnavailable', 'Não foi possível contatar o GitHub.') };
    } finally {
      clearTimeout(timer);
    }
  }

  private logOutcome(outcome: string, httpStatus: number | undefined, startedAt: number): void {
    if (!this.logger) return;
    const metadata: Record<string, unknown> = {
      provider: 'github',
      outcome,
      durationMs: Math.max(0, Date.now() - startedAt),
      ...(httpStatus === undefined ? {} : { httpStatus }),
    };
    if (outcome === 'ok') {
      this.logger.info('GitHub read-only request completed.', metadata);
      return;
    }
    this.logger.warn('GitHub read-only request completed.', metadata);
  }

  private readProjectId(payload: Readonly<Record<string, unknown>>, allowedKeys: readonly string[]): string | undefined {
    if (Object.keys(payload).some((key) => !allowedKeys.includes(key))) return undefined;
    const projectId = payload.projectId;
    if (typeof projectId !== 'string' || projectId.trim() === '' || projectId.length > MAX_PROJECT_ID_CHARS) return undefined;
    return projectId;
  }

  private readOptionalPath(payload: Readonly<Record<string, unknown>>): string | undefined | false {
    if (payload.path === undefined) return undefined;
    return this.readRequiredPath(payload) ?? false;
  }

  private readRequiredPath(payload: Readonly<Record<string, unknown>>): string | undefined {
    const path = payload.path;
    if (typeof path !== 'string' || path.length > MAX_PATH_CHARS) return undefined;
    if (path.startsWith('/') || path.includes('..') || path.includes(String.fromCharCode(92)) || CONTROL_CHARACTER_PATTERN.test(path)) return undefined;
    return path;
  }

  private readOptionalLimit(payload: Readonly<Record<string, unknown>>): number | undefined | false {
    if (payload.limit === undefined) return undefined;
    const limit = payload.limit;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_COMMITS) return false;
    return limit;
  }

  private encodePath(path: string): string {
    return path.split('/').filter((segment) => segment !== '').map(encodeURIComponent).join('/');
  }

  private contentsPath(path: string): string {
    const encoded = this.encodePath(path);
    return encoded === '' ? '/contents' : `/contents/${encoded}`;
  }

  private invalidPayload(): Record<string, unknown> {
    return this.rejected(undefined, 'invalidToolArguments', 'Os parâmetros fornecidos são inválidos para esta operação GitHub.');
  }

  private rejected(operation: string | undefined, reasonCode: string, message: string): Record<string, unknown> {
    return { ...(operation === undefined ? {} : { operation }), outcome: 'rejected', reasonCode, message };
  }

  private completed(output: Record<string, unknown>): SpecializedToolInvocationResult {
    return { status: 'completed', output: Object.freeze(output) as Readonly<Record<string, unknown>> };
  }

  private validateInput(input: SpecializedToolInvocationInput): void {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    if (!isObject) {
      throw new InvalidSpecializedToolInvocationInputError('GitHub read-only tool input must be an object.');
    }
    if (typeof input.toolId !== 'string' || input.toolId.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError('GitHub read-only tool toolId must be a non-empty string.');
    }
    if (typeof input.executionId !== 'string' || input.executionId.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError('GitHub read-only tool executionId must be a non-empty string.');
    }
    if (typeof input.responsibilityId !== 'string' || input.responsibilityId.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError('GitHub read-only tool responsibilityId must be a non-empty string.');
    }
    if (typeof input.requestedAt !== 'string' || input.requestedAt.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError('GitHub read-only tool requestedAt must be a non-empty string.');
    }
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
      throw new InvalidSpecializedToolInvocationInputError('GitHub read-only tool payload must be an object.');
    }
  }
}

function categorizeGitHubStatus(status: number): { readonly reasonCode: string; readonly message: string } {
  if (status === 401) return { reasonCode: 'upstreamAuthenticationFailed', message: 'Falha de autenticação com o GitHub.' };
  if (status === 403) return { reasonCode: 'upstreamPermissionDenied', message: 'Acesso negado pelo GitHub para esta operação.' };
  if (status === 404) return { reasonCode: 'upstreamNotFound', message: 'O recurso solicitado não foi encontrado no GitHub.' };
  if (status === 429) return { reasonCode: 'upstreamRateLimited', message: 'Limite de requisições do GitHub atingido; tente novamente mais tarde.' };
  if (status >= 500) return { reasonCode: 'upstreamServerError', message: 'O GitHub está indisponível no momento.' };
  return { reasonCode: 'upstreamClientError', message: `O GitHub rejeitou a requisição (HTTP ${status}).` };
}
