import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256File } from "./lib.mjs";

const FIXTURE = "integration-mvp";
const MARKER_NAME = "pi-super-messenger-eval-marker.json";
const MANIFEST_NAME = "pi-super-messenger-eval-run.json";

function readJson(path, description) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${description}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function verifyIntegrationMvp({ repositoryRoot: _repositoryRoot, worktree }) {
  const gitDirectory = join(worktree, ".git");
  const marker = readJson(join(gitDirectory, MARKER_NAME), "integration MVP marker");
  if (
    !marker ||
    typeof marker !== "object" ||
    Array.isArray(marker) ||
    Object.keys(marker).sort().join(",") !== "fixture,kind,schemaVersion" ||
    marker.schemaVersion !== 1 ||
    marker.kind !== "pi-super-messenger-eval-run" ||
    marker.fixture !== FIXTURE
  ) {
    throw new Error("Invalid integration MVP marker");
  }

  const manifest = readJson(join(gitDirectory, MANIFEST_NAME), "integration MVP manifest");
  if (manifest?.schemaVersion !== 1 || manifest?.fixture !== FIXTURE) {
    throw new Error("Invalid integration MVP manifest");
  }

  for (const [testPath, expectedHash] of Object.entries(manifest.testHashes ?? {})) {
    const absoluteTestPath = join(worktree, testPath);
    if (!existsSync(absoluteTestPath)) {
      throw new Error(`Missing immutable test file: ${testPath}`);
    }
    if (sha256File(absoluteTestPath) !== expectedHash) {
      throw new Error(`Immutable test hash mismatch: ${testPath}`);
    }
  }

  const tests = spawnSync("npm", ["test"], { cwd: worktree, encoding: "utf8" });
  if (tests.error || tests.status !== 0) {
    throw new Error(
      `Fixture tests failed (status ${tests.status})\nstdout:\n${tests.stdout ?? ""}\nstderr:\n${tests.stderr ?? ""}`,
    );
  }

  const task = readJson(
    join(worktree, ".pi", "messenger", "crew", "tasks", "task-1.json"),
    "task-1 state",
  );
  if (task?.status !== "done") {
    throw new Error(`Task task-1 is not done: ${String(task?.status)}`);
  }

  const worktrees = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: worktree,
    encoding: "utf8",
  });
  if (worktrees.error || worktrees.status !== 0) {
    throw new Error(
      `Git worktree list failed (status ${worktrees.status}): ${worktrees.stderr ?? ""}`,
    );
  }
  const worktreeCount = (worktrees.stdout ?? "")
    .split("\n")
    .filter((line) => line.startsWith("worktree ")).length;
  if (worktreeCount !== 1) {
    throw new Error(`Expected exactly one Git worktree, found ${worktreeCount}`);
  }

  return { status: "passed", workerTrace: "", reviewerTrace: "" };
}
