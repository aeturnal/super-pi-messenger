import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSafeDescendant, run, sha256File, sha256Json } from "./lib.mjs";

const markerName = "pi-super-messenger-eval-marker.json";
const manifestName = "pi-super-messenger-eval-run.json";
const fixture = "independent-parallel";

function fixtureFileHashes(seed) {
  const hashes = {};
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.isFile()) hashes[path.relative(seed, filePath).split(path.sep).join("/")] = sha256File(filePath);
    }
  };
  visit(seed);
  return hashes;
}

function markedRun(destination) {
  const markerPath = path.join(destination, ".git", markerName);
  try {
    if (fs.lstatSync(markerPath).isSymbolicLink()) return false;
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    return marker?.schemaVersion === 1 && marker?.kind === "pi-super-messenger-eval-run" && marker?.fixture === fixture;
  } catch {
    return false;
  }
}

export function resetIndependentParallel({ repositoryRoot, destination, now = () => new Date() }) {
  const repository = path.resolve(repositoryRoot);
  const seed = path.join(repository, "evals", "fixtures", fixture, "seed");
  const profile = path.join(repository, "evals", "profiles", "stock-baseline.json");
  const runRoot = path.join(repository, "evals", "runs", fixture);
  const worktree = assertSafeDescendant(runRoot, destination);

  if (worktree === repository || worktree === seed) throw new Error("Refusing to reset repository or fixture seed");
  if (!fs.existsSync(seed) || !fs.existsSync(profile)) throw new Error("Fixture seed or stock profile is missing");

  if (fs.existsSync(worktree)) {
    if (!markedRun(worktree)) throw new Error(`Refusing to replace unmarked run: missing valid ${markerName}`);
    // Recheck immediately before the destructive operation.
    assertSafeDescendant(runRoot, worktree);
    fs.rmSync(worktree, { recursive: true, force: false });
  }

  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  assertSafeDescendant(runRoot, worktree);
  fs.cpSync(seed, worktree, { recursive: true });
  run("git", ["init", "-b", "main"], { cwd: worktree });
  run("git", ["config", "user.name", "Eval Fixture"], { cwd: worktree });
  run("git", ["config", "user.email", "eval-fixture@example.invalid"], { cwd: worktree });
  run("git", ["add", "--all"], { cwd: worktree });
  run("git", ["commit", "-m", "eval: seed independent parallel fixture"], { cwd: worktree });
  const seedCommit = run("git", ["rev-parse", "HEAD"], { cwd: worktree }).stdout.trim();

  const fixtureHashes = fixtureFileHashes(seed);
  const testHashes = Object.fromEntries(Object.entries(fixtureHashes).filter(([file]) => file.startsWith("test/")));
  const profileHash = sha256Json(JSON.parse(fs.readFileSync(profile, "utf8")));
  const gitDir = path.join(worktree, ".git");
  const createdAt = now().toISOString();
  const markerPath = path.join(gitDir, markerName);
  const manifestPath = path.join(gitDir, manifestName);
  fs.writeFileSync(markerPath, `${JSON.stringify({ schemaVersion: 1, kind: "pi-super-messenger-eval-run", fixture })}\n`);
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    fixture,
    fixtureHashes,
    testHashes,
    profileHash,
    seedCommit,
    createdAt,
    result: { status: "not-run", verifier: null, supervised: null },
  }, null, 2)}\n`);

  return { worktree, seedCommit, manifestPath };
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1) throw new Error("Usage: reset-independent-parallel.mjs [destination]");
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const destination = args[0] ? path.resolve(args[0]) : path.join(repositoryRoot, "evals", "runs", fixture, "worktree");
    console.log(JSON.stringify(resetIndependentParallel({ repositoryRoot, destination })));
  } catch (error) {
    console.error(error instanceof Error ? error.message.split("\n")[0] : String(error));
    process.exitCode = 1;
  }
}
