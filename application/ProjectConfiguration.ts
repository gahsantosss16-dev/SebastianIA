import { readFileSync, realpathSync, statSync } from 'node:fs';
import { ProjectRegistry } from '../core/project/ProjectRegistry.js';
import type { ProjectDescriptor } from '../core/project/ProjectTypes.js';
import { ProjectConversationContext } from '../core/project/ProjectConversationContext.js';
import { ProjectTaskOrchestrator } from '../core/project/ProjectTaskOrchestrator.js';
import { ClaudeCliProjectTaskExecutor } from '../core/project/ClaudeCliProjectTaskExecutor.js';
import type { ProjectTaskExecutor } from '../core/project/ProjectTaskExecutor.js';
import { FileMemoryStore, resolveMemoryFilePath } from '../core/memory/index.js';
import { createGitHubProjectRegistry } from './GitHubProjectRegistryConfiguration.js';
import { loadProjectPolicies } from '../core/project/ProjectWorkspacePolicy.js';
import { win32 } from 'node:path';

export interface ProjectConfigurationRuntime {
  readonly enabled: boolean;
  readonly file: string | undefined;
  readonly environmentId: string;
  readonly projects: readonly Readonly<Record<string, unknown>>[];
}

/** Resolves Sebastian's checkout from explicit configuration, never from cwd. */
export function resolveSebastianWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.SEBASTIAN_PROJECTS_FILE === undefined) return undefined;
  const project = loadConfiguredProjects(createGitHubProjectRegistry(env), env).getById('sebastiania');
  const root = project?.workspace?.root;
  if (!root || win32.normalize(root).toLowerCase().includes('\\onedrive\\')) {
    throw new Error('Workspace operacional do SebastianIA inválido ou localizado no OneDrive.');
  }
  return root;
}

/** Explicit opt-in configuration. Invalid configured files fail startup, never fall back to cwd. */
export function loadConfiguredProjects(registry: ProjectRegistry, env: NodeJS.ProcessEnv = process.env): ProjectRegistry {
  const file = env.SEBASTIAN_PROJECTS_FILE;
  if (file === undefined) return registry;
  let descriptors: readonly ProjectDescriptor[];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; projects?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.projects) || parsed.projects.length === 0) throw new Error();
    descriptors = parsed.projects as ProjectDescriptor[];
    if (descriptors.some(project => !project.workspace)) throw new Error();
    // Same registry implementation, with configured identities taking precedence over legacy env entries by id.
    const ids = new Set(descriptors.map(project => project.id));
    return new ProjectRegistry({ readOnly: true, entries: [...registry.listDescriptors().filter(project => !ids.has(project.id)), ...descriptors] });
  } catch { throw new Error('Configuração de projetos inválida (SEBASTIAN_PROJECTS_FILE). Nenhum fallback de checkout foi aplicado.'); }
}

export function createConfiguredProjectContext(dataDir: string, env: NodeJS.ProcessEnv = process.env): ProjectConversationContext | undefined {
  if (env.SEBASTIAN_PROJECTS_FILE === undefined) return undefined;
  return new ProjectConversationContext(loadConfiguredProjects(createGitHubProjectRegistry(env), env), new FileMemoryStore(resolveMemoryFilePath(dataDir)), env.SEBASTIAN_ENVIRONMENT_ID ?? 'unidentified-server');
}

/**
 * Etapa 2's real-execution counterpart to `createConfiguredProjectContext`.
 * Same opt-in gate (`SEBASTIAN_PROJECTS_FILE`), same registry/memory store
 * shape, so a real task's state lives in the same disk-persisted store as
 * project selection - just a different namespace, never a separate,
 * competing persistence mechanism. `executor` is overridable purely for
 * tests; production always gets the real `ClaudeCliProjectTaskExecutor`.
 */
export function createConfiguredProjectTaskOrchestrator(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  executor: ProjectTaskExecutor = new ClaudeCliProjectTaskExecutor(),
): ProjectTaskOrchestrator | undefined {
  if (env.SEBASTIAN_PROJECTS_FILE === undefined) return undefined;
  return new ProjectTaskOrchestrator(
    loadConfiguredProjects(createGitHubProjectRegistry(env), env),
    new FileMemoryStore(resolveMemoryFilePath(dataDir)),
    executor,
    env.SEBASTIAN_ENVIRONMENT_ID ?? 'unidentified-server',
  );
}

export function inspectProjectConfiguration(env: NodeJS.ProcessEnv = process.env): ProjectConfigurationRuntime {
  const file = env.SEBASTIAN_PROJECTS_FILE;
  const environmentId = env.SEBASTIAN_ENVIRONMENT_ID ?? 'unidentified-server';
  if (file === undefined) return { enabled: false, file, environmentId, projects: [] };
  const registry = loadConfiguredProjects(createGitHubProjectRegistry(env), env);
  const projects = registry.listDescriptors().map(project => {
    let checkout: 'available' | 'unavailable' = 'unavailable';
    let policies: readonly { path: string; hash: string }[] = [];
    try {
      if (project.workspace) {
        const root = realpathSync(project.workspace.root);
        if (!statSync(root).isDirectory()) throw new Error();
        policies = loadProjectPolicies(project, environmentId, '').map(({ path, hash }) => ({ path, hash }));
        checkout = 'available';
      }
    } catch { /* represented in the diagnostic status */ }
    return { id: project.id, displayName: project.displayName, aliases: project.aliases, checkout, policies };
  });
  return { enabled: true, file, environmentId, projects };
}
