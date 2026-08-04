#!/usr/bin/env node

/**
 * pi-messenger installer
 *
 * Copies the npm package contents to ~/.pi/agent/extensions/pi-messenger.
 * No git dependency — the npm package IS the source.
 *
 * Usage:
 *   npx pi-messenger                # Install or update extension
 *   npx pi-messenger --remove       # Remove the extension
 *   npx pi-messenger --crew-install   # Show crew agent info
 *   npx pi-messenger --crew-uninstall # Remove crew agents
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const PACKAGE_DIR = path.dirname(__filename);
const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const EXTENSION_DIR = path.join(AGENT_DIR, "extensions", "pi-messenger");
const NATIVE_PACKAGE_DIRS = [
	{ path: path.join(AGENT_DIR, "npm", "node_modules", "pi-messenger"), source: "npm:pi-messenger" },
	{ path: path.join(AGENT_DIR, "npm", "node_modules", "super-pi-messenger"), source: "npm:super-pi-messenger" },
];
const SETTINGS_PATH = path.join(AGENT_DIR, "settings.json");
const AGENTS_DIR = path.join(AGENT_DIR, "agents");

const CREW_AGENTS = [
	"crew-planner.md",
	"crew-interview-generator.md",
	"crew-plan-sync.md",
	"crew-worker.md",
	"crew-reviewer.md",
];

const DEPRECATED_AGENTS = [
	"crew-repo-scout.md",
	"crew-practice-scout.md",
	"crew-docs-scout.md",
	"crew-web-scout.md",
	"crew-github-scout.md",
	"crew-gap-analyst.md",
];

const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf-8"));
const VERSION = pkg.version;

const args = process.argv.slice(2);
const isRemove = args.includes("--remove") || args.includes("-r");
const isCrewInstall = args.includes("--crew-install");
const isCrewUninstall = args.includes("--crew-uninstall");
const isHelp = args.includes("--help") || args.includes("-h");

if (isHelp) {
	console.log(`
pi-messenger v${VERSION} - Multi-agent coordination for pi

Usage:
  npx pi-messenger                Install or update extension
  npx pi-messenger --remove       Remove the extension
  npx pi-messenger --crew-install   Show crew agent info
  npx pi-messenger --crew-uninstall Remove crew agents
  npx pi-messenger --help          Show this help

Extension directory: ${EXTENSION_DIR}
`);
	process.exit(0);
}

// ─── Crew install ────────────────────────────────────────────────────────────

if (isCrewInstall) {
	const agentsDir = path.join(EXTENSION_DIR, "crew", "agents");
	if (!fs.existsSync(agentsDir)) {
		console.log("Extension not installed. Run: npx pi-messenger");
		process.exit(1);
	}

	const agents = fs.readdirSync(agentsDir).filter(f => f.endsWith(".md"));
	console.log(`Crew agents (${agents.length}) ship with the extension:`);
	console.log(`  ${agentsDir}`);
	for (const agent of agents) {
		console.log(`  - ${agent}`);
	}
	console.log("\nTo customize, copy an agent to .pi/messenger/crew/agents/ and edit it.");
	process.exit(0);
}

// ─── Crew uninstall ──────────────────────────────────────────────────────────

if (isCrewUninstall) {
	let removed = 0;

	for (const agent of [...CREW_AGENTS, ...DEPRECATED_AGENTS]) {
		const target = path.join(AGENTS_DIR, agent);
		if (fs.existsSync(target)) {
			fs.unlinkSync(target);
			removed++;
		}
	}

	console.log(removed > 0
		? `Removed ${removed} crew agent(s) from ${AGENTS_DIR}`
		: "Nothing to remove");
	process.exit(0);
}

// ─── Extension remove ────────────────────────────────────────────────────────

if (isRemove) {
	if (fs.existsSync(EXTENSION_DIR)) {
		fs.rmSync(EXTENSION_DIR, { recursive: true });
		console.log("Removed pi-messenger from " + EXTENSION_DIR);
	} else {
		console.log("pi-messenger is not installed");
	}
	process.exit(0);
}

// Already running from the extension dir (e.g. local dev)
if (path.resolve(PACKAGE_DIR) === path.resolve(EXTENSION_DIR)) {
	console.log(`Already installed at ${EXTENSION_DIR} (v${VERSION})`);
	process.exit(0);
}

const isUpdate = fs.existsSync(EXTENSION_DIR);

function nativePackageSource() {
	const nativeDirectory = NATIVE_PACKAGE_DIRS.find(({ path }) => fs.existsSync(path));
	if (nativeDirectory) {
		return nativeDirectory.source;
	}

	try {
		const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
		const packages = Array.isArray(settings.packages) ? settings.packages : [];
		return packages.find(pkg =>
			pkg === "npm:pi-messenger"
			|| pkg === "npm:super-pi-messenger"
			|| /^git:github\.com\/aeturnal\/super-pi-messenger(?:@[^@]+)?$/.test(pkg),
		);
	} catch {
		return undefined;
	}
}

const nativeSource = nativePackageSource();
if (nativeSource) {
	const name = nativeSource === "npm:pi-messenger" ? "pi-messenger" : "Super Pi Messenger";
	console.log(`${name} is already installed via pi's native package flow.

Keep the native install and remove any legacy copy instead:

  npx pi-messenger --remove

Do not run the legacy npx installer alongside \`pi install ${nativeSource}\`; loading both copies registers the \`pi_messenger\` tool twice.`);
	process.exit(1);
}

// Warn if existing install is a git clone from the old installer
if (isUpdate && fs.existsSync(path.join(EXTENSION_DIR, ".git"))) {
	console.log("Existing install is a git clone. Remove it first:\n");
	console.log("  npx pi-messenger --remove && npx pi-messenger");
	process.exit(1);
}

// Clean slate for updates so removed files don't linger between versions
if (isUpdate) {
	fs.rmSync(EXTENSION_DIR, { recursive: true });
}

const SKIP = new Set([".git", "node_modules", ".DS_Store"]);

function copyDir(src, dest) {
	fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		if (SKIP.has(entry.name)) continue;
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDir(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

copyDir(PACKAGE_DIR, EXTENSION_DIR);

const action = isUpdate ? "Updated" : "Installed";
console.log(`${action} pi-messenger v${VERSION} → ${EXTENSION_DIR}

Tools:    pi_messenger
Commands: /messenger, /messenger config
Docs:     ${EXTENSION_DIR}/README.md`);
