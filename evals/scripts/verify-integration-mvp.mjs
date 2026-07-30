import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { sha256File } from "./lib.mjs";

const FIXTURE = "integration-mvp";
const MARKER_NAME = "pi-super-messenger-eval-marker.json";
const MANIFEST_NAME = "pi-super-messenger-eval-run.json";
const IMMUTABLE_TEST = "test/clamp.test.mjs";
const STOCK_TDD_SUFFIX =
  "/superpowers/skills/test-driven-development/SKILL.md";
const STOCK_VERIFICATION_SUFFIX =
  "/superpowers/skills/verification-before-completion/SKILL.md";
const PROJECT_STYLE_SUFFIX = "/.pi/skills/project-style/SKILL.md";

function readJson(path, description) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${description}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readCrewTrace(artifactsDirectory, role) {
  let names = [];
  try {
    names = readdirSync(artifactsDirectory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const matches = names.filter((name) =>
    new RegExp(`^.*_crew-${role}_.*\\.jsonl$`).test(name),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${role} trace in ${artifactsDirectory}, found ${matches.length}`,
    );
  }

  const path = join(artifactsDirectory, matches[0]);
  const events = readFileSync(path, "utf8")
    .split("\n")
    .flatMap((line, index) => {
      if (line.trim() === "") return [];
      try {
        return [JSON.parse(line)];
      } catch {
        throw new Error(`Malformed ${role} trace ${path} at line ${index + 1}`);
      }
    });
  return { path, events };
}

function hasReadEndingIn(events, suffix) {
  return events.some(
    (event) =>
      event?.type === "tool_execution_start" &&
      event.toolName === "read" &&
      typeof event.args?.path === "string" &&
      event.args.path.replaceAll("\\", "/").endsWith(suffix),
  );
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

  const artifactsDirectory = join(worktree, ".pi", "messenger", "crew", "artifacts");
  const worker = readCrewTrace(artifactsDirectory, "worker");
  const reviewer = readCrewTrace(artifactsDirectory, "reviewer");
  if (worker.path === reviewer.path) {
    throw new Error("Worker and reviewer traces must be distinct files");
  }

  if (!hasReadEndingIn(worker.events, STOCK_TDD_SUFFIX)) {
    throw new Error(
      "Missing required worker trace evidence: stock test-driven-development read",
    );
  }
  if (!hasReadEndingIn(worker.events, STOCK_VERIFICATION_SUFFIX)) {
    throw new Error(
      "Missing required worker trace evidence: stock verification-before-completion read",
    );
  }
  if (!hasReadEndingIn(worker.events, PROJECT_STYLE_SUFFIX)) {
    throw new Error("Missing required worker trace evidence: project-style read");
  }
  if (
    !worker.events.some(
      (event) =>
        event?.type === "tool_execution_start" && event.toolName === "pi_messenger",
    )
  ) {
    throw new Error("Missing required worker trace evidence: pi_messenger start");
  }
  if (!hasReadEndingIn(reviewer.events, STOCK_VERIFICATION_SUFFIX)) {
    throw new Error(
      "Missing required reviewer trace evidence: stock verification-before-completion read",
    );
  }

  return { status: "passed", workerTrace: worker.path, reviewerTrace: reviewer.path };
}
