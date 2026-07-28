import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertSafeDescendant, sha256File, sha256Json } from "./lib.mjs";

const fixture = "independent-parallel";
const markerName = "pi-super-messenger-eval-marker.json";
const manifestName = "pi-super-messenger-eval-run.json";
const verificationName = "pi-super-messenger-eval-verification.json";
const sourcePaths = ["src/duration.mjs", "src/format-bytes.mjs", "src/retry-after.mjs"];

function readJson(filePath, description) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch (error) {
    throw new Error(`Invalid ${description}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireNonSymlink(filePath, description) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    throw new Error(`Missing ${description}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (stat.isSymbolicLink()) throw new Error(`Unsafe ${description}: symbolic link`);
  return stat;
}

function existsWithoutFollowingLinks(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function fixtureEntries(root, directory = root) {
  const entries = {};
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (directory === root && entry.name === ".git") continue;
    const filePath = path.join(directory, entry.name);
    if (directory === root && entry.name === ".pi") {
      if (entry.isSymbolicLink()) throw new Error("Unsafe .pi directory: symbolic link");
      if (!entry.isDirectory()) {
        entries[entry.name] = entry.isFile() ? "file" : "unsupported";
        continue;
      }
      const piEntries = fs.readdirSync(filePath, { withFileTypes: true });
      const messenger = piEntries.find((piEntry) => piEntry.name === "messenger");
      if (messenger?.isSymbolicLink()) throw new Error("Unsafe .pi/messenger directory: symbolic link");
      if (messenger?.isDirectory() && piEntries.length === 1) continue;
      entries[entry.name] = "directory";
      for (const piEntry of piEntries) {
        const piPath = path.join(filePath, piEntry.name);
        const piRelativePath = path.relative(root, piPath).split(path.sep).join("/");
        if (piEntry.isDirectory()) {
          entries[piRelativePath] = "directory";
          Object.assign(entries, fixtureEntries(root, piPath));
        } else if (piEntry.isFile()) {
          entries[piRelativePath] = "file";
        } else {
          entries[piRelativePath] = "unsupported";
        }
      }
      continue;
    }
    const relativePath = path.relative(root, filePath).split(path.sep).join("/");
    if (entry.isDirectory()) {
      entries[relativePath] = "directory";
      Object.assign(entries, fixtureEntries(root, filePath));
    } else if (entry.isFile()) {
      entries[relativePath] = "file";
    } else {
      entries[relativePath] = "unsupported";
    }
  }
  return entries;
}

function hashFiles(root) {
  const hashes = {};
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.isFile()) hashes[path.relative(root, filePath).split(path.sep).join("/")] = sha256File(filePath);
    }
  };
  visit(root);
  return hashes;
}

function sameMap(actual, expected) {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length && actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key]);
}

function command(commandName, args, cwd) {
  const child = spawnSync(commandName, args, { cwd, encoding: "utf8" });
  return { stdout: child.stdout ?? "", stderr: child.stderr ?? "", status: child.status, signal: child.signal, error: child.error };
}

function requiredGit(commandName, args, cwd) {
  const result = command(commandName, args, cwd);
  if (result.error || result.status !== 0) throw new Error(`Git command failed: ${commandName} ${args.join(" ")}\n${result.stdout}${result.stderr}`);
  return result.stdout.trim();
}

function validateInitialResult(result) {
  return result && typeof result === "object" && !Array.isArray(result)
    && Object.keys(result).sort().join(",") === "status,supervised,verifier"
    && result.status === "not-run" && result.verifier === null && result.supervised === null;
}

