import type { ProjectDescriptor } from './ProjectTypes.js';
import {
  InvalidProjectRegistrationError,
  ProjectAlreadyRegisteredError,
  ProjectRegistryError,
} from './ProjectRegistryErrors.js';

export interface ProjectRegistryOptions {
  readonly readOnly?: boolean;
  readonly entries?: readonly ProjectDescriptor[];
}

/**
 * Normalizes a project reference (an `id`, `displayName` or alias, however
 * the caller wrote it) into a comparison key: diacritics stripped, folded to
 * lower case, every run of non-alphanumeric characters collapsed to a
 * single space, and trimmed. Deliberately exact-match only after this
 * normalization - never a fuzzy/edit-distance match - so "Neuro Hub"
 * resolves only when that exact phrase (or another registered alias) was
 * configured for a project, never to whichever project happens to be
 * textually closest.
 */
const COMBINING_DIACRITICAL_MARKS_PATTERN = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  'g',
);

function normalizeProjectReference(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_DIACRITICAL_MARKS_PATTERN, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The closed set of projects the cognitive loop is allowed to investigate.
 * Every entry is supplied by the composing application at construction time
 * (env/code), never registered by the model or derived from user text - a
 * friendly reference like "Neuro Hub" can only ever resolve to a project
 * that was already registered here, never to an invented owner/repository.
 * Mirrors `CapabilityRegistry`'s shape: immutable entries option, optional
 * `readOnly` lock, defensive cloning on every read.
 */
export class ProjectRegistry {
  private readonly projectsById = new Map<string, ProjectDescriptor>();
  private readonly idByReference = new Map<string, string>();
  private readonly readOnly: boolean;

  public constructor(options: ProjectRegistryOptions = {}) {
    this.readOnly = options.readOnly ?? false;

    for (const entry of options.entries ?? []) {
      this.registerInternal(entry);
    }
  }

  public register(descriptor: ProjectDescriptor): void {
    if (this.readOnly) {
      throw new ProjectRegistryError('Project registry is read-only after initialization.');
    }

    this.registerInternal(descriptor);
  }

  /**
   * Resolves a reference exactly as a cognitive Tool argument would supply
   * it - the registered `id`, `displayName`, or any registered alias, in any
   * casing/diacritics/punctuation variant that normalizes to the same key.
   * Returns `undefined` for anything else; never invents or guesses a
   * closest match.
   */
  public resolve(reference: string): ProjectDescriptor | undefined {
    if (typeof reference !== 'string' || reference.trim() === '') {
      return undefined;
    }

    const id = this.idByReference.get(normalizeProjectReference(reference));
    if (!id) {
      return undefined;
    }

    return this.cloneDescriptor(this.projectsById.get(id)!);
  }

  public getById(id: string): ProjectDescriptor | undefined {
    if (typeof id !== 'string' || id.trim() === '') {
      return undefined;
    }
    const descriptor = this.projectsById.get(id);
    return descriptor ? this.cloneDescriptor(descriptor) : undefined;
  }

  public has(id: string): boolean {
    return typeof id === 'string' && this.projectsById.has(id);
  }

  public listDescriptors(): readonly ProjectDescriptor[] {
    return Array.from(this.projectsById.values(), (descriptor) => this.cloneDescriptor(descriptor));
  }

  private registerInternal(descriptor: ProjectDescriptor): void {
    this.validateDescriptor(descriptor);

    if (this.projectsById.has(descriptor.id)) {
      throw new ProjectAlreadyRegisteredError(`Project already registered: ${descriptor.id}`);
    }

    const references = [descriptor.id, descriptor.displayName, ...descriptor.aliases];
    const normalizedReferences = references.map((reference) => {
      const normalized = normalizeProjectReference(reference);
      if (normalized === '') {
        throw new InvalidProjectRegistrationError(
          `Project reference "${reference}" for "${descriptor.id}" does not normalize to a usable name.`,
        );
      }
      return normalized;
    });

    for (const normalized of normalizedReferences) {
      const existingId = this.idByReference.get(normalized);
      if (existingId && existingId !== descriptor.id) {
        throw new ProjectAlreadyRegisteredError(
          `Project reference already registered to "${existingId}": "${normalized}".`,
        );
      }
    }

    this.projectsById.set(descriptor.id, this.cloneDescriptor(descriptor));
    for (const normalized of normalizedReferences) {
      this.idByReference.set(normalized, descriptor.id);
    }
  }

  private validateDescriptor(descriptor: ProjectDescriptor): void {
    const isObject = descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor);
    if (!isObject) {
      throw new InvalidProjectRegistrationError('Project descriptor must be an object.');
    }

    if (typeof descriptor.id !== 'string' || descriptor.id.trim() === '' || descriptor.id !== descriptor.id.trim()) {
      throw new InvalidProjectRegistrationError('Project descriptor id must be a non-empty, untrimmed-safe string.');
    }

    if (typeof descriptor.displayName !== 'string' || descriptor.displayName.trim() === '') {
      throw new InvalidProjectRegistrationError('Project descriptor displayName is required.');
    }

    if (!Array.isArray(descriptor.aliases) || descriptor.aliases.some((alias) => typeof alias !== 'string' || alias.trim() === '')) {
      throw new InvalidProjectRegistrationError('Project descriptor aliases must be an array of non-empty strings.');
    }

    if (descriptor.resourceKind !== 'github-repository') {
      throw new InvalidProjectRegistrationError('Project descriptor resourceKind must be "github-repository".');
    }

    const repository = descriptor.remoteRepository;
    const hasValidRepository =
      repository &&
      typeof repository === 'object' &&
      typeof repository.owner === 'string' &&
      repository.owner.trim() !== '' &&
      typeof repository.repository === 'string' &&
      repository.repository.trim() !== '' &&
      typeof repository.defaultBranch === 'string' &&
      repository.defaultBranch.trim() !== '';
    if (!hasValidRepository) {
      throw new InvalidProjectRegistrationError(
        'Project descriptor remoteRepository must declare a non-empty owner, repository and defaultBranch.',
      );
    }

    if (!descriptor.permissions || descriptor.permissions.access !== 'read-only') {
      throw new InvalidProjectRegistrationError('Project descriptor permissions.access must be "read-only".');
    }

    if (descriptor.localAgentPath !== undefined && (typeof descriptor.localAgentPath !== 'string' || descriptor.localAgentPath.trim() === '')) {
      throw new InvalidProjectRegistrationError('Project descriptor localAgentPath must be a non-empty string when provided.');
    }
  }

  private cloneDescriptor(descriptor: ProjectDescriptor): ProjectDescriptor {
    return structuredClone(descriptor);
  }
}
