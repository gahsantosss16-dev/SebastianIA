import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import type { AuthorizedCommandDefinition } from './LocalAuthorizedCommandTool.js';
import { LocalAuthorizedCommandTool } from './LocalAuthorizedCommandTool.js';
import { FILESYSTEM_READ_FILE_TOOL_ID, LocalFilesystemInspectionTool } from './LocalFilesystemInspectionTool.js';
import { canonicalizeAllowedRoot } from './LocalFilesystemPathGuard.js';
import { GIT_DIFF_TOOL_ID, GIT_STATUS_TOOL_ID, LocalGitInspectionTool } from './LocalGitInspectionTool.js';
import { RestrictedOnlineTool } from './RestrictedOnlineTool.js';
import type { SpecializedTool, SpecializedToolInvocationInput, SpecializedToolInvocationResult } from './SpecializedToolInvocationContract.js';

export const PROJECT_SEARCH_TEXT_TOOL_ID = 'fs.searchText';
const GITHUB_TOOL_ID_PREFIX = 'github.';

const MAX_SEARCH_FILES = 300;
const MAX_SEARCH_TOTAL_BYTES = 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 64 * 1024;
const MAX_SEARCH_MATCHES = 30;
const MAX_SEARCH_QUERY_CHARS = 200;
const MAX_MATCH_LINE_CHARS = 300;
const SEARCHABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.txt', '.yml', '.yaml', '.html', '.css', '.sql', '.sh', '.ps1',
]);
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', 'build']);

/** Closed online read-only boundary: no generic command, shell, write or network adapter is reachable. */
export class OnlineReadOnlyTool implements SpecializedTool {
  private readonly root: string;
  private readonly git: LocalGitInspectionTool;
  private readonly filesystem: LocalFilesystemInspectionTool;
  private readonly validations: LocalAuthorizedCommandTool;
  private readonly restricted = new RestrictedOnlineTool();
  private readonly github: SpecializedTool | undefined;

  public constructor(
    allowedRoot: string,
    commands: readonly AuthorizedCommandDefinition[] = [],
    githubTool?: SpecializedTool,
  ) {
    this.root = canonicalizeAllowedRoot(allowedRoot);
    this.git = new LocalGitInspectionTool(this.root);
    this.filesystem = new LocalFilesystemInspectionTool(this.root);
    this.validations = new LocalAuthorizedCommandTool(this.root, commands);
    this.github = githubTool;
  }

  public invoke(
    input: SpecializedToolInvocationInput,
  ): SpecializedToolInvocationResult | Promise<SpecializedToolInvocationResult> {
    if (input.toolId === GIT_STATUS_TOOL_ID || input.toolId === GIT_DIFF_TOOL_ID) {
      return Object.keys(input.payload).length === 0 ? this.safeGitInvocation(input) : this.invalidPayload(input.toolId);
    }
    if (input.toolId === FILESYSTEM_READ_FILE_TOOL_ID) {
      const path = input.payload.path;
      if (typeof path !== 'string' || Object.keys(input.payload).some((key) => key !== 'path')) return this.invalidPayload(input.toolId);
      if (this.isSensitivePath(path)) return this.sensitivePathRejected(path);
      return this.filesystem.invoke(input);
    }
    if (input.toolId === PROJECT_SEARCH_TEXT_TOOL_ID) return this.search(input);
    if (input.toolId.startsWith('validation.')) {
      return Object.keys(input.payload).length === 0 ? this.validations.invoke(input) : this.invalidPayload(input.toolId);
    }
    if (input.toolId.startsWith(GITHUB_TOOL_ID_PREFIX)) {
      return this.github ? this.github.invoke(input) : this.restricted.invoke(input);
    }
    return this.restricted.invoke(input);
  }

  private safeGitInvocation(input: SpecializedToolInvocationInput): SpecializedToolInvocationResult {
    const result = this.git.invoke(input);
    if (result.status !== 'completed' || result.output.outcome !== 'ok') return result;
    if (input.toolId === GIT_STATUS_TOOL_ID) {
      const changedFiles = Array.isArray(result.output.changedFiles)
        ? (result.output.changedFiles as Array<{ readonly status: string; readonly path: string }>).filter((entry) => !this.isSensitivePath(entry.path))
        : [];
      const branch = typeof result.output.branch === 'string' ? result.output.branch : 'desconhecida';
      const message = changedFiles.length === 0
        ? `Branch "${branch}", sem alterações não sensíveis pendentes.`
        : `Branch "${branch}", ${changedFiles.length} arquivo(s) não sensível(is) alterado(s): ${changedFiles.map((entry) => entry.path).join(', ')}.`;
      return { status: 'completed', output: Object.freeze({ ...result.output, changedFiles, clean: changedFiles.length === 0, message }) };
    }
    const rawDiff = typeof result.output.diff === 'string' ? result.output.diff : '';
    const sections = rawDiff.split(/(?=^diff --git )/m).filter((section) => section.trim() !== '');
    const safeSections = sections.filter((section) => !this.containsSensitiveMarker(section.split(/\r?\n/, 1)[0] ?? ''));
    const omitted = safeSections.length !== sections.length;
    const diff = safeSections.join('');
    const message = diff.trim() === ''
      ? `Não há alterações não sensíveis no momento.${omitted ? ' Alterações em arquivos protegidos foram omitidas.' : ''}`
      : `Diff atual (arquivos protegidos omitidos):\n${diff}`;
    return { status: 'completed', output: Object.freeze({ ...result.output, diff, message, sensitiveSectionsOmitted: omitted }) };
  }

