# Pi Super Messenger Document Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved Pi Super Messenger naming hierarchy to the PRD and supporting efficiency design without renaming Crew or technical upstream pi-messenger references.

**Architecture:** Make narrowly targeted prose replacements in the two existing untracked documents. Treat Pi Super Messenger as the product, Super Messenger as an optional contextual short name, Crew as the orchestration feature, and `pi-messenger` as the upstream/package/source term. Validate each document immediately after editing and finish with a cross-document naming and structural scan.

**Tech Stack:** Markdown, ripgrep, Python 3 structural checks, Git status inspection.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-27-pi-super-messenger-naming-design.md` exactly.
- Use **Pi Super Messenger** for the formal product name.
- Keep **Crew** as the orchestration feature name.
- Keep `pi-messenger` for upstream lineage, package/configuration/API names, inherited behavior, and source paths.
- State that the product is independently maintained and is not affiliated with or endorsed by Obra.
- Keep stock Obra Superpowers separately installed and unmodified.
- Do not alter technical requirements, architecture, requirement IDs, section ordering, commands, paths, keys, or code examples.
- Do not resolve unrelated contradictions in the older efficiency design as part of this naming-only change.
- Perform a full-document contradiction scan after every PRD change.
- Preserve the pre-existing untracked status of `PRD.md` and `docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md`; do not commit them without a separate integration decision.

---

### Task 1: Rename the product in the approved PRD

**Files:**
- Modify: `PRD.md`
- Reference: `docs/superpowers/specs/2026-07-27-pi-super-messenger-naming-design.md`

**Interfaces:**
- Consumes: Approved naming hierarchy and the existing PRD structure.
- Produces: A PRD whose formal product identity is Pi Super Messenger while Crew and upstream pi-messenger terminology remain intact.

- [x] **Step 1: Capture the pre-edit PRD structure**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
import re
text = Path('PRD.md').read_text()
sections = re.findall(r'^## (\d+)\. ', text, re.M)
requirements = re.findall(r'^### (FR-[A-Z]+-\d+)$', text, re.M)
print(f'sections={len(sections)} first={sections[0]} last={sections[-1]}')
print(f'requirements={len(requirements)} unique={len(set(requirements))}')
print(f'code_fences={text.count("```")}')
PY
```

Expected: `sections=23 first=1 last=23`, `requirements=100 unique=100`, and `code_fences=6`.

- [x] **Step 2: Apply the five product-level replacements**

Make these exact semantic changes:

```markdown
# Product Requirements Document: Pi Super Messenger

