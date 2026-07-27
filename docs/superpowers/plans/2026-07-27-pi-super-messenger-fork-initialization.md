# Pi Super Messenger Fork Initialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `aeturnal/pi-super-messenger` as the authoritative public GitHub fork, safely reconfigure local remotes, commit the approved product documents, and apply the staged public README rename without changing compatibility-sensitive package or runtime names.

**Architecture:** Perform fail-closed local and GitHub preflight checks before any mutation. Create and verify the GitHub fork independently of local Git configuration, then establish an authoritative `origin` and fetch-only `upstream`. Commit approved documentation explicitly, drive the README rename with a permanent branding-boundary test, and push only after complete local verification.

**Tech Stack:** Git, GitHub CLI (`gh`), Bash, Markdown, TypeScript, Vitest, npm, Python 3.

## Global Constraints

- Execute this plan in the existing `/home/dominic/projects/pi-messenger` working tree; do not use a worktree because the approved product documents are pre-existing untracked files in this tree.
- The active GitHub account must be exactly `aeturnal`.
- The public repository must be `aeturnal/pi-super-messenger`, and GitHub must report `nicobailon/pi-messenger` as its parent.
- Local `origin` is authoritative and must use `https://github.com/aeturnal/pi-super-messenger.git` for fetch and push.
- Local `upstream` must fetch from `https://github.com/nicobailon/pi-messenger.git` and must have the literal disabled push URL `DISABLED`.
- Never force-push. Never push to `upstream`.
- Stop before changing local remotes if authentication, repository-name availability, local history, expected untracked files, or baseline tests do not match this plan.
- Use explicit file paths for every `git add` and `git commit`; never use `git add .` or `git add -A`.
- Rename public product and repository identity only.
- Preserve `pi_messenger`, Crew actions, `.pi/messenger`, configuration keys, source directories, TypeScript symbols, the npm package name `pi-messenger`, and the executable `pi-messenger`.
- Do not modify `package.json` during initialization.
- Do not claim that `npm:pi-messenger` installs Pi Super Messenger.
- Describe Pi Super Messenger as independently maintained, based on `nicobailon/pi-messenger`, dependent on separately installed stock Obra Superpowers, and not affiliated with or endorsed by Obra.
- Treat the product as prerelease until the later npm packaging and migration phase is designed and tested.

---

### Task 1: Fail-closed local, GitHub, and baseline preflight

**Files:**
- Verify: `.git/config`
- Verify: `package.json`
- Verify: `PRD.md`
- Verify: `docs/superpowers/plans/2026-07-27-pi-super-messenger-document-rename.md`
- Verify: `docs/superpowers/plans/2026-07-27-pi-super-messenger-fork-initialization.md`
- Verify: `docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md`

**Interfaces:**
- Consumes: Current local repository, GitHub CLI authentication, and existing test suite.
- Produces: `/tmp/pi-super-messenger-preflight.json` and verified evidence that fork creation is safe to attempt.

- [x] **Step 1: Verify local repository identity, history, and tracked-file cleanliness**

Run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger

test "$(git branch --show-current)" = main
test "$(git remote get-url origin)" = 'https://github.com/nicobailon/pi-messenger.git'
test "$(git remote get-url --push origin)" = 'https://github.com/nicobailon/pi-messenger.git'
git diff --quiet
git diff --cached --quiet
git fetch origin main
git merge-base --is-ancestor origin/main HEAD
printf 'HEAD=%s\n' "$(git rev-parse HEAD)"
printf 'origin/main=%s\n' "$(git rev-parse origin/main)"
```

Expected: every assertion succeeds; `HEAD` may be ahead of `origin/main` but must descend from it.

- [x] **Step 2: Verify the untracked-file set is exact**

Run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
python3 - <<'PY'
from pathlib import Path
import subprocess
expected = {
    'PRD.md',
    'docs/superpowers/plans/2026-07-27-pi-super-messenger-document-rename.md',
    'docs/superpowers/plans/2026-07-27-pi-super-messenger-fork-initialization.md',
    'docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md',
}
actual = set(subprocess.check_output(
    ['git', 'ls-files', '--others', '--exclude-standard'], text=True
).splitlines())
assert actual == expected, f'untracked mismatch: expected={sorted(expected)!r} actual={sorted(actual)!r}'
for path in expected:
    assert Path(path).is_file(), path
print('Exact expected untracked files: PASS')
PY
```

