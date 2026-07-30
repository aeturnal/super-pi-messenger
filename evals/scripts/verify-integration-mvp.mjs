import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { sha256File } from "./lib.mjs";

const FIXTURE = "integration-mvp";
const MARKER_NAME = "pi-super-messenger-eval-marker.json";
const MANIFEST_NAME = "pi-super-messenger-eval-run.json";
const IMMUTABLE_TEST = "test/clamp.test.mjs";

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

  const testHashes = manifest.testHashes;
  if (
    !testHashes ||
    typeof testHashes !== "object" ||
    Array.isArray(testHashes) ||
    Object.getPrototypeOf(testHashes) !== Object.prototype ||
    Object.keys(testHashes).length !== 1 ||
    !Object.hasOwn(testHashes, IMMUTABLE_TEST) ||
    typeof testHashes[IMMUTABLE_TEST] !== "string" ||
    !/^[a-f0-9]{64}$/.test(testHashes[IMMUTABLE_TEST])
  ) {
    throw new Error("Invalid immutable hashes/path");
  }

  const worktreeRoot = resolve(worktree);
  const absoluteTestPath = resolve(worktreeRoot, IMMUTABLE_TEST);
  const relativeTestPath = relative(worktreeRoot, absoluteTestPath);
  if (
    relativeTestPath === "" ||
    relativeTestPath === ".." ||
    relativeTestPath.startsWith(`..${sep}`) ||
    isAbsolute(relativeTestPath)
  ) {
    throw new Error("Invalid immutable hashes/path");
  }
  if (!existsSync(absoluteTestPath)) {
    throw new Error(`Missing immutable test file: ${IMMUTABLE_TEST}`);
  }
  if (sha256File(absoluteTestPath) !== testHashes[IMMUTABLE_TEST]) {
    throw new Error(`Immutable test hash mismatch: ${IMMUTABLE_TEST}`);
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