**Product name:** Pi Super Messenger  
```

Replace the opening product sentence with:

```markdown
Pi Super Messenger is an independently maintained, focused fork of `nicobailon/pi-messenger` that combines pi-messenger's multi-agent execution machinery with engineering methodologies supplied by the separately installed stock Obra Superpowers package. Pi Super Messenger is not affiliated with or endorsed by Obra.
```

Change the release-readiness sentence to:

```markdown
Pi Super Messenger may be called an initial usable release when:
```

Change the conclusion opening to:

```markdown
Pi Super Messenger will not attempt to merge two complete orchestration systems. It will preserve pi-messenger as the multi-agent execution substrate, preserve Superpowers as an independently updated methodology source, and connect them through an always-active compatibility layer backed by deterministic review, repair, and failure handling.
```

Do not replace any other use of Crew or pi-messenger.

- [x] **Step 3: Scan the complete PRD for naming contradictions**

Run:

```bash
rg -n -i 'policy-aware|working name|pi super messenger crew' PRD.md
```

Expected: no matches.

Run:

```bash
rg -n 'Pi Super Messenger|\bCrew\b|nicobailon/pi-messenger|not affiliated with or endorsed by Obra' PRD.md
```

Expected: the formal product name appears at all product-level locations, Crew remains present as the feature name, upstream lineage remains explicit, and the non-affiliation statement appears in the summary.

- [x] **Step 4: Re-run the full PRD structural validation**

Run the Step 1 Python command again and compare the literal counts. Also run:

```bash
python3 - <<'PY'
from pathlib import Path
import re
text = Path('PRD.md').read_text()
assert not re.search(r'policy-aware', text, re.I)
assert '# Product Requirements Document: Pi Super Messenger' in text
assert '**Product name:** Pi Super Messenger' in text
assert 'not affiliated with or endorsed by Obra' in text
assert text.count('```') % 2 == 0
assert not re.search(r'\b(TBD|TODO|FIXME|PLACEHOLDER)\b', text, re.I)
print('PRD naming and integrity: PASS')
PY
```

Expected: `PRD naming and integrity: PASS`.

---

### Task 2: Rename the product in the supporting efficiency design

**Files:**
- Modify: `docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md`
- Reference: `docs/superpowers/specs/2026-07-27-pi-super-messenger-naming-design.md`

**Interfaces:**
- Consumes: Approved naming hierarchy and the existing efficiency design.
- Produces: A supporting design that names the product Pi Super Messenger without changing its technical decisions.

- [x] **Step 1: Replace only the three product-level pi-messenger references**

Apply these changes:

```markdown
# Pi Super Messenger Token and Credit Efficiency Design
```

Change the executive-summary opening from “Pi-messenger's defining value” to:

```markdown
Pi Super Messenger's defining value is not merely code generation.
```

Change the decision-summary opening from “The balanced optimization strategy preserves pi-messenger's identity” to:

```markdown
The balanced optimization strategy preserves Pi Super Messenger's identity:
```

Keep every technical reference to Crew and inherited pi-messenger behavior unchanged.

- [x] **Step 2: Validate the complete supporting design**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
import re
path = Path('docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md')
text = path.read_text()
assert text.startswith('# Pi Super Messenger Token and Credit Efficiency Design\n')
assert "Pi Super Messenger's defining value" in text
assert "preserves Pi Super Messenger's identity" in text
assert text.count('```') % 2 == 0
assert not re.search(r'\b(TBD|TODO|FIXME|PLACEHOLDER)\b', text, re.I)
print('Supporting design naming and integrity: PASS')
PY
```

Expected: `Supporting design naming and integrity: PASS`.

Run:

```bash
rg -n -i 'policy-aware|pi super messenger crew' \
  docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md
```

Expected: no matches.

---

### Task 3: Cross-document naming verification and handoff

**Files:**
- Verify: `PRD.md`
- Verify: `docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md`
- Verify: `docs/superpowers/specs/2026-07-27-pi-super-messenger-naming-design.md`

**Interfaces:**
- Consumes: Both renamed documents.
- Produces: Evidence that the naming change is complete, narrow, and ready for a later integration decision.

- [x] **Step 1: Run the cross-document retired-name scan**

Run:

```bash
rg -n -i 'policy-aware crew|policy-aware pi-messenger crew|pi super messenger crew' \
  PRD.md docs/superpowers/specs
```

Expected: matches may occur only in the naming design where the retired names are explicitly documented as terms to replace or avoid. Neither updated target document may contain a match.

- [x] **Step 2: Verify protected terminology remains**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
prd = Path('PRD.md').read_text()
design = Path('docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md').read_text()
assert prd.count('Crew') > 20
assert 'nicobailon/pi-messenger' in prd
assert 'pi-messenger owns orchestration' in prd
assert 'Superpowers supplies engineering discipline' in prd
assert 'Replacing Crew with a single long-running coding agent.' in design
print('Protected terminology: PASS')
PY
```

Expected: `Protected terminology: PASS`.

- [x] **Step 3: Inspect the exact document diff**

Because both target documents were untracked before this change, use targeted occurrence output rather than a Git diff:

```bash
rg -n 'Pi Super Messenger|Product name|not affiliated with or endorsed by Obra' \
  PRD.md docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md
```

Confirm that only the approved product-level locations changed.

- [x] **Step 4: Confirm tracking state was preserved**

Run:

```bash
git status --short -- PRD.md \
  docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md
```

Expected: both files remain `??` (untracked), matching their pre-change state.

- [x] **Step 5: Report the naming-only update**

Report the updated paths, naming hierarchy, validation results, and preserved untracked state. Do not commit the two pre-existing documents without a separate user decision.
