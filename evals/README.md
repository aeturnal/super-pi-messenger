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

## Superpowers integration MVP acceptance

This is a human-supervised acceptance flow. From the repository root, reset the
fixture, launch Pi from the generated worktree, invoke the two tool calls in Pi,
and then return to the repository root to run deterministic verification:

```bash
node evals/scripts/reset-integration-mvp.mjs
cd evals/runs/integration-mvp/worktree
pi -e /absolute/path/to/super-pi-messenger
# In Pi: run pi_messenger({ action: "crew.status" }), then pi_messenger({ action: "work" }).
cd /absolute/path/to/super-pi-messenger
node evals/scripts/verify-integration-mvp.mjs evals/runs/integration-mvp/worktree
```

The verifier covers repository integrity, committed implementation, final tests, task state, required tool calls, and forbidden calls only. It does not infer tests-first chronology or assess the quality of the reviewer's natural-language verdict. Before cleanup, the human operator inspects the raw worker and reviewer traces and records a separate judgment for each of those two supervised checks. Overall `PASSED` requires the deterministic verifier to pass and both supervised judgments to pass.

For silent inactive acceptance, use a distinct fresh reset and a mode-700 Pi
agent directory outside the repository:

```bash
set -e
repo_root="$(realpath /absolute/path/to/super-pi-messenger)"
inactive_run="$repo_root/evals/runs/integration-mvp/inactive-worktree"
node "$repo_root/evals/scripts/reset-integration-mvp.mjs" "$inactive_run"
inactive_agent_dir="$(mktemp -d /tmp/super-pi-messenger-inactive.XXXXXX)"
trap 'rm -rf -- "$inactive_agent_dir"' EXIT
inactive_agent_dir="$(realpath "$inactive_agent_dir")"
case "$inactive_agent_dir" in
  "$repo_root"|"$repo_root"/*)
    echo "Refusing Pi agent directory under repository root: $inactive_agent_dir" >&2
    exit 1
    ;;
esac
chmod 700 "$inactive_agent_dir"
cd "$inactive_run"
pi_status=0
PI_CODING_AGENT_DIR="$inactive_agent_dir" pi -e /absolute/path/to/super-pi-messenger || pi_status=$?
# After Pi exits, remove the credential-bearing directory now rather than waiting for shell exit.
if ! rm -rf -- "$inactive_agent_dir"; then
  echo "WARNING: cleanup failed; $inactive_agent_dir remains credential-bearing and requires manual removal." >&2
  exit 1
fi
if [ -e "$inactive_agent_dir" ]; then
  echo "WARNING: cleanup failed; $inactive_agent_dir remains credential-bearing and requires manual removal." >&2
  exit 1
fi
trap - EXIT
exit "$pi_status"
```

In Pi, authenticate through its normal interactive flow if needed, then run
`pi_messenger({ action: "crew.status" })` and `pi_messenger({ action: "work" })`.
Never copy credentials or settings from the normal agent directory, and never
place credentials in the repository. Until cleanup succeeds, treat the isolated
directory as credential-bearing. Require silent inactive status, no warning,
and native Crew completion. The live fixture demonstrates access to the unrelated
`project-style` skill; it does not define a project Crew agent override, so the
inactive live run does not directly observe override preservation. Deterministic
`tests/crew/superpowers-launch.test.ts` active, inactive, and fallback regressions
evidence preservation of project agent overrides. Do not expect the deterministic
verifier to pass inactive-trace methodology checks.

The reset and verification scripts never launch Pi or a model. Raw traces stay
ignored under `evals/runs/`; do not commit them. Record only reviewed, sanitized
results in `evals/results/` using
`results/integration-mvp-TEMPLATE.md`. Do not include credentials, provider
secrets, or unsanitized transcripts.