function preflight(repositoryRoot, worktree) {
  const repository = path.resolve(repositoryRoot);
  const seed = path.join(repository, "evals", "fixtures", fixture, "seed");
  const profile = path.join(repository, "evals", "profiles", "stock-baseline.json");
  const runRoot = path.join(repository, "evals", "runs", fixture);
  const checkedWorktree = assertSafeDescendant(runRoot, worktree);
  if (!fs.existsSync(seed) || !fs.existsSync(profile)) throw new Error("Fixture seed or stock profile is missing");

  const gitDir = path.join(checkedWorktree, ".git");
  if (!requireNonSymlink(gitDir, ".git directory").isDirectory()) throw new Error("Invalid .git directory");
  const markerPath = path.join(gitDir, markerName);
  requireNonSymlink(markerPath, "fixture marker");
  const marker = readJson(markerPath, "fixture marker");
  if (Object.keys(marker).length !== 3 || marker.schemaVersion !== 1 || marker.kind !== "pi-super-messenger-eval-run" || marker.fixture !== fixture) throw new Error("Invalid fixture marker");
  const manifestPath = path.join(gitDir, manifestName);
  requireNonSymlink(manifestPath, "run manifest");
  const manifest = readJson(manifestPath, "run manifest");
  if (manifest.schemaVersion !== 1) throw new Error("Invalid manifest schema version");
  const expectedFixtureHashes = hashFiles(seed);
  const expectedTestHashes = Object.fromEntries(Object.entries(expectedFixtureHashes).filter(([name]) => name.startsWith("test/") && name.endsWith(".test.mjs")));
  if (manifest.fixture !== fixture || !sameMap(manifest.fixtureHashes ?? {}, expectedFixtureHashes)) throw new Error("fixture hash mismatch");
  if (!sameMap(manifest.testHashes ?? {}, expectedTestHashes)) throw new Error("test hash mismatch");
  if (manifest.profileHash !== sha256Json(readJson(profile, "stock profile"))) throw new Error("profile hash mismatch");
  if (!validateInitialResult(manifest.result)) throw new Error("Invalid manifest result schema");
  if (typeof manifest.seedCommit !== "string" || !/^[a-f0-9]{40}$/.test(manifest.seedCommit)) throw new Error("Invalid seed commit");
  requiredGit("git", ["cat-file", "-e", `${manifest.seedCommit}^{commit}`], checkedWorktree);
  const headCommit = requiredGit("git", ["rev-parse", "HEAD"], checkedWorktree);
  if (command("git", ["merge-base", "--is-ancestor", manifest.seedCommit, headCommit], checkedWorktree).status !== 0) throw new Error("Seed commit is not an ancestor of HEAD");

  const expectedEntries = fixtureEntries(seed);
  const currentEntries = fixtureEntries(checkedWorktree);
  const expectedEntryPaths = Object.keys(expectedEntries).sort();
  const currentEntryPaths = Object.keys(currentEntries).sort();
  if (expectedEntryPaths.join("\n") !== currentEntryPaths.join("\n")
    || expectedEntryPaths.some((entryPath) => expectedEntries[entryPath] !== currentEntries[entryPath])) {
    const changedPaths = [...new Set([...expectedEntryPaths, ...currentEntryPaths])]
      .filter((entryPath) => expectedEntries[entryPath] !== currentEntries[entryPath]);
    const onlyTestPathsChanged = changedPaths.every((entryPath) => entryPath.startsWith("test/"));
    throw new Error(onlyTestPathsChanged ? "test paths mismatch" : "fixture boundary mismatch: unexpected, missing, or unsafe worktree entry");
  }
  for (const entryPath of expectedEntryPaths) {
    if (expectedEntries[entryPath] !== "file" || sourcePaths.includes(entryPath)) continue;
    if (sha256File(path.join(checkedWorktree, entryPath)) !== sha256File(path.join(seed, entryPath))) {
      if (entryPath.startsWith("test/") && entryPath.endsWith(".test.mjs")) throw new Error(`test hash mismatch: ${entryPath}`);
      throw new Error(`fixture boundary mismatch: immutable file changed: ${entryPath}`);
    }
  }
  const expectedPaths = Object.keys(expectedTestHashes).sort();
  for (const sourcePath of sourcePaths) {
    const absolute = path.join(checkedWorktree, sourcePath);
    if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile()) throw new Error(`Missing source file: ${sourcePath}`);
    if (fs.readFileSync(absolute, "utf8").includes("NOT_IMPLEMENTED")) throw new Error(`NOT_IMPLEMENTED sentinel remains in ${sourcePath}`);
  }
  const resultPath = path.join(gitDir, verificationName);
  if (existsWithoutFollowingLinks(resultPath)) requireNonSymlink(resultPath, "verification result path");
  return { worktree: checkedWorktree, gitDir, manifest, headCommit, testPaths: expectedPaths, resultPath };
}

export function verifyIndependentParallel({ repositoryRoot, worktree }) {
  const checked = preflight(repositoryRoot, worktree);
  const testRun = command("node", ["--test", ...checked.testPaths], checked.worktree);
  const result = {
    passed: testRun.status === 0,
    testExitCode: testRun.status,
    seedCommit: checked.manifest.seedCommit,
    headCommit: checked.headCommit,
    gitStatus: requiredGit("git", ["status", "--porcelain"], checked.worktree),
    testHashes: checked.manifest.testHashes,
    stdout: testRun.stdout,
    stderr: testRun.stderr,
  };
  fs.writeFileSync(checked.resultPath, `${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) {
    const error = new Error(`Verification failed; verifier result: ${checked.resultPath}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    error.resultPath = checked.resultPath;
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return result;
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  let resultPath;
  try {
    const args = process.argv.slice(2);
    if (args.length > 1) throw new Error("Usage: verify-independent-parallel.mjs [worktree]");
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const worktree = args[0] ? path.resolve(args[0]) : path.join(repositoryRoot, "evals", "runs", fixture, "worktree");
    console.log(JSON.stringify(verifyIndependentParallel({ repositoryRoot, worktree })));
  } catch (error) {
    resultPath = error?.resultPath;
    console.error(error instanceof Error ? error.message : String(error));
    if (resultPath) console.error(`Verifier result retained at: ${resultPath}`);
    process.exitCode = 1;
  }
}
