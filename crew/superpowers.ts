import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";

export interface SkillRef {
  name: string;
  description: string;
  filePath: string;
}

export type SuperpowersState =
  | { status: "inactive" }
  | { status: "fallback"; reason: string; correctiveAction: string; version?: string }
  | {
      status: "active";
      version: string;
      packageRoot: string;
      skills: Record<"test-driven-development" | "verification-before-completion", SkillRef>;
    };

const SUPPORTED_MAJOR = 6;
const REQUIRED_NAMES = ["test-driven-development", "verification-before-completion"] as const;
const STOCK_NAMES = ["using-superpowers", ...REQUIRED_NAMES] as const;
const STOCK_BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for pi";

let superpowersState: SuperpowersState = { status: "inactive" };

function normalizeOfficialSource(value: string): string {
  return value.trim()
    .replace(/^git:/, "")
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^ssh:\/\/git@github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git(?=@|$)/, "")
    .replace(/@[^/]+$/, "");
}

function isOfficialSource(value: string): boolean {
  return normalizeOfficialSource(value) === "obra/superpowers";
}

function fallback(
  reason: string,
  version?: string,
  correctiveAction = "Reinstall the official Superpowers package.",
): SuperpowersState {
  superpowersState = {
    status: "fallback",
    reason,
    correctiveAction,
    ...(version === undefined ? {} : { version }),
  };
  return superpowersState;
}

export function captureSuperpowersSkills(skills: readonly Skill[]): SuperpowersState {
  try {
    const officialSkills = skills.filter(
      (skill) => isOfficialSource(skill.sourceInfo.source)
        && STOCK_NAMES.some((name) => name === skill.name),
    );
    const localSources = [...new Set(skills.map((skill) => skill.sourceInfo.source))].filter(
      (source) => path.isAbsolute(source)
        && REQUIRED_NAMES.every((name) => skills.some(
          (skill) => skill.sourceInfo.source === source && skill.name === name,
        )),
    );
    const localSkills = skills.filter((skill) => localSources.includes(skill.sourceInfo.source));
    const candidateSkills = [...officialSkills, ...localSkills];

    if (candidateSkills.length === 0) {
      superpowersState = { status: "inactive" };
      return superpowersState;
    }

    const hasProjectShadow = skills.some(
      (skill) => REQUIRED_NAMES.some((name) => name === skill.name)
        && (skill.sourceInfo.origin === "top-level" || skill.sourceInfo.scope === "project"),
    );
    if (hasProjectShadow) {
      return fallback(
        "shadowed",
        undefined,
        "Remove or rename the project skill shadowing the official Superpowers skill.",
      );
    }

    if (candidateSkills.some(
      (skill) => REQUIRED_NAMES.some((name) => name === skill.name)
        && skill.sourceInfo.origin !== "package",
    )) {
      return fallback("invalid Superpowers skill provenance");
    }

    const candidateRoots: string[] = [];
    for (const skill of candidateSkills) {
      const baseDir = skill.sourceInfo.baseDir;
      if (!baseDir) {
        return fallback("unable to validate official Superpowers package source");
      }
      const candidateRoot = fs.realpathSync(baseDir);
      if (!candidateRoots.includes(candidateRoot)) candidateRoots.push(candidateRoot);
    }
    const hasDuplicateRequiredSkill = REQUIRED_NAMES.some(
      (name) => candidateSkills.filter((skill) => skill.name === name).length > 1,
    );
    if (candidateRoots.length !== 1 || hasDuplicateRequiredSkill) {
      return fallback(
        "ambiguous",
        undefined,
        "Remove duplicate Superpowers catalog entries and keep one official package root.",
      );
    }

    const localSource = officialSkills.length === 0 ? localSources[0] : undefined;
    const packageRoot = candidateRoots[0];
    if (packageRoot === undefined) {
      return fallback("unable to validate official Superpowers package source");
    }
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as { name?: unknown; version?: unknown };

    if (packageJson.name !== "superpowers") {
      return fallback("invalid Superpowers package metadata");
    }
    if (typeof packageJson.version !== "string" || !/^\d+\.\d+\.\d+$/.test(packageJson.version)) {
      return fallback("invalid Superpowers version");
    }

    const version = packageJson.version;
    const major = version.split(".", 1)[0];
    if (major !== String(SUPPORTED_MAJOR)) {
      return fallback("unsupported Superpowers major version", version);
    }

    const extension = fs.readFileSync(
      path.join(packageRoot, ".pi", "extensions", "superpowers.ts"),
      "utf8",
    );
    if (!extension.includes(STOCK_BOOTSTRAP_MARKER)) {
      return fallback("missing Superpowers bootstrap marker", version);
    }

    const requiredSkills = {} as Record<(typeof REQUIRED_NAMES)[number], SkillRef>;
    for (const name of REQUIRED_NAMES) {
      const skill = candidateSkills.find((candidate) => candidate.name === name);
      if (!skill) return fallback(`missing required Superpowers skill: ${name}`, version);

      const skillBaseDir = skill.sourceInfo.baseDir;
      if (!skillBaseDir) {
        return fallback(`invalid canonical path for Superpowers skill: ${name}`, version);
      }

      const expectedPath = path.join(packageRoot, "skills", name, "SKILL.md");
      const canonicalPath = fs.realpathSync(skill.filePath);
      if (canonicalPath !== expectedPath || fs.realpathSync(skillBaseDir) !== packageRoot) {
        return fallback(`invalid canonical path for Superpowers skill: ${name}`, version);
      }
      fs.accessSync(canonicalPath, fs.constants.R_OK);
      requiredSkills[name] = {
        name: skill.name,
        description: skill.description,
        filePath: canonicalPath,
      };
    }

    if (localSource !== undefined) {
      let origin: string;
      try {
        origin = execFileSync(
          "git",
          ["-C", packageRoot, "remote", "get-url", "origin"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        );
      } catch {
        return fallback("unable to verify local Superpowers Git origin", version);
      }
      if (!isOfficialSource(origin)) {
        return fallback("local Superpowers Git origin is not official", version);
      }
    }

    superpowersState = {
      status: "active",
      version,
      packageRoot,
      skills: requiredSkills,
    };
    return superpowersState;
  } catch {
    return fallback("unable to validate Superpowers package");
  }
}

export function getSuperpowersState(): SuperpowersState {
  return superpowersState;
}

export function resetSuperpowersStateForTests(): void {
  superpowersState = { status: "inactive" };
}
