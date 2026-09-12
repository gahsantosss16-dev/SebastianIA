import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, win32, posix } from 'node:path';
import { resolvePathWithinAllowedRoot } from '../tool/LocalFilesystemPathGuard.js';
import type { ProjectDescriptor } from './ProjectTypes.js';

export function validateWorkspace(workspace: ProjectDescriptor['workspace']): void {
  if (workspace === undefined) return;
  if (!workspace || typeof workspace !== 'object') throw new TypeError('Invalid workspace configuration.');
  const env = workspace.environment;
  if (!env || !['win32', 'linux', 'darwin'].includes(env.platform) || !env.id?.trim() || !env.label?.trim()) throw new TypeError('Invalid project environment.');
  const paths = env.platform === 'win32' ? win32 : posix;
  if (typeof workspace.root !== 'string' || !paths.isAbsolute(workspace.root)) throw new TypeError('Project root must be absolute.');
  if (!Array.isArray(workspace.policySources) || !workspace.policySources.some(source => source.required)) throw new TypeError('Required project policies are missing.');
  for (const source of workspace.policySources) {
    if (!source || typeof source.path !== 'string' || !source.path.trim() || win32.isAbsolute(source.path) || posix.isAbsolute(source.path) || source.path.split(/[\\/]/).includes('..') || typeof source.required !== 'boolean' || !Array.isArray(source.topics) || source.topics.some((topic: unknown) => typeof topic !== 'string' || !topic.trim())) throw new TypeError('Invalid policy source.');
  }
  if (!Array.isArray(workspace.validations) || workspace.validations.some(command => !command.id?.trim() || !command.executable?.trim() || !Array.isArray(command.args) || command.args.some((arg: unknown) => typeof arg !== 'string'))) throw new TypeError('Invalid validation metadata.');
}

export interface LoadedProjectPolicy {
  readonly path: string;
  readonly hash: string;
  readonly content: string;
}

/** Reads canonical configuration only. User text can select topics, never paths or roots. */
export function loadProjectPolicies(project: ProjectDescriptor, environmentId: string, task: string): readonly LoadedProjectPolicy[] {
  const workspace = project.workspace;
  if (!workspace) throw new Error('Este projeto não tem checkout configurado.');
  if (workspace.environment.id !== environmentId || workspace.environment.platform !== process.platform) throw new Error('Checkout indisponível neste ambiente. Este servidor não acessa o computador cadastrado.');
  if (!isAbsolute(workspace.root)) throw new Error('Raiz incompatível com este ambiente.');
  let root: string;
  try {
    root = realpathSync(workspace.root);
    if (!statSync(root).isDirectory()) throw new Error();
  } catch { throw new Error('Checkout configurado ausente ou indisponível; não utilizarei o diretório do servidor como substituto.'); }
  const query = task.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return workspace.policySources.filter(source => source.required || source.topics.some(topic => query.includes(topic.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()))).map(source => {
    const resolved = resolvePathWithinAllowedRoot(root, source.path);
    if (resolved.outcome !== 'ok') throw new Error(`Fonte de regras indisponível ou fora da raiz autorizada: ${source.path}.`);
    if (!statSync(resolved.absolutePath).isFile() || statSync(resolved.absolutePath).size > 512 * 1024) throw new Error(`Fonte de regras inválida: ${source.path}.`);
    const bytes = readFileSync(resolved.absolutePath);
    if (bytes.includes(0)) throw new Error(`Fonte de regras não textual: ${source.path}.`);
    return { path: source.path, hash: createHash('sha256').update(bytes).digest('hex'), content: bytes.toString('utf8') };
  });
}