Expected: `Exact expected untracked files: PASS`. Stop rather than staging anything if another file appears.

- [x] **Step 3: Verify active GitHub identity and both target names in one authenticated query**

Run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
status=0
gh api graphql -f query='query {
  viewer { login }
  oldName: repository(owner: "aeturnal", name: "pi-messenger") { nameWithOwner }
  target: repository(owner: "aeturnal", name: "pi-super-messenger") { nameWithOwner }
}' > /tmp/pi-super-messenger-preflight.json || status=$?
python3 - "$status" <<'PY'
import json
from pathlib import Path
import sys
status = int(sys.argv[1])
response = json.loads(Path('/tmp/pi-super-messenger-preflight.json').read_text())
payload = response['data']
assert payload['viewer']['login'] == 'aeturnal', response
assert payload['oldName'] is None, 'aeturnal/pi-messenger already exists; stop for inspection'
assert payload['target'] is None, 'aeturnal/pi-super-messenger already exists; stop for inspection'
errors = response.get('errors', [])
assert status != 0, 'expected missing-repository GraphQL fields to produce NOT_FOUND errors'
assert {tuple(error.get('path', [])) for error in errors} == {('oldName',), ('target',)}, errors
assert all(error.get('type') == 'NOT_FOUND' for error in errors), errors
print('GitHub identity and repository-name availability: PASS')
PY
```

Expected: `GitHub identity and repository-name availability: PASS`. Any existing repository stops execution because GitHub permits only one personal fork per repository network.

- [x] **Step 4: Run the baseline test suite before creating an external repository**

Run:

```bash
cd /home/dominic/projects/pi-messenger
npm test
```

Expected: Vitest exits 0 with every existing test passing. Stop before fork creation on any failure.

---

### Task 2: Create and verify the public GitHub fork

**Files:**
- No local files modified.

**Interfaces:**
- Consumes: Successful Task 1 preflight.
- Produces: Public GitHub repository `aeturnal/pi-super-messenger` with parent `nicobailon/pi-messenger`.

- [x] **Step 1: Create the named fork without cloning or changing local remotes**

Run:

```bash
set -euo pipefail
gh repo fork nicobailon/pi-messenger \
  --fork-name pi-super-messenger \
  --clone=false \
  --remote=false
```

Expected: GitHub reports successful fork creation. If it reports that a fork or name already exists, stop and inspect rather than adopting or deleting anything.

- [x] **Step 2: Wait for GitHub to expose and hydrate the verified fork relationship**

Run:

```bash
set -euo pipefail
verified=''
for attempt in $(seq 1 60); do
  if payload=$(gh api repos/aeturnal/pi-super-messenger 2>/dev/null); then
    if python3 -c 'import json,sys; p=json.load(sys.stdin); assert p["fork"] is True; assert p["parent"]["full_name"] == "nicobailon/pi-messenger"; assert p["visibility"] == "public"' <<<"$payload"; then
      verified=yes
      break
    fi
  fi
  sleep 2
done
test "$verified" = yes
echo 'Public GitHub fork relationship: PASS'
```

Expected within 120 seconds: `Public GitHub fork relationship: PASS`.

- [x] **Step 3: Confirm fork creation did not mutate the local remote**

Run:

```bash
cd /home/dominic/projects/pi-messenger
test "$(git remote get-url origin)" = 'https://github.com/nicobailon/pi-messenger.git'
test "$(git remote)" = origin
echo 'Local remotes remain unchanged: PASS'
```

Expected: `Local remotes remain unchanged: PASS`.

---

### Task 3: Establish authoritative origin and fetch-only upstream

**Files:**
- Modify: `.git/config` through `git remote` commands only

**Interfaces:**
- Consumes: Verified GitHub fork from Task 2.
- Produces: Local `origin` pointing to `aeturnal/pi-super-messenger` and `upstream` with a disabled push URL.

- [x] **Step 1: Rename the inherited remote and disable its push URL**

Run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
git remote rename origin upstream
git remote set-url --push upstream DISABLED
```

Expected: both commands exit 0.

- [x] **Step 2: Add the new authoritative origin**

