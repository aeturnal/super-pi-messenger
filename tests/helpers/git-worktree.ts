import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface GitWorktreeFixture {
  main: string;
  worktree: string;
  otherWorktree: string;
  cleanup(): void;
}

export interface GitSubmoduleFixture {
  submodule: string;
  cleanup(): void;
}

function git(args: string[]): void {
  execFileSync("git", args, { stdio: "pipe" });
}

function configureRepository(repository: string): void {
  git(["-C", repository, "config", "user.name", "Test User"]);
  git(["-C", repository, "config", "user.email", "test@example.com"]);
}

function commitInitialFile(repository: string): void {
  fs.writeFileSync(path.join(repository, "README.md"), "fixture\n");
  git(["-C", repository, "add", "README.md"]);
  git(["-C", repository, "commit", "-m", "Initial commit"]);
}

export function createGitWorktreeFixture(): GitWorktreeFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-messenger-worktree-"));
  const main = path.join(root, "main");
  const worktree = path.join(root, "worktree");
  const otherWorktree = path.join(root, "other-worktree");

  fs.mkdirSync(main);
  git(["init", main]);
  configureRepository(main);
  commitInitialFile(main);
  git(["-C", main, "worktree", "add", "--detach", worktree, "HEAD"]);
  git(["-C", main, "worktree", "add", "--detach", otherWorktree, "HEAD"]);

  return {
    main,
    worktree,
    otherWorktree,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

export function createGitSubmoduleFixture(): GitSubmoduleFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-messenger-submodule-"));
  const main = path.join(root, "main");
  const source = path.join(root, "source");
  const submodule = path.join(main, "vendor", "source");

  fs.mkdirSync(main);
  fs.mkdirSync(source);
  git(["init", source]);
  configureRepository(source);
  commitInitialFile(source);

  git(["init", main]);
  configureRepository(main);
  commitInitialFile(main);
  git(["-C", main, "-c", "protocol.file.allow=always", "submodule", "add", source, "vendor/source"]);

  return {
    submodule,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
