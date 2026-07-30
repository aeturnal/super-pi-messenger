# Integration Fixture Codex Models Design

**Date:** 2026-07-30
**Status:** Approved design awaiting written-spec review

## Context

The fresh active acceptance run reached an active Superpowers 6.2 state and launched `task-1`, but the worker exited before acting. Its trace recorded `anthropic/claude-haiku-4-5` and `401 Invalid bearer token`. Crew correctly returned the task to available. This was an acceptance-environment authentication mismatch, not a Crew or Superpowers behavior failure.

The integration fixture currently omits Crew model overrides, so it inherits package agent defaults: Anthropic Haiku for workers and Anthropic Opus for reviewers. The supervised environment is authenticated for OpenAI Codex, and the user selected the Codex route rather than adding Anthropic credentials.

## Decision

Pin models only in the existing integration fixture Crew config:

```json
"models": {
  "worker": "openai-codex/gpt-5.6-terra",
  "reviewer": "openai-codex/gpt-5.6-sol"
}
```

`gpt-5.6-terra` is the worker model and `gpt-5.6-sol` is the reviewer model, matching models already available in the supervised environment and the repository's existing Codex evaluation profile. No runtime default, model router, provider registry, environment-variable override, fallback, or configuration subsystem is added.

## Files and behavior

- `evals/fixtures/integration-mvp/seed/.pi/messenger/crew/config.json` gains the two fixed model mappings.
- `tests/evals/integration-mvp.test.ts` extends the existing preseed contract test to assert both literal mappings before the fixture change is made.
- `evals/README.md` states that active acceptance requires authentication for the two pinned OpenAI Codex models.

Reset tooling already copies and commits the checked seed deterministically, so it requires no change. Verifier hash anchoring already derives from the checked seed, so it also requires no model-specific change.

## Testing and acceptance

Implementation uses one small RED/GREEN cycle: first add the two fixture assertions and observe failure because `config.models` is absent; then add the mappings and observe the focused test pass. Run the full deterministic suite, TypeScript, and diff checks before resetting.

The failed Anthropic-authentication run is not release evidence. After the correction, reset from the updated seed and repeat active acceptance from the beginning. `crew.status` must show active Superpowers before `work`; the worker and reviewer traces must show the pinned Codex models and satisfy the existing deterministic and human evidence gates.

## Scope boundary

This is fixture-only model pinning plus its acceptance note. It does not modify production Crew model selection, stock Superpowers, credentials, provider handling, task behavior, or the experimental Phase 1A worktree.
