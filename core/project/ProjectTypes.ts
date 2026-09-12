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
 * Declared access level for the GitHub API surface (`GitHubReadOnlyTool`).
 * Only `read-only` is supported - no branch-creation, PR or workflow-dispatch
 * capability exists anywhere in this codebase, so there is deliberately no
 * broader value to choose here. This is unrelated to `workspace.close`
 * below: a local `git commit`/`push`/tag against an already-checked-out
 * repository uses the operator's own pre-configured Git/SSH credentials on
 * this machine, never the GitHub API/token this field gates.
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
  /** Configuration only: no command is executed by project identification. */
  readonly workspace?: {
    readonly root: string;
    readonly environment: { readonly id: string; readonly platform: 'win32' | 'linux' | 'darwin'; readonly label: string };
    readonly policySources: readonly { readonly path: string; readonly required: boolean; readonly topics: readonly string[] }[];
    readonly validations: readonly {
      readonly id: string;
      readonly executable: string;
      readonly args: readonly string[];
      readonly timeoutMs?: number;
    }[];
    /**
     * Explicit, per-project opt-in for FAZ (write-authorized task execution).
     * Absent or `false` means a "faça"-style request is refused even with a
     * real executor configured - a project only ever becomes writable by
     * this being turned on deliberately in its own local configuration, never
     * implicitly because an executor happens to be available.
     */
    readonly localWrite?: { readonly enabled: boolean };
    /**
     * Explicit, per-project opt-in for FECHA TUDO (commit/push/tag of a
     * homologated task). Separate from `localWrite`: writing files locally
     * and pushing to a remote are different blast radii, each opted into on
     * its own. `remoteName` defaults to `'origin'`, `allowedBranch` defaults
     * to `remoteRepository.defaultBranch` above (reused, never duplicated).
     * `tagging: 'auto'` creates a deterministic tag after a successful push;
     * `'disabled'` (the default) never tags automatically - a project's own
     * policy about when a checkpoint deserves a tag is set once, here, by a
     * human, rather than inferred from the loaded policy documents' prose.
     */
    readonly close?: {
      readonly enabled: boolean;
      readonly remoteName?: string;
      readonly allowedBranch?: string;
      readonly tagging?: 'auto' | 'disabled';
    };
    /**
     * Relative path prefixes that identify a migration file for this
     * project (e.g. `"supabase/migrations/"`). Absent or empty means the
     * project has no migration concept and the close flow's migration gate
     * always passes. Never a glob engine - plain prefix matching only, kept
     * deliberately simple.
     */
    readonly migrations?: { readonly paths: readonly string[] };
  };
}
