# Phase 0 evaluation kit

This kit creates reproducible, supervised comparisons. It defines three evals, implements only the independent-parallel fixture in Phase 0, and never launches a model automatically. It is not a benchmark service, telemetry system, or general eval runner.

## Safety and boundaries

- Reset worktrees live under ignored `evals/runs/`; the checked seed is never modified.
- Authentication is never stored under `evals/runs/`, committed results, or fixture material. Do not copy `auth.json`, `models-store.json`, settings, provider secrets, or raw credentials into the repository.
- Stock runtime preparation copies only required credentials into a marked, isolated temporary agent directory outside this repository. Cleanup removes that directory and copied authentication.
- Superpowers stays separately installed. Do not copy its skills, prompts, extensions, or compatibility content into the stock runtime.
- Scripts validate paths and markers before destructive operations. Stop on an unsafe-path, fixture-hash, package, profile, or exact-model mismatch.
- Production preparation and cleanup derive their runtime root from a UID-scoped OS temporary root. `runtimeRoot` injection exists only in the exported test API; this fixed trust boundary supersedes the original example after security review.

## Fixed profile

`profiles/stock-baseline.json` pins `npm:pi-messenger@0.14.1`, four named role models, three workers, one planning pass, one review iteration, normal retry controls, chatty coordination, and disabled artifacts. It is an eval manifest, not directly a `pi-messenger` config: preparation writes its runtime fields below the required `crew` key.

Never silently substitute a model. A deliberate replacement requires a separately named profile and starts a different comparison series.

## Ten-step supervised lifecycle

Run commands explicitly from the repository root:

```sh
node evals/scripts/reset-independent-parallel.mjs [destination-under-evals/runs/independent-parallel]
node evals/scripts/prepare-stock-runtime.mjs [--source-agent-dir PATH]
# Human checkpoint: inspect the printed runtime, fixture, profile identity, and launch command.
# The human, not this tooling, starts the printed Pi command and supervises it.
node evals/scripts/verify-independent-parallel.mjs [worktree]
node evals/scripts/cleanup-stock-runtime.mjs --runtime PATH
```

1. Reset the immutable fixture into ignored run storage.
2. Prepare the isolated stock runtime with the checked profile.
3. Confirm the printed runtime path, package version, profile hash, exact available models, and absence of Superpowers.
4. Launch Pi interactively using the printed command from the reset fixture worktree.
5. Ask the control agent to plan from fixture `PRD.md` with automatic work disabled.
6. Inspect and record the generated three-task decomposition and any deviation.
7. Start autonomous work at concurrency three.
8. Observe task waves, worker overlap, reservations, reviews, retries, interventions, and provider metadata.
9. Run deterministic fixture verification. Raw runtime evidence is inspectable only before cleanup.
10. Complete the durable result, then clean the isolated runtime and confirm copied authentication is removed.

Preparation does not launch a model. It only validates and prints a safely quoted launch command. The printed Pi command begins provider usage, so it is executed only by the human operator after the checkpoint. Do not continue past that checkpoint until the operator separately confirms that the supervised run ended.

The reset command creates a marked Git worktree and manifest. The verifier runs explicit fixture tests and records deterministic test or integrity outcomes. A blocked, quota-limited, interrupted, or failed run is recorded accurately; missing facts are `not observable`.

## Evidence and results

Use `results/TEMPLATE.md` for durable compact evidence. Record deliberately reviewed and sanitized excerpts only after secret review; never record credential contents. The initial stock result is `NOT RUN` until the human-supervised baseline completes.

Cleanup is deletion-only. Cleanup never retains or copies raw runtime evidence. Before cleanup, an operator may manually create a deliberately reviewed and sanitized excerpt under ignored `evals/runs/`. If cleanup fails, treat the reported temporary runtime as credential-bearing until it is removed.

## Eval definitions

- `definitions/independent-parallel.md` fixes the implemented three-utility fixture and deterministic acceptance.
- `definitions/shared-interface.md` fixes the future Phase 2 shared-interface and integration-review evaluation.
- `definitions/review-repair.md` fixes the future Phase 3 review, one scoped repair, and re-review lifecycle.

None of these commands makes a network or model call during tests. `npm test` must remain deterministic and must not invoke Pi or models.
