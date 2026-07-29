import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";

const STOCK_BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for pi";
const SKILL_NAMES = [
  "using-superpowers",
  "test-driven-development",
  "verification-before-completion",
] as const;

type StockSkillName = (typeof SKILL_NAMES)[number];

export interface StockSuperpowersFixtureOptions {
  version?: string;
  source?: string;
  omitSkill?: StockSkillName;
  bootstrapMarker?: boolean;
}

export interface StockSuperpowersFixture {
  root: string;
  skills: Skill[];
  cleanup: () => void;
}

export function createStockSuperpowersFixture(
  options?: StockSuperpowersFixtureOptions,
): StockSuperpowersFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stock-superpowers-"));
  const source = options?.source ?? "git:github.com/obra/superpowers";

  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "superpowers", version: options?.version ?? "6.2.0" }),
  );

  const extensionPath = path.join(root, ".pi", "extensions", "superpowers.ts");
  fs.mkdirSync(path.dirname(extensionPath), { recursive: true });
  fs.writeFileSync(
    extensionPath,
    options?.bootstrapMarker === false
      ? "// Stock extension without its marker\n"
      : `// ${STOCK_BOOTSTRAP_MARKER}\n`,
  );

  const skills = SKILL_NAMES.filter((name) => name !== options?.omitSkill).map((name) => {
    const filePath = path.join(root, "skills", name, "SKILL.md");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      `---\nname: ${name}\ndescription: Stock ${name} skill\n---\n`,
    );

    return {
      name,
      description: `Stock ${name} skill`,
      filePath,
      baseDir: root,
      sourceInfo: {
        path: filePath,
        source,
        scope: "user",
        origin: "package",
        baseDir: root,
      },
      disableModelInvocation: false,
    } satisfies Skill;
  });

  return {
    root,
    skills,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
