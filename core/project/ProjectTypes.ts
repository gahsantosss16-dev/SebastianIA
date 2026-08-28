/**
 * The kind of remote resource a registered project represents. Only
 * `github-repository` exists today; the type is closed (not a free string)
 * so a future resource kind is an explicit, reviewed addition, never an
 * implicit one.
 */
export type ProjectResourceKind = 'github-repository';

/**
 * The remote repository a `github-repository` project points to. Always
 * supplied by the composing application (env/code), never by the model and
 * never derived from user text - see `ProjectRegistry`'s "no invented
 * projects" guarantee.
 */
export interface GitHubRemoteRepository {
  readonly owner: string;
  readonly repository: string;
  readonly defaultBranch: string;
}

/**
 * Declared access level for a project. Only `read-only` is supported this
 * round - no write, branch-creation, commit, push, PR or workflow-dispatch
 * capability exists anywhere in this codebase yet, so there is deliberately
 * no broader value to choose here.
 */
export interface ProjectPermissions {
  readonly access: 'read-only';
}

/**
 * One authorized project the cognitive loop may investigate. Every field
 * the model could otherwise be tempted to invent (owner, repository,
 * branch, access level) lives here instead, resolved once by
 * `ProjectRegistry` and never accepted as a Tool argument.
 */
export interface ProjectDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly aliases: readonly string[];
  readonly resourceKind: ProjectResourceKind;
  readonly remoteRepository: GitHubRemoteRepository;
  readonly permissions: ProjectPermissions;
  /**
   * Reserved for a future local Windows agent path. Never populated,
   * validated beyond being a non-empty string when present, or consumed by
   * anything this round - present only so the shape does not need to change
   * again when that capability is built.
   */
  readonly localAgentPath?: string;
}
