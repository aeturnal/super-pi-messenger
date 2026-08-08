import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WorkspaceError,
  resolveContainedFile,
  resolveWorkspace,
  workspacePrompt,
} from "../../crew/workspace.js";
import { createGitWorktreeFixture } from "../helpers/git-worktree.js";

const cleanups: (() => void)[] = [];

afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function fixture() {
  const result = createGitWorktreeFixture();
  cleanups.push(result.cleanup);
  return result;
}

function expectWorkspaceError(action: () => unknown, code: string): WorkspaceError {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(WorkspaceError);
  const workspaceError = thrown as WorkspaceError;
  expect(workspaceError.code).toBe(code);
  return workspaceError;
}

describe("workspace containment", () => {
  it("returns the canonical path for a file inside the linked worktree", () => {
    const fx = fixture();
    const identity = resolveWorkspace(fx.worktree, fx.worktree);
    const file = path.join(fx.worktree, "plans", "plan.md");
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, "plan\n");

    expect(resolveContainedFile(identity, file)).toBe(fs.realpathSync(file));
  });

  it("rejects a file in the main checkout", () => {
    const fx = fixture();
    const identity = resolveWorkspace(fx.worktree, fx.worktree);

    expectWorkspaceError(
      () => resolveContainedFile(identity, path.join(fx.main, "README.md")),
      "plan_outside_workspace",
    );
  });

  it("rejects traversal that resolves outside the linked worktree", () => {
    const fx = fixture();
    const identity = resolveWorkspace(fx.worktree, fx.worktree);
    const traversedFile = path.join(fx.worktree, "..", path.basename(fx.main), "README.md");

    expectWorkspaceError(
      () => resolveContainedFile(identity, traversedFile),
      "plan_outside_workspace",
    );
  });

  it("rejects a file symlink that points outside the linked worktree", () => {
    const fx = fixture();
    const identity = resolveWorkspace(fx.worktree, fx.worktree);
    const symlink = path.join(fx.worktree, "outside.md");
    fs.symlinkSync(path.join(fx.main, "README.md"), symlink);

    expectWorkspaceError(
      () => resolveContainedFile(identity, symlink),
      "plan_outside_workspace",
    );
  });

  it("accepts a worktree symlink alias after canonicalization", () => {
    const fx = fixture();
    const identity = resolveWorkspace(fx.worktree, fx.worktree);
    const alias = path.join(path.dirname(fx.worktree), "worktree-alias");
    fs.symlinkSync(fx.worktree, alias, "dir");

    expect(resolveContainedFile(identity, path.join(alias, "README.md")))
      .toBe(path.join(identity.root, "README.md"));
  });

  it("describes the exact workspace root and blocking verification rule", () => {
    const fx = fixture();
    const identity = resolveWorkspace(fx.worktree, fx.worktree);
    const prompt = workspacePrompt(identity);

    expect(prompt).toContain(identity.root);
    expect(prompt).toContain("PI_CREW_WORKSPACE_ROOT");
    expect(prompt).toContain("git rev-parse --show-toplevel");
    expect(prompt).toMatch(/block|stop/i);
  });
});
