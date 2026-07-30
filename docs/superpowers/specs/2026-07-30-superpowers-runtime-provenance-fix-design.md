# Superpowers Runtime Provenance Fix Design

**Date:** 2026-07-30
**Status:** Approved design awaiting written-spec review

## Context

The supervised active acceptance run exposed a difference between Pi's package-loading metadata and its live runtime metadata for stock Superpowers 6.2.0. The installed Git package initially identifies its skills with the official package source, but the stock `superpowers.ts` extension republishes the same skill directory through `resources_discover`. In the live `before_agent_start` catalog, the three relevant stock skills therefore have this shape:

```text
source: extension:superpowers
scope: temporary
origin: top-level
baseDir: <checkout>/.pi/extensions
filePath: <checkout>/skills/<skill>/SKILL.md
```

The MVP validator correctly rejects that shape under its existing package-provenance rules, producing fallback for a genuine official installation. This design amends only provenance recognition. It does not change role mappings, prompts, orchestration, warning behavior, persistence, scheduling, or stock Superpowers files.

## Decision

Recognize the exact stock extension-discovery shape as a candidate provenance form, alongside the existing official Pi-package and identifiable local-checkout forms. The string `extension:superpowers` is not trusted by itself.

A runtime-discovered candidate is eligible only when every relevant catalog entry has:

- source exactly `extension:superpowers`;
- scope exactly `temporary`;
- origin exactly `top-level`;
- a canonical source-info base directory equal to `<candidate-root>/.pi/extensions`; and
- a canonical skill path equal to `<candidate-root>/skills/<loaded-name>/SKILL.md`.

All runtime-discovered required skills must resolve beneath one candidate root with no duplicate required names. That root must then pass the existing package-name, supported-major-version, bootstrap-marker, readability, completeness, and canonical-path checks. Because the runtime source no longer carries the official package URL, its Git `origin` must additionally normalize to official `obra/superpowers`, using the same rule as supported local checkouts.

Only entries that satisfy this complete candidate shape are exempt from generic top-level shadow rejection. A project skill, copied directory, forged extension label, malformed base directory, wrong Git origin, duplicate catalog entry, or mixed root remains fallback. Absence remains silent inactive.

## Data flow

`captureSuperpowersSkills()` classifies loaded stock-named skills into three bounded candidate forms:

1. official Pi Git-package metadata;
2. an identifiable official local checkout; or
3. the exact validated stock extension-discovery metadata described above.

It then applies one shared package-root validation path and builds the existing active state. Runtime-discovered candidates use canonical skill paths to derive the root and require official Git-origin verification. Candidate classification completes before shadow detection so that only recognized candidate entries are excluded from the shadow set; unrelated top-level or project entries with required names still force fallback.

No filesystem scan or independent skill discovery is added. Pi's `before_agent_start.systemPromptOptions.skills` remains the authoritative catalog.

## Error handling

The integration continues to fail closed. Any missing field, filesystem error, canonicalization mismatch, unsupported version, missing marker, Git failure, unofficial origin, ambiguity, duplicate, or shadow produces the existing complete fallback behavior. There is no partially active state and no special warning for absence.

## Tests and acceptance

Implementation follows RED-GREEN TDD:

- reproduce the captured live 6.2.0 metadata shape and first observe fallback;
- require that exact shape to activate after the fix;
- reject a forged `extension:superpowers` source with malformed scope, origin, base directory, canonical skill path, or Git origin;
- preserve official package, official local-checkout, shadow, ambiguity, inactive, and fallback regressions; and
- run the focused tests, full suite, type checks, and diff checks before repeating supervised acceptance.

The acceptance documentation also changes bare `status` to `crew.status`, because bare `status` reports messenger mesh presence while integration state belongs to Crew status. Active and silent-inactive acceptance will restart from fresh resets after the fix; the blocked and diagnostic runs are not release evidence.

## Scope boundary

This correction adds no provider registry, configuration, migration, persistence, recovery, scheduler, process manager, or stock-package modification. The temporary diagnostic extension and its raw metadata output remain outside the repository and are removed after verification.