Run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
git remote add origin https://github.com/aeturnal/pi-super-messenger.git
```

Expected: command exits 0.

- [x] **Step 3: Verify every remote direction before any push**

Run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
test "$(git remote get-url origin)" = 'https://github.com/aeturnal/pi-super-messenger.git'
test "$(git remote get-url --push origin)" = 'https://github.com/aeturnal/pi-super-messenger.git'
test "$(git remote get-url upstream)" = 'https://github.com/nicobailon/pi-messenger.git'
test "$(git remote get-url --push upstream)" = 'DISABLED'
test "$(git remote | sort | tr '\n' ' ')" = 'origin upstream '
git fetch upstream main
git fetch origin main
git merge-base --is-ancestor upstream/main HEAD
printf 'origin fetch: %s\n' "$(git remote get-url origin)"
printf 'origin push:  %s\n' "$(git remote get-url --push origin)"
printf 'upstream fetch: %s\n' "$(git remote get-url upstream)"
printf 'upstream push:  %s\n' "$(git remote get-url --push upstream)"
```

Expected: URLs print exactly as specified and history still descends from `upstream/main`.

---

### Task 4: Commit approved product documents and this implementation plan

**Files:**
- Add: `PRD.md`
- Add: `docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md`
- Add: `docs/superpowers/plans/2026-07-27-pi-super-messenger-document-rename.md`
- Add: `docs/superpowers/plans/2026-07-27-pi-super-messenger-fork-initialization.md`

**Interfaces:**
- Consumes: Approved documents and the safe remote topology.
- Produces: Two local documentation commits; no push yet.

- [x] **Step 1: Revalidate the approved PRD and supporting design before staging**

Run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
python3 - <<'PY'
from pathlib import Path
import re
prd = Path('PRD.md').read_text()
design = Path('docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md').read_text()
sections = re.findall(r'^## (\d+)\. ', prd, re.M)
requirements = re.findall(r'^### (FR-[A-Z]+-\d+)$', prd, re.M)
assert sections == [str(i) for i in range(1, 24)]
assert len(requirements) == 100 == len(set(requirements))
assert prd.startswith('# Product Requirements Document: Pi Super Messenger\n')
assert 'not affiliated with or endorsed by Obra' in prd
assert not re.search(r'policy-aware|working name|pi super messenger crew', prd, re.I)
assert prd.count('```') == 6
assert design.startswith('# Pi Super Messenger Token and Credit Efficiency Design\n')
assert design.count('Pi Super Messenger') == 3
assert not re.search(r'policy-aware|pi super messenger crew', design, re.I)
assert design.count('```') % 2 == 0
print('Approved product documents: PASS')
PY
```

Expected: `Approved product documents: PASS`.

- [x] **Step 2: Commit the approved requirements, supporting design, and completed rename plan**

Run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
git add -- \
  PRD.md \
  docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md \
  docs/superpowers/plans/2026-07-27-pi-super-messenger-document-rename.md
python3 - <<'PY'
from pathlib import Path
paths = [
    Path('PRD.md'),
    Path('docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md'),
    Path('docs/superpowers/plans/2026-07-27-pi-super-messenger-document-rename.md'),
]
for path in paths:
    for number, line in enumerate(path.read_text().splitlines(), 1):
        trailing = len(line) - len(line.rstrip(' \t'))
        if trailing:
            assert line.endswith('  ') and not line.endswith('   ') and not line.endswith('\t'), (
                f'{path}:{number}: invalid trailing whitespace'
            )
print('Markdown-aware whitespace check: PASS')
PY
git commit -m 'docs: add Pi Super Messenger product requirements' -- \
  PRD.md \
  docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md \
  docs/superpowers/plans/2026-07-27-pi-super-messenger-document-rename.md
```

Expected: one commit containing exactly the three paths.

- [x] **Step 3: Commit this fork-initialization plan separately**

Run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
git add -- docs/superpowers/plans/2026-07-27-pi-super-messenger-fork-initialization.md
git diff --cached --check
git commit -m 'docs: plan Pi Super Messenger fork initialization' -- \
  docs/superpowers/plans/2026-07-27-pi-super-messenger-fork-initialization.md
```

Expected: one commit containing only this implementation plan. Later checkbox updates remain local until the completion-record commit.

---

### Task 5: Apply the public README identity with a tested compatibility boundary

**Files:**
- Create: `tests/readme-branding.test.ts`
- Modify: `README.md:1-40`
- Modify: `README.md:332-347`
- Verify unchanged: `package.json`

**Interfaces:**
- Consumes: Approved naming and staged-rename designs.
- Produces: Branded prerelease README and a Vitest guard against product/package identity regression.

- [ ] **Step 1: Write the failing branding-boundary test**

Create `tests/readme-branding.test.ts` with:

```typescript
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  name: string;
  bin: Record<string, string>;
  repository: { url: string };
};