  private search(input: SpecializedToolInvocationInput): SpecializedToolInvocationResult {
    const query = input.payload.query;
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > MAX_SEARCH_QUERY_CHARS || Object.keys(input.payload).some((key) => key !== 'query')) {
      return this.invalidPayload(input.toolId);
    }
    const needle = query.toLowerCase();
    const matches: Array<{ path: string; line: number; text: string }> = [];
    let inspectedFiles = 0;
    let inspectedBytes = 0;
    let truncated = false;
    const pending = [this.root];
    try {
      while (pending.length > 0 && matches.length < MAX_SEARCH_MATCHES && inspectedFiles < MAX_SEARCH_FILES) {
        const directory = pending.pop()!;
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const absolutePath = join(directory, entry.name);
          const relativePath = relative(this.root, absolutePath).split(sep).join('/');
          if (this.isSensitivePath(relativePath)) continue;
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name)) pending.push(absolutePath);
            continue;
          }
          if (!entry.isFile() || !SEARCHABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
          if (inspectedFiles >= MAX_SEARCH_FILES || inspectedBytes >= MAX_SEARCH_TOTAL_BYTES) { truncated = true; break; }
          const size = statSync(absolutePath).size;
          if (size > MAX_SEARCH_FILE_BYTES || inspectedBytes + size > MAX_SEARCH_TOTAL_BYTES) continue;
          inspectedFiles += 1;
          inspectedBytes += size;
          const content = readFileSync(absolutePath);
          if (content.includes(0)) continue;
          for (const [index, line] of content.toString('utf8').split(/\r?\n/).entries()) {
            if (!line.toLowerCase().includes(needle)) continue;
            matches.push({ path: relativePath, line: index + 1, text: line.trim().slice(0, MAX_MATCH_LINE_CHARS) });
            if (matches.length >= MAX_SEARCH_MATCHES) { truncated = true; break; }
          }
        }
      }
      if (pending.length > 0 || inspectedFiles >= MAX_SEARCH_FILES) truncated = true;
      const message = matches.length === 0
        ? `Nenhuma ocorrência encontrada para "${query}" nos arquivos pesquisáveis permitidos.`
        : `Ocorrências de "${query}":\n${matches.map((match) => `${match.path}:${match.line}: ${match.text}`).join('\n')}${truncated ? '\n… (resultado truncado)' : ''}`;
      return { status: 'completed', output: Object.freeze({ operation: 'searchText', outcome: 'ok', matches, inspectedFiles, inspectedBytes, truncated, message }) };
    } catch {
      return { status: 'completed', output: Object.freeze({ operation: 'searchText', outcome: 'rejected', reasonCode: 'searchUnavailable', message: 'A busca textual não pôde ser concluída com segurança.' }) };
    }
  }

  private isSensitivePath(requestedPath: string): boolean {
    const segments = requestedPath.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
    return segments.some((segment) =>
      segment.startsWith('.') || segment === 'node_modules' || segment === 'credentials' || segment === 'secrets' ||
      segment.includes('credential') || segment.includes('secret') || segment.includes('token') ||
      segment === 'id_rsa' || segment === 'id_ed25519' || /\.(pem|key|p12|pfx)$/i.test(segment),
    );
  }

  private containsSensitiveMarker(text: string): boolean {
    return /(^|[/\\\s])\.(env|git|ssh|npmrc|netrc)([./\\\s]|$)/i.test(text) ||
      /credential|secret|token|id_rsa|id_ed25519|\.(pem|key|p12|pfx)(\s|$)/i.test(text);
  }

  private sensitivePathRejected(path: string): SpecializedToolInvocationResult {
    return { status: 'completed', output: Object.freeze({ operation: 'readFile', outcome: 'rejected', path, reasonCode: 'sensitivePath', message: 'O arquivo solicitado é protegido e não pode ser lido no perfil online.' }) };
  }

  private invalidPayload(toolId: string): SpecializedToolInvocationResult {
    return { status: 'completed', output: Object.freeze({ outcome: 'rejected', reasonCode: 'invalidToolArguments', message: `Os parâmetros fornecidos para "${toolId}" são inválidos.` }) };
  }
}
