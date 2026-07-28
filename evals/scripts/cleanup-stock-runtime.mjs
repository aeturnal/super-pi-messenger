import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = "npm:pi-messenger@0.14.1";
const RUNTIME_NAME = "stock-pi-messenger-0.14.1";
const MARKER_NAME = ".pi-super-messenger-stock-runtime.json";

export function defaultRuntimeRoot() {
  return path.join(os.tmpdir(), `pi-super-messenger-evals-${process.getuid?.() ?? process.pid}`);
}

function pathExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function assertNoSymlinkInPath(filePath) {
  const absolute = path.resolve(filePath);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep)) {
    if (!component) continue;
    current = path.join(current, component);
    if (pathExists(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Unsafe path: symbolic link at ${current}`);
    }
  }
}

function assertExpectedRuntime(runtimeRoot, runtimeDir) {
  const root = path.resolve(runtimeRoot);
  const expected = path.resolve(root, RUNTIME_NAME);
  const supplied = path.resolve(runtimeDir);
  assertNoSymlinkInPath(root);
  assertNoSymlinkInPath(supplied);
  if (supplied !== expected) throw new Error(`Expected runtime path ${expected}, received ${supplied}`);
  return { root, expected };
}

function validateMarker(runtimeDir, runtimeRoot) {
  const markerPath = path.join(runtimeDir, MARKER_NAME);
  let marker;
  try {
    if (fs.lstatSync(markerPath).isSymbolicLink()) throw new Error("marker is a symbolic link");
    marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch (error) {
    throw new Error(`Missing or invalid runtime marker ${markerPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const expectedKeys = ["schemaVersion", "kind", "package", "runtimeRoot"];
  if (
    !marker ||
    typeof marker !== "object" ||
    Array.isArray(marker) ||
    Object.getPrototypeOf(marker) !== Object.prototype ||
    Object.keys(marker).length !== expectedKeys.length ||
    !expectedKeys.every((key) => Object.hasOwn(marker, key)) ||
    marker.schemaVersion !== 1 ||
    marker.kind !== "pi-super-messenger-stock-runtime" ||
    marker.package !== PACKAGE ||
    marker.runtimeRoot !== runtimeRoot
  ) {
    throw new Error(`Missing or invalid runtime marker ${markerPath}`);
  }
}

export function cleanupStockRuntime({ runtimeRoot = defaultRuntimeRoot(), runtimeDir } = {}) {
  const candidate = runtimeDir ?? path.join(runtimeRoot, RUNTIME_NAME);
  let expected = path.resolve(candidate);
  try {
    const validated = assertExpectedRuntime(runtimeRoot, candidate);
    expected = validated.expected;
    if (!pathExists(expected)) throw new Error(`Runtime does not exist: ${expected}`);
    validateMarker(expected, validated.root);
    assertExpectedRuntime(validated.root, expected);
    fs.rmSync(expected, { recursive: true, force: false });
    if (pathExists(expected)) throw new Error(`Runtime still exists after removal: ${expected}`);
    return { removed: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cleanup failed for runtime ${expected}: ${detail}`);
  }
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== "--runtime") throw new Error(`Unknown flag ${flag}`);
    if (Object.hasOwn(values, flag)) throw new Error(`Repeated flag ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    values[flag] = value;
    index += 1;
  }
  if (!values["--runtime"]) throw new Error("Missing required --runtime");
  return values;
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const defaultPath = path.join(defaultRuntimeRoot(), RUNTIME_NAME);
  let reportedPath = defaultPath;
  try {
    const args = parseArgs(process.argv.slice(2));
    const runtimeDir = path.resolve(args["--runtime"]);
    reportedPath = runtimeDir;
    console.log(JSON.stringify(cleanupStockRuntime({ runtimeDir })));
  } catch (error) {
    console.error(`Cleanup failed for runtime ${reportedPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
