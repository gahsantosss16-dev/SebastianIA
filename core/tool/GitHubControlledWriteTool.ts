import type { ProjectDescriptor, ProjectRegistry } from '../project/index.js';
import type { SpecializedTool, SpecializedToolInvocationInput, SpecializedToolInvocationResult } from './SpecializedToolInvocationContract.js';

export const GITHUB_CREATE_BRANCH_TOOL_ID = 'github.createBranch';
export const GITHUB_UPSERT_FILE_TOOL_ID = 'github.upsertFile';
export const GITHUB_OPEN_PULL_REQUEST_TOOL_ID = 'github.openPullRequest';

type FetchLike = (input: string, init: Readonly<Record<string, unknown>>) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>;
const API = 'https://api.github.com';
const BRANCH = /^sebastian\/[a-z0-9][a-z0-9._/-]{2,120}$/;
const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,400}$/;
const WRITE_OWNER = 'gahsantosss16-dev';
const WRITE_REPOSITORY = 'financeiro-lumarkis';
const WRITE_PROJECT_ID = 'lumarkis-financeiro';

/**
 * Narrow GitHub write boundary. It can only create a task branch, create or
 * replace one non-sensitive text file on that branch (GitHub records a real
 * commit), and open a PR back to the configured default branch. It has no
 * endpoint for deleting, merging, pushing main, secrets, settings or deploys.
 */
export class GitHubControlledWriteTool implements SpecializedTool {
  public constructor(private readonly token: string, private readonly registry: ProjectRegistry, private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike) {}

  public async invoke(input: SpecializedToolInvocationInput): Promise<SpecializedToolInvocationResult> {
    const projectId = input.payload.projectId;
    if (typeof projectId !== 'string') return this.result('invalidToolArguments');
    const project = this.registry.resolve(projectId);
    if (!project || project.permissions.access !== 'controlled-write' || project.id !== WRITE_PROJECT_ID ||
      project.remoteRepository.owner !== WRITE_OWNER || project.remoteRepository.repository !== WRITE_REPOSITORY) return this.result('writeNotEnabled');
    if (input.toolId === GITHUB_CREATE_BRANCH_TOOL_ID) return this.createBranch(project, input.payload);
    if (input.toolId === GITHUB_UPSERT_FILE_TOOL_ID) return this.upsertFile(project, input.payload);
    if (input.toolId === GITHUB_OPEN_PULL_REQUEST_TOOL_ID) return this.openPullRequest(project, input.payload);
    return this.result('unsupportedOperation');
  }

  private async createBranch(project: ProjectDescriptor, payload: Readonly<Record<string, unknown>>): Promise<SpecializedToolInvocationResult> {
    const branch = payload.branch;
    if (typeof branch !== 'string' || !BRANCH.test(branch) || branch === project.remoteRepository.defaultBranch) return this.result('invalidToolArguments');
    const head = await this.request(project, `/git/ref/heads/${encodeURIComponent(project.remoteRepository.defaultBranch)}`, 'GET');
    const sha = head.ok && typeof (head.body as Record<string, unknown>).object === 'object' ? ((head.body as { object: { sha?: unknown } }).object.sha) : undefined;
    if (typeof sha !== 'string') return this.result('githubRequestFailed');
    const created = await this.request(project, '/git/refs', 'POST', { ref: `refs/heads/${branch}`, sha });
    return created.ok ? this.result('ok', `Branch de tarefa "${branch}" criada a partir de "${project.remoteRepository.defaultBranch}".`, { projectId: project.id, branch }) : this.result('githubRequestFailed');
  }

  private async upsertFile(project: ProjectDescriptor, payload: Readonly<Record<string, unknown>>): Promise<SpecializedToolInvocationResult> {
    const branch = payload.branch; const path = payload.path; const content = payload.content; const message = payload.message;
    if (typeof branch !== 'string' || !BRANCH.test(branch) || typeof path !== 'string' || !PATH.test(path) || /(^|\/)(\.env|.*(?:secret|token|credential|\.pem|\.key))$/i.test(path) || typeof content !== 'string' || content.length > 64_000 || typeof message !== 'string' || message.trim() === '') return this.result('invalidToolArguments');
    const existing = await this.request(project, `/contents/${path.split('/').map(encodeURIComponent).join('/')}` , 'GET', undefined, { ref: branch });
    const sha = existing.ok && typeof (existing.body as Record<string, unknown>).sha === 'string' ? (existing.body as { sha: string }).sha : undefined;
    const body: Record<string, unknown> = { message: message.slice(0, 200), content: Buffer.from(content, 'utf8').toString('base64'), branch };
    if (sha) body.sha = sha;
    const written = await this.request(project, `/contents/${path.split('/').map(encodeURIComponent).join('/')}`, 'PUT', body);
    return written.ok ? this.result('ok', `Arquivo "${path}" gravado na branch "${branch}"; commit registrado no GitHub.`, { projectId: project.id, branch, path }) : this.result('githubRequestFailed');
  }

  private async openPullRequest(project: ProjectDescriptor, payload: Readonly<Record<string, unknown>>): Promise<SpecializedToolInvocationResult> {
    const branch = payload.branch; const title = payload.title; const body = payload.body;
    if (typeof branch !== 'string' || !BRANCH.test(branch) || typeof title !== 'string' || title.trim() === '' || (body !== undefined && typeof body !== 'string')) return this.result('invalidToolArguments');
    const opened = await this.request(project, '/pulls', 'POST', { title: title.slice(0, 200), head: branch, base: project.remoteRepository.defaultBranch, ...(typeof body === 'string' ? { body: body.slice(0, 10_000) } : {}) });
    return opened.ok ? this.result('ok', `Pull request aberto para revisão da branch "${branch}"; a branch principal não foi modificada.`, { projectId: project.id, branch }) : this.result('githubRequestFailed');
  }

  private async request(project: ProjectDescriptor, path: string, method: string, body?: Record<string, unknown>, query?: Record<string, string>): Promise<{ ok: boolean; body: unknown }> {
    const url = new URL(`${API}/repos/${encodeURIComponent(project.remoteRepository.owner)}/${encodeURIComponent(project.remoteRepository.repository)}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    try { const response = await this.fetchImpl(url.toString(), { method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const text = await response.text(); return { ok: response.ok, body: text === '' ? {} : JSON.parse(text) }; } catch { return { ok: false, body: {} }; }
  }

  private result(outcome: string, message = 'A operação de escrita não pôde ser concluída com segurança.', extra: Record<string, unknown> = {}): SpecializedToolInvocationResult { return { status: 'completed', output: Object.freeze({ outcome: outcome === 'ok' ? 'ok' : 'rejected', ...(outcome === 'ok' ? {} : { reasonCode: outcome }), message, ...extra }) }; }
}
