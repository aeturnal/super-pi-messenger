import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = "npm:pi-messenger@0.14.1";
const RUNTIME_NAME = "stock-pi-messenger-0.14.1";
const MARKER_NAME = ".pi-super-messenger-stock-runtime.json";
const forbiddenEvidenceName = /auth\.json|settings\.json|pi-messenger\.json|models-store\.json|credentials|secret|token|api-key/i;
const privateKeyHeader = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i;
const credentialJsonKey = /"(?:apiKey|api_key|accessToken|refreshToken|authToken|oauthToken|clientSecret)"\s*:/i;
const bearerToken = /\bBearer\s+\S+/i;
const commonProviderToken = /\b(?:sk-[a-z0-9_-]+|ghp_[a-z0-9]+|github_pat_[a-z0-9_]+|xox[abprs]-[a-z0-9-]+|AIza[a-z0-9_-]+|ya29\.[a-z0-9_-]+)/i;
const environmentAssignment = /(?:^|\r?\n)\s*(?:export\s+)?(?:API_KEY|AUTH_TOKEN|OAUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/gi;
const providerEnvironmentAssignment = /(?:^|\r?\n)\s*(?:export\s+)?[a-z_][a-z0-9_]*_(?:api_key|auth_token|oauth_token|access_token|refresh_token|client_secret|secret|password|credentials?)\s*=\s*(?:"[^"]+"|'[^']+'|[^\s#]+)/i;

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

function assertEvidenceDestination(repositoryRoot, destination) {
  const evidenceRoot = path.resolve(repositoryRoot, "evals", "runs");
  const resolved = path.resolve(destination);
  const relative = path.relative(evidenceRoot, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Evidence destination must be beneath ${evidenceRoot}`);
  }
  assertNoSymlinkInPath(evidenceRoot);
  assertNoSymlinkInPath(resolved);
  if (pathExists(resolved)) throw new Error(`Evidence destination already exists: ${resolved}`);
  return resolved;
}

function containsSecretEvidence(text) {
  if (privateKeyHeader.test(text) || credentialJsonKey.test(text) || bearerToken.test(text) || commonProviderToken.test(text) || providerEnvironmentAssignment.test(text)) return true;
  environmentAssignment.lastIndex = 0;
  for (const match of text.matchAll(environmentAssignment)) {
    if (match.slice(1).some((value) => value !== undefined && value.length > 0)) return true;
  }
  return false;
}

function decodeEvidenceText(content, source) {
  if (content.includes(0) || content.some((byte) => (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x1b) || byte === 0x7f)) {
    throw new Error(`Evidence contains binary control content: ${source}`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new Error(`Evidence contains invalid UTF-8 binary content: ${source}`);
  }
}

function validateEvidenceTree(source) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Evidence contains symbolic link: ${source}`);
  if (forbiddenEvidenceName.test(path.basename(source))) throw new Error(`Evidence contains forbidden credential-like name: ${source}`);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      validateEvidenceTree(path.join(source, entry.name));
    }
    return;
  }
  if (!stat.isFile()) throw new Error(`Evidence contains non-regular file: ${source}`);

  const content = fs.readFileSync(source);
  // This is conservative ignored evidence retention, not automatic redaction.
  if (containsSecretEvidence(decodeEvidenceText(content, source))) throw new Error(`Evidence contains potentially secret content: ${source}`);
}

function copyEvidence(runtimeDir, destination) {
  const selected = ["sessions", "terminal.log", "terminal.jsonl"]
    .map((name) => path.join(runtimeDir, name))
    .filter(pathExists);
  for (const source of selected) validateEvidenceTree(source);
  fs.mkdirSync(destination, { recursive: true });
  assertNoSymlinkInPath(destination);
  for (const source of selected) {
    fs.cpSync(source, path.join(destination, path.basename(source)), { recursive: true, force: true, errorOnExist: false, verbatimSymlinks: true });
  }
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

export function cleanupStockRuntime({ repositoryRoot, runtimeRoot = defaultRuntimeRoot(), runtimeDir, evidenceDestination } = {}) {
  const candidate = runtimeDir ?? path.join(runtimeRoot, RUNTIME_NAME);
  let expected = path.resolve(candidate);
  try {
    const validated = assertExpectedRuntime(runtimeRoot, candidate);
    expected = validated.expected;
    if (!pathExists(expected)) throw new Error(`Runtime does not exist: ${expected}`);
    validateMarker(expected, validated.root);
    const evidencePath = evidenceDestination === undefined ? undefined : assertEvidenceDestination(repositoryRoot, evidenceDestination);
    if (evidencePath) copyEvidence(expected, evidencePath);
    assertExpectedRuntime(validated.root, expected);
    fs.rmSync(expected, { recursive: true, force: false });
    if (pathExists(expected)) throw new Error(`Runtime still exists after removal: ${expected}`);
    return evidencePath ? { removed: true, evidencePath } : { removed: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cleanup failed for runtime ${expected}: ${detail}`);
  }
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== "--runtime" && flag !== "--evidence") throw new Error(`Unknown flag ${flag}`);
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
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const runtimeDir = path.resolve(args["--runtime"]);
    reportedPath = runtimeDir;
    console.log(JSON.stringify(cleanupStockRuntime({ repositoryRoot, runtimeDir, evidenceDestination: args["--evidence"] && path.resolve(args["--evidence"]) })));
  } catch (error) {
    console.error(`Cleanup failed for runtime ${reportedPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
