import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { run, sha256File } from "./lib.mjs";

const FIXTURE = "integration-mvp";
const MARKER_NAME = "pi-super-messenger-eval-marker.json";
const EXPECTED_MARKER = {
  schemaVersion: 1,
  kind: "pi-super-messenger-eval-run",
  fixture: FIXTURE,
};

function canonicalize(path) {
  const missingParts = [];
  let candidate = resolve(path);

  while (true) {
    try {
      const ancestor = realpathSync(candidate);
      return resolve(ancestor, ...missingParts.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      missingParts.push(basename(candidate));
      candidate = parent;
    }
  }
}

function isDescendant(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent !== "" &&
    pathFromParent !== ".." &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromParent)
  );
}

function hasExactMarker(marker) {
  if (marker === null || typeof marker !== "object" || Array.isArray(marker)) return false;
  const keys = Object.keys(marker).sort();
  return (
    keys.length === 3 &&
    keys[0] === "fixture" &&
    keys[1] === "kind" &&
    keys[2] === "schemaVersion" &&
    marker.schemaVersion === EXPECTED_MARKER.schemaVersion &&
    marker.kind === EXPECTED_MARKER.kind &&
    marker.fixture === EXPECTED_MARKER.fixture
  );
}

function requireValidMarker(destination) {
  const gitDirectory = join(destination, ".git");
  const markerPath = join(gitDirectory, MARKER_NAME);
  let marker;

  try {
    const gitDirectoryStat = lstatSync(gitDirectory);
    if (!gitDirectoryStat.isDirectory() || gitDirectoryStat.isSymbolicLink()) throw new Error("invalid .git type");
    const markerStat = lstatSync(markerPath);
    if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error("invalid marker type");
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    throw new Error(`Existing reset destination requires a valid integration MVP marker at ${markerPath}`);
  }

  if (!hasExactMarker(marker)) {
    throw new Error(`Existing reset destination requires a valid integration MVP marker at ${markerPath}`);
  }
}

/**
 * Validate a destination for the integration MVP reset.
 * Task 17 implements replacement and creation after this guard seam.
 */
export function resetIntegrationMvp({
  repositoryRoot,
  destination,
  now = () => new Date(),
}) {
  const canonicalRepositoryRoot = canonicalize(repositoryRoot);
  const runRoot = canonicalize(join(canonicalRepositoryRoot, "evals", "runs", FIXTURE));
  const canonicalDestination = canonicalize(destination);
  const seed = join(canonicalRepositoryRoot, "evals", "fixtures", FIXTURE, "seed");

  if (!isDescendant(runRoot, canonicalDestination)) {
    throw new Error(`Reset destination must be a descendant of the integration run root: ${runRoot}`);
  }

  const seedStat = lstatSync(seed);
  if (!seedStat.isDirectory() || seedStat.isSymbolicLink()) {
    throw new Error(`Integration MVP fixture seed must be a directory: ${seed}`);
  }

  let destinationStat;
  try {
    destinationStat = lstatSync(resolve(destination));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (destinationStat) {
    if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
      throw new Error("Existing destination must be a directory");
    }
    requireValidMarker(resolve(destination));

    const deletionTarget = canonicalize(destination);
    if (!isDescendant(runRoot, deletionTarget)) {
      throw new Error(`Reset destination must be a descendant of the integration run root: ${runRoot}`);
    }
    rmSync(deletionTarget, { recursive: true, force: false });
  }

  const createdAt = (typeof now === "function" ? now() : now).toISOString();
  const gitDirectory = join(canonicalDestination, ".git");
  const gitEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  Object.assign(gitEnvironment, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(gitDirectory, "pi-super-messenger-no-global-config"),
    GIT_AUTHOR_DATE: createdAt,
    GIT_COMMITTER_DATE: createdAt,
  });
  const gitOptions = { cwd: canonicalDestination, env: gitEnvironment };

  mkdirSync(dirname(canonicalDestination), { recursive: true });
  cpSync(seed, canonicalDestination, { recursive: true });
  run("git", ["init", "-b", "main"], gitOptions);
  run("git", ["config", "user.name", "Eval Fixture"], gitOptions);
  run("git", ["config", "user.email", "eval-fixture@example.invalid"], gitOptions);
  run("git", ["add", "--all"], gitOptions);
  run(
    "git",
    [
      "-c",
      "commit.gpgSign=false",
      "-c",
      `core.hooksPath=${join(gitDirectory, "pi-super-messenger-no-hooks")}`,
      "commit",
      "--no-gpg-sign",
      "-m",
      "eval: seed integration MVP fixture",
    ],
    gitOptions,
  );
  const seedCommit = run("git", ["rev-parse", "HEAD"], gitOptions).stdout.trim();

  const markerPath = join(gitDirectory, MARKER_NAME);
  const manifestPath = join(gitDirectory, "pi-super-messenger-eval-run.json");
  writeFileSync(markerPath, `${JSON.stringify(EXPECTED_MARKER)}\n`);
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        fixture: FIXTURE,
        seedCommit,
        testHashes: {
          "test/clamp.test.mjs": sha256File(join(seed, "test", "clamp.test.mjs")),
        },
        createdAt,
        result: { status: "not-run", verifier: null, supervised: null },
      },
      null,
      2,
    )}\n`,
  );

  return { worktree: canonicalDestination, seedCommit, manifestPath };
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1) throw new Error("Usage: reset-integration-mvp.mjs [destination]");
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const destination = args[0]
      ? resolve(args[0])
      : join(repositoryRoot, "evals", "runs", FIXTURE, "worktree");
    console.log(JSON.stringify(resetIntegrationMvp({ repositoryRoot, destination })));
  } catch (error) {
    console.error(error instanceof Error ? error.message.split("\n")[0] : String(error));
    process.exitCode = 1;
  }
}
