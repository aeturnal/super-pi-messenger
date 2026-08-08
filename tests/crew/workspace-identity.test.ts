import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WorkspaceError,
  resolveWorkspace,
  verifyWorkspace,
} from "../../crew/workspace.js";
import {
  createGitSubmoduleFixture,
  createGitWorktreeFixture,
} from "../helpers/git-worktree.js";

const cleanups: (() => void)[] = [];

afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function fixture() {
  const result = createGitWorktreeFixture();
  cleanups.push(result.cleanup);
  return result;
}

function submoduleFixture() {
  const result = createGitSubmoduleFixture();
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

describe("workspace identity", () => {
  it("resolves and re-verifies one linked worktree", () => {
    const fx = fixture();

    const identity = resolveWorkspace(fx.worktree, fx.worktree);

    expect(identity.root).toBe(fs.realpathSync(fx.worktree));
    expect(identity.gitDir).not.toBe(identity.gitCommonDir);
    expect(verifyWorkspace(identity, fx.worktree)).toEqual(identity);
  });

  it("rejects non-absolute workspace input with a stable code", () => {
    const fx = fixture();

    expectWorkspaceError(
      () => resolveWorkspace(path.basename(fx.worktree), fx.worktree),
      "workspace_not_absolute",
    );
  });

  it("rejects a non-Git directory with a stable code", () => {
    const plainDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-messenger-plain-"));
    cleanups.push(() => fs.rmSync(plainDirectory, { recursive: true, force: true }));

    expectWorkspaceError(
      () => resolveWorkspace(plainDirectory, plainDirectory),
      "workspace_not_git",
    );
  });

  it("rejects a mismatched cwd with a stable code", () => {
    const fx = fixture();

    expectWorkspaceError(
      () => resolveWorkspace(fx.worktree, fx.otherWorktree),
      "workspace_cwd_mismatch",
    );
  });

  it("rejects the main checkout with a stable code", () => {
    const fx = fixture();

    expectWorkspaceError(
      () => resolveWorkspace(fx.main, fx.main),
      "workspace_not_linked",
    );
  });

  it("rejects a real submodule with a stable code", () => {
    const fx = submoduleFixture();

    expectWorkspaceError(
      () => resolveWorkspace(fx.submodule, fx.submodule),
      "workspace_submodule",
    );
  });

  it("rejects another worktree from the same repository", () => {
    const fx = fixture();
    const identity = resolveWorkspace(fx.worktree, fx.worktree);

    const error = expectWorkspaceError(
      () => verifyWorkspace(identity, fx.otherWorktree),
      "workspace_identity_mismatch",
    );

    expect(error.expected).toEqual(identity);
    expect(error.observed).toMatchObject({ root: fs.realpathSync(fx.otherWorktree) });
  });
});