describe("Pi Super Messenger public identity", () => {
  it("states the product, lineage, prerelease status, and independence", () => {
    expect(readme).toContain("# Pi Super Messenger");
    expect(readme).toContain("independently maintained prerelease fork");
    expect(readme).toContain("nicobailon/pi-messenger");
    expect(readme).toContain("separately installed stock Obra Superpowers");
    expect(readme).toContain("not affiliated with or endorsed by Obra");
  });

  it("installs the development product from its GitHub fork, not upstream npm", () => {
    expect(readme).toContain(
      "pi install git:github.com/aeturnal/pi-super-messenger",
    );
    expect(readme).not.toContain("pi install npm:pi-messenger");
    expect(readme).not.toContain("shields.io/npm/v/pi-messenger");
  });

  it("preserves compatibility-sensitive technical names", () => {
    expect(readme).toContain("pi_messenger");
    expect(readme).toContain("npx pi-messenger --crew-install");
    expect(readme).toContain(".pi/messenger");
    expect(packageJson.name).toBe("pi-messenger");
    expect(packageJson.bin).toEqual({ "pi-messenger": "install.mjs" });
    expect(packageJson.repository.url).toBe(
      "git+https://github.com/nicobailon/pi-messenger.git",
    );
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd /home/dominic/projects/pi-messenger
npx vitest run tests/readme-branding.test.ts
```

Expected: FAIL because the current README starts with `# Pi Messenger`, lacks the approved independence text, and still recommends `pi install npm:pi-messenger`.

- [ ] **Step 3: Replace the README product header and installation section**

Replace README lines 1 through the paragraph immediately before “To show available crew agents” with:

````markdown
<p>
  <img src="https://raw.githubusercontent.com/aeturnal/pi-super-messenger/main/banner.png" alt="Pi Super Messenger" width="1100">
</p>

# Pi Super Messenger

**Multi-agent orchestration for Pi, powered by Superpowers.**

> **Prerelease:** Pi Super Messenger is an independently maintained prerelease fork of [`nicobailon/pi-messenger`](https://github.com/nicobailon/pi-messenger). It is being developed to combine pi-messenger's multi-agent coordination foundation with the separately installed stock Obra Superpowers methodology. Pi Super Messenger is not affiliated with or endorsed by Obra.

Join agents across terminals, see who is online, reserve files, exchange messages, and orchestrate Crew work through planning, dependency-aware execution, review, and repair. No daemon or server is required; coordination remains file-based.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux-blue?style=for-the-badge)]()

## Development Installation

Pi Super Messenger is not yet published as an npm package. Install the current development version directly from its GitHub fork:

```bash
pi install git:github.com/aeturnal/pi-super-messenger
```

Superpowers remains a separate stock installation and source of truth. The packaged integration described by the product requirements is still under development.

Crew agents ship with the extension (`crew/agents/*.md`) and are discovered automatically. The existing `pi-messenger-crew` skill and technical command names remain available during the compatibility period.
````

Do not change the subsequent `npx pi-messenger` command examples or `.pi/messenger` paths.

- [ ] **Step 4: Update the implementation description and credits without renaming internals**

Change the first sentence under `## How It Works` to:

```markdown
Pi Super Messenger inherits pi-messenger's file-based [Pi extension](https://github.com/badlogic/pi-mono) architecture and compatibility-sensitive technical names.
```

Add these two entries at the start of the Credits list:

```markdown
- **[pi-messenger](https://github.com/nicobailon/pi-messenger)** by [Nico Bailon](https://github.com/nicobailon) — Upstream project and multi-agent coordination foundation
- **[Obra Superpowers](https://github.com/obra/superpowers)** — Separately installed stock engineering-methodology source; Pi Super Messenger is independently maintained and is not affiliated with or endorsed by Obra
```

Keep all existing credit entries.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
cd /home/dominic/projects/pi-messenger
npx vitest run tests/readme-branding.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 6: Verify the package manifest is untouched and commit the README boundary**

Run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
git diff --quiet -- package.json
git diff --check -- README.md tests/readme-branding.test.ts
git add -- README.md tests/readme-branding.test.ts
git commit -m 'docs: establish Pi Super Messenger repository identity' -- \
  README.md tests/readme-branding.test.ts
```

Expected: `package.json` has no diff and the commit contains only README and its branding test.

- [ ] **Step 7: Apply and verify public GitHub repository metadata**

Run:

```bash
set -euo pipefail
gh repo edit aeturnal/pi-super-messenger \
  --description 'Multi-agent orchestration for Pi, powered by Superpowers.' \
  --enable-issues=true \
  --add-topic pi \
  --add-topic pi-package \
  --add-topic pi-coding-agent \
  --add-topic multi-agent \
  --add-topic superpowers

gh api repos/aeturnal/pi-super-messenger --jq '{
  full_name,
  description,
  visibility,
  fork,
  parent: .parent.full_name,
  topics
}'
```

Expected: correct full name and description, public visibility, `fork: true`, parent `nicobailon/pi-messenger`, and all five topics.

---

### Task 6: Run complete local verification and perform the first safe push

**Files:**
- Verify: all tracked files
- Modify: `docs/superpowers/plans/2026-07-27-pi-super-messenger-fork-initialization.md` only through execution checkbox updates

**Interfaces:**
- Consumes: Local documentation and README commits plus verified remotes.
- Produces: Verified `origin/main` tracking relationship and the first pushed Pi Super Messenger history.

- [ ] **Step 1: Run the complete test suite**

Run:

```bash
cd /home/dominic/projects/pi-messenger
npm test
```

Expected: every Vitest test, including the three README branding tests, passes.

- [ ] **Step 2: Verify npm packaging remains structurally valid without publishing**

Run:

```bash
cd /home/dominic/projects/pi-messenger
npm pack --dry-run
```

Expected: command exits 0, reports package `pi-messenger@0.14.1`, and does not publish anything.

- [ ] **Step 3: Run document, naming, and compatibility integrity checks**

Run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
python3 - <<'PY'
from pathlib import Path
import json
import re
prd = Path('PRD.md').read_text()
readme = Path('README.md').read_text()
pkg = json.loads(Path('package.json').read_text())
sections = re.findall(r'^## (\d+)\. ', prd, re.M)
requirements = re.findall(r'^### (FR-[A-Z]+-\d+)$', prd, re.M)
assert sections == [str(i) for i in range(1, 24)]
assert len(requirements) == 100 == len(set(requirements))
assert prd.count('```') == 6
assert not re.search(r'policy-aware|working name|pi super messenger crew', prd, re.I)
assert '# Pi Super Messenger' in readme
assert 'pi install git:github.com/aeturnal/pi-super-messenger' in readme
assert 'pi install npm:pi-messenger' not in readme
assert 'not affiliated with or endorsed by Obra' in readme
assert pkg['name'] == 'pi-messenger'
assert pkg['bin'] == {'pi-messenger': 'install.mjs'}
assert pkg['repository']['url'] == 'git+https://github.com/nicobailon/pi-messenger.git'
print('Document naming and compatibility boundary: PASS')
PY
```

Expected: `Document naming and compatibility boundary: PASS`.

- [ ] **Step 4: Reverify remotes and fork relationship immediately before push**

Run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
test "$(git remote get-url origin)" = 'https://github.com/aeturnal/pi-super-messenger.git'
test "$(git remote get-url --push origin)" = 'https://github.com/aeturnal/pi-super-messenger.git'
test "$(git remote get-url upstream)" = 'https://github.com/nicobailon/pi-messenger.git'
test "$(git remote get-url --push upstream)" = 'DISABLED'
test "$(gh api repos/aeturnal/pi-super-messenger --jq '.parent.full_name')" = 'nicobailon/pi-messenger'
echo 'Pre-push repository safety: PASS'
```

Expected: `Pre-push repository safety: PASS`.

- [ ] **Step 5: Commit accumulated implementation-plan progress before pushing**

After marking Tasks 1 through 5 and Task 6 Steps 1 through 4 complete, run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
git add -- docs/superpowers/plans/2026-07-27-pi-super-messenger-fork-initialization.md
git diff --cached --check
git commit -m 'docs: record fork initialization progress' -- \
  docs/superpowers/plans/2026-07-27-pi-super-messenger-fork-initialization.md
```

Expected: one plan-only progress commit.

- [ ] **Step 6: Push only to the verified authoritative origin**

Run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
test "$(git remote get-url --push origin)" = 'https://github.com/aeturnal/pi-super-messenger.git'
git push --set-upstream origin main
```

Expected: fast-forward push succeeds and local `main` now tracks `origin/main`.

---

### Task 7: Verify remote acceptance and record completion

**Files:**
- Modify: `docs/superpowers/plans/2026-07-27-pi-super-messenger-fork-initialization.md` through final checkbox updates

**Interfaces:**
- Consumes: Pushed `origin/main` from Task 6.
- Produces: Final clean local state and remote completion evidence.

- [ ] **Step 1: Verify local branch tracking and exact remote commit**

Run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
test "$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}')" = 'origin/main'
test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/main | cut -f1)"
test "$(git remote get-url --push upstream)" = 'DISABLED'
echo 'Branch tracking and remote commit: PASS'
```

Expected: `Branch tracking and remote commit: PASS`.

- [ ] **Step 2: Verify GitHub identity, parent, visibility, description, and topics**

Run:

```bash
set -euo pipefail
gh api repos/aeturnal/pi-super-messenger > /tmp/pi-super-messenger-final-repo.json
python3 - <<'PY'
import json
from pathlib import Path
repo = json.loads(Path('/tmp/pi-super-messenger-final-repo.json').read_text())
assert repo['full_name'] == 'aeturnal/pi-super-messenger'
assert repo['visibility'] == 'public'
assert repo['fork'] is True
assert repo['parent']['full_name'] == 'nicobailon/pi-messenger'
assert repo['description'] == 'Multi-agent orchestration for Pi, powered by Superpowers.'
assert {'pi', 'pi-package', 'pi-coding-agent', 'multi-agent', 'superpowers'} <= set(repo['topics'])
print('GitHub repository acceptance: PASS')
PY
```

Expected: `GitHub repository acceptance: PASS`.

- [ ] **Step 3: Verify required documents are present on `origin/main`**

Run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
for path in \
  PRD.md \
  docs/superpowers/specs/2026-07-27-pi-super-messenger-naming-design.md \
  docs/superpowers/specs/2026-07-27-pi-super-messenger-fork-initialization-design.md \
  docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md \
  docs/superpowers/plans/2026-07-27-pi-super-messenger-document-rename.md \
  docs/superpowers/plans/2026-07-27-pi-super-messenger-fork-initialization.md
do
  git cat-file -e "origin/main:$path"
done
echo 'Required origin/main documents: PASS'
```

Expected: `Required origin/main documents: PASS`.

- [ ] **Step 4: Run fresh post-push tests**

Run:

```bash
cd /home/dominic/projects/pi-messenger
npm test
```

Expected: every Vitest test passes from the pushed tree.

- [ ] **Step 5: Mark the plan complete, commit the completion record, and push it to origin**

Mark every remaining checkbox in this plan complete, then run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
if rg -n '^- \[ \]' docs/superpowers/plans/2026-07-27-pi-super-messenger-fork-initialization.md; then
  echo 'Unchecked implementation-plan steps remain' >&2
  exit 1
fi
git add -- docs/superpowers/plans/2026-07-27-pi-super-messenger-fork-initialization.md
git diff --cached --check
git commit -m 'docs: complete fork initialization' -- \
  docs/superpowers/plans/2026-07-27-pi-super-messenger-fork-initialization.md
test "$(git remote get-url --push origin)" = 'https://github.com/aeturnal/pi-super-messenger.git'
git push origin main
```

Expected: a plan-only completion commit is pushed to `origin/main`.

- [ ] **Step 6: Perform final read-only safety and cleanliness verification**

Run:

```bash
set -euo pipefail
cd /home/dominic/projects/pi-messenger
test "$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}')" = 'origin/main'
test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/main | cut -f1)"
test "$(git remote get-url origin)" = 'https://github.com/aeturnal/pi-super-messenger.git'
test "$(git remote get-url --push origin)" = 'https://github.com/aeturnal/pi-super-messenger.git'
test "$(git remote get-url upstream)" = 'https://github.com/nicobailon/pi-messenger.git'
test "$(git remote get-url --push upstream)" = 'DISABLED'
test -z "$(git status --short)"
test "$(gh api repos/aeturnal/pi-super-messenger --jq '.parent.full_name')" = 'nicobailon/pi-messenger'
echo 'Pi Super Messenger fork initialization: PASS'
```

Expected: `Pi Super Messenger fork initialization: PASS` with a clean working tree.
