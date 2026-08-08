import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import * as path from "node:path";
import type { WorkspaceIdentity } from "./types.ts";

export type WorkspaceErrorCode =
  | "workspace_not_absolute"
  | "workspace_not_git"
  | "workspace_cwd_mismatch"
  | "workspace_submodule"
  | "workspace_not_linked"
  | "workspace_identity_mismatch"
  | "plan_outside_workspace";

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  readonly expected?: unknown;
  readonly observed?: unknown;

  constructor(
    code: WorkspaceErrorCode,
    options: { expected?: unknown; observed?: unknown } = {},
  ) {
    super(code);
    this.name = "WorkspaceError";
    this.code = code;
    this.expected = options.expected;
    this.observed = options.observed;
  }
}

function canonicalize(candidate: string): string {
  return realpathSync(candidate);
}

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trimEnd();
  } catch {
    throw new WorkspaceError("workspace_not_git", { observed: root });
  }
}

function resolveIdentity(workspace: string, cwd: string): WorkspaceIdentity {
  if (!path.isAbsolute(workspace)) {
    throw new WorkspaceError("workspace_not_absolute", { observed: workspace });
  }

  const canonicalWorkspace = canonicalize(workspace);
  const canonicalCwd = canonicalize(cwd);
  const gitRoot = canonicalize(git(canonicalWorkspace, ["rev-parse", "--show-toplevel"]));
  const gitDir = canonicalize(git(canonicalWorkspace, ["rev-parse", "--absolute-git-dir"]));
  const gitCommonDir = canonicalize(git(canonicalWorkspace, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const superproject = git(canonicalWorkspace, ["rev-parse", "--show-superproject-working-tree"]);

  if (superproject) {
    throw new WorkspaceError("workspace_submodule", { observed: canonicalWorkspace });
  }

  if (gitDir === gitCommonDir) {
    throw new WorkspaceError("workspace_not_linked", { observed: canonicalWorkspace });
  }

  if (canonicalWorkspace !== canonicalCwd || canonicalWorkspace !== gitRoot) {
    throw new WorkspaceError("workspace_cwd_mismatch", {
      expected: canonicalWorkspace,
      observed: canonicalWorkspace !== canonicalCwd ? canonicalCwd : gitRoot,
    });
  }

  return { root: canonicalWorkspace, gitDir, gitCommonDir };
}

export function resolveWorkspace(workspace: string, cwd: string): WorkspaceIdentity {
  return resolveIdentity(workspace, cwd);
}

export function resolveContainedFile(workspace: WorkspaceIdentity, filePath: string): string {
  const file = canonicalize(filePath);
  const relative = path.relative(workspace.root, file);

  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new WorkspaceError("plan_outside_workspace", {
      expected: workspace.root,
      observed: file,
    });
  }

  return file;
}

export function workspacePrompt(identity: WorkspaceIdentity): string {
  return [
    `Authoritative workspace root: ${identity.root}`,
    "Do not edit files outside this root.",
    "Before the first edit, run `git rev-parse --show-toplevel`.",
    "If its result differs from `PI_CREW_WORKSPACE_ROOT`, stop and block the task.",
  ].join("\n");
}

export function verifyWorkspace(expected: WorkspaceIdentity, cwd: string): WorkspaceIdentity {
  const observed = resolveIdentity(cwd, cwd);

  if (
    observed.root !== expected.root
    || observed.gitDir !== expected.gitDir
    || observed.gitCommonDir !== expected.gitCommonDir
  ) {
    throw new WorkspaceError("workspace_identity_mismatch", { expected, observed });
  }

  return observed;
}
