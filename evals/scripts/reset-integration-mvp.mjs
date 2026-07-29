import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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
  const markerPath = join(destination, ".git", MARKER_NAME);
  let markerStat;
  let marker;

  try {
    markerStat = lstatSync(markerPath);
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
export function resetIntegrationMvp({ repositoryRoot, destination, now: _now }) {
  const canonicalRepositoryRoot = canonicalize(repositoryRoot);
  const runRoot = canonicalize(join(canonicalRepositoryRoot, "evals", "runs", FIXTURE));
  const canonicalDestination = canonicalize(destination);

  if (!isDescendant(runRoot, canonicalDestination)) {
    throw new Error(`Reset destination must be a descendant of the integration run root: ${runRoot}`);
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
  }

  throw new Error("Integration MVP reset creation is not implemented in Task 16");
}
