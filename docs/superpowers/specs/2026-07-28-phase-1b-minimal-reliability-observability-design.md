# Phase 1B Minimal Reliability and Observability Design

**Date:** 2026-07-28
**Status:** Approved design awaiting written-spec review

## Scope and non-goals

Phase 1B adds the smallest durable reliability/observability layer on the Phase 1A controller: deterministic classification, durable pauses and manually initiated recovery, bounded diagnostics, explicit process metadata, and bounded parent memory. Artifacts are off by default.

It does **not** add generalized crash recovery, automatic recovery, saved-session resume, a large UI, provider/model evaluation, Phase 2 task/integration-review redesign, or a complete-output/chunk retrieval API. Completion is never inferred from process exit, commits, or tests.

## Pause model and canonical quota embargo

Task status adds `paused`. This requires a schema migration. Old binaries may parse the JSON but are not supported to operate on active Phase 1B `paused` or Phase 1A review statuses; updated readers render them explicitly and fail closed for unknown active lifecycle versions.

Pause records exist only for `quota_exhausted`, `protocol_incomplete`, and explicitly requested resumable cancellation. Authentication, configuration, crash/unknown, malformed recovery input, and reviewer failures are `blocked`. Ordinary user stop remains Phase 1A cancellation (`todo`, cancellation progress, no record).

There is exactly one canonical quota pause slot per `planRunId`, with stable derived key `quota:${planRunId}` (and deterministic `pauseId` derived from that key). Under the plan-level exclusive lock/CAS, creation and migration merge all affected task IDs into the active generation; a second applicable quota record cannot be created. The lock also serializes quota recovery claims. If a later quota event occurs after a prior generation reached `completed` or `abandoned` in the same `planRunId`, the slot is reinitialized atomically with `generation + 1`: affected IDs/classification/fingerprint/timestamps are replaced for the new event and every prior claim owner, token, expiry, PID, readiness, release, and operation-result field is cleared before the embargo is applied. A successful generation resets only that generation's quota fingerprint; a later quota event creates a new fingerprint/generation rather than reusing stale success state. Protocol and resumable-cancellation records remain per-attempt/task and use independent IDs.

The canonical quota record applies a plan-wide launch embargo and changes the scheduler to `paused`. Its `affectedTaskIds` is a sorted deduplicated set and may be empty for plan-scoped quota detection. The sole embargo exception is its one claimed recovery operation. Embargo clears only when this canonical record is `completed` after its defined safe success action, or is explicitly `abandoned` by a safe administrative action; before clearing, the same lock verifies that no other applicable quota record exists. Replan/deletion invalidates the plan/embargo. Restart reloads the canonical uncompleted record before dispatch. Corrupt records fail closed as inspectable `blocked` records.

A protocol/resumable-cancellation pause applies only to its task; independently eligible work may continue. It clears only on successful recovery launch, explicit safe abandonment, or replan/deletion.

## Durable records, recovery barrier, and reconciliation

Records are bounded, versioned JSON with allowlisted fields only:

```text
{
  schemaVersion, pauseId, planRunId, taskId?, attemptId?, classification,
  sanitizedReasonKey, fingerprint, role, attemptKind, workspaceIdentity,
  affectedTaskIds?, taskEvidenceRef?, reservationFacts?, timestamps,
  state, recoveryToken?, claimOwner?, claimExpiresAt?, readyPid?, launchedPid?,
  releaseSent?, operationResult?
}
```

They never contain credentials, headers, cookies, provider request bodies, opaque messages, or model reasoning. Lifecycle is `paused | claiming | launched | completed | abandoned`. `completed` means the record's declared operation succeeded, not merely that a process ended.

`pi_messenger({ action: "recover", pauseId })` is the only recovery API; it accepts no task ID and never runs automatically. Under the record/plan lock it CASes `paused -> claiming`, writes a cryptographically random `recoveryToken`, and validates record/workspace before reacquiring reservations. A competing caller observes the claim and launches nothing.

A recovery child is spawned **dormant** with the normal validated role/attempt/provider metadata environment plus its `recoveryToken`; the token is its only assignment/authority payload. Before release it may register readiness and perform no task, provider, or validation work. The parent waits for readiness, then atomically persists `readyPid`, `launchedPid`, token, `state: launched`, and `releaseSent: false` while still holding the claim. Only then does it send one assignment/validation release message and atomically marks `releaseSent: true`. The child deduplicates releases by token.

Crash boundaries are defined as follows:

| Boundary | Reconciliation result |
|---|---|
| before child spawn | stale/dead `claiming` returns to `paused` |
| child spawned, before ready registration | dormant child times out/exits without work; record returns to `paused` once absent |
| ready registered, before durable launched write | child times out/exits without work; claim returns to `paused` |
| launched write, before release | live dormant child is retained; if `releaseSent: false`, reconciliation sends exactly one token-matched release; if absent, return to `paused` |
| release sent, before result | live child remains launched; absent child reconciles from durable result or returns to `paused` |
| result persisted, before final transition | reducer completes only the persisted successful operation; otherwise pauses/fails closed |

For taskful recovery, validation/reservation/launch failure rolls the same record back to `paused` and releases newly acquired reservations; it never implicitly becomes launched. A missing `launched` taskful process is `completed` only when durable task state is terminal, otherwise `paused`. This bounded state machine is not generalized process-crash recovery.

A taskless quota recovery is exactly one plan-scoped provider-validation operation. It has role `analyst`, attempt kind `recovery`, and no task ID. Its record persists `operationResult: { status: "success" | "failure", evidence: sanitized-allowlisted }`. It becomes `completed` only when validation persisted `success` and the canonical embargo is atomically cleared. A failure leaves/reverts it to `paused` with sanitized evidence. If the taskless process is missing, reconciliation uses `operationResult`; an absent result returns it to `paused`. It never treats task/plan terminal state as taskless validation success and cannot fan out work before success.

## Workspace identity

Each record captures repository `HEAD`, branch, Git index hash, tracked-diff hash, and a manifest of changed/untracked regular files. Entries contain normalized relative path, type, byte length, and SHA-256, bounded to 100 files, 256 KiB/file, and 10 MiB total. Bound overflow writes `workspaceOverflow: true` and `manualValidationRequired: true`; recovery rejects it rather than accepting a partial manifest.

Recovery recomputes and compares every identity component plus retained unfinished-file ownership. Absolute paths, `..`, devices, and symlinks are rejected; symlinks are never followed/hashed. Records retain safe relative paths and hashes only.

## Failure classifier, retries, and fingerprints

All input is sanitized and bounded into:

```text
{
  explicitCancellation: boolean,
  provider: { category?: string, code?: string, httpStatus?: number, retryAfter?: string },
  protocolIncomplete: boolean,
  process: { exitCode?: number | null, signal?: string },
  fallbackMessage?: string, taskId?: string, planRunId: string
}
```

Precedence is exact:

1. `explicitCancellation` maps to `cancelled`.
2. Exact structured category maps first: `quota -> quota_exhausted`, `auth -> authentication`, `rate -> rate_limited`, `config -> configuration`.
3. If category is absent/unmapped, exact structured code maps: quota codes `insufficient_quota`, `quota_exceeded`, `billing_hard_limit_reached`, `credit_balance_exhausted`; auth codes `invalid_api_key`, `authentication_error`, `unauthorized`, `permission_denied`; rate codes `rate_limit_exceeded`, `rate_limited`, `too_many_requests`; config codes `model_not_found`, `invalid_model`, `provider_not_configured`, `invalid_provider_configuration`.
4. If neither maps, HTTP `401 -> authentication`, `402 -> quota_exhausted`, `429 -> rate_limited`; `403` without a mapped code/category is `crash_or_unknown`/blocked.
5. If still unmapped, anchored case-insensitive fallback patterns map only the exact code/phrase shown below, optionally followed by one bounded (at most 128 non-newline bytes) punctuation-delimited suffix. Generic words such as `quota` or `auth` alone never match.
6. Only after provider/category/code/status/fallback mapping, `protocolIncomplete -> protocol_incomplete`; otherwise every remaining input is `crash_or_unknown`.

The classifier always emits and persists one exact reason key, never raw text:

| Winning input | Classification | Reason key |
|---|---|---|
| explicit cancellation | `cancelled` | `explicit_cancellation` |
| structured category `quota|auth|rate|config` | corresponding category | `category_quota|category_auth|category_rate|category_config` |
| structured mapped code | corresponding category | `code_<exact_code>` |
| HTTP 401, 402, or 429 | authentication, quota, or rate | `http_401|http_402|http_429` |
| fallback quota/auth/rate/config pattern | corresponding category | `fallback_quota|fallback_auth|fallback_rate|fallback_config` |
| protocol flag | `protocol_incomplete` | `protocol_incomplete` |
| every remaining/process outcome | `crash_or_unknown` | `crash_or_unknown` |

Each fallback mapping uses this anchored pattern form, substituting one listed alternative: `^(?:ALTERNATIVES)(?:\s*[:;,.()\-]\s*[^\r\n]{0,128})?$`.

| Fallback reason key | Exact alternatives |
|---|---|
| `fallback_quota` | `insufficient_quota`, `insufficient quota`, `quota_exceeded`, `quota exceeded`, `billing_hard_limit_reached`, `billing hard limit reached`, `credit_balance_exhausted`, `credit balance exhausted` |
| `fallback_auth` | `invalid_api_key`, `invalid api key`, `authentication_error`, `authentication error`, `unauthorized`, `permission_denied`, `permission denied` |
| `fallback_rate` | `rate_limit_exceeded`, `rate limit exceeded`, `rate_limited`, `rate limited`, `too_many_requests`, `too many requests` |
| `fallback_config` | `model_not_found`, `model not found`, `invalid_model`, `invalid model`, `provider_not_configured`, `provider not configured`, `invalid_provider_configuration`, `invalid provider configuration` |

Examples: explicit cancellation wins over all inputs; `429 + insufficient_quota` is quota because structured code precedes status; `401 + rate_limit_exceeded` is rate for the same reason; protocol is considered only after provider/status mapping. The classifier is pure and emits its reason key.

Fingerprints contain classification, sanitized allowlisted provider/code/status, reason key, `planRunId`, optional task ID, and configuration generation. They reset only after explicit successful recovery, new `run_id`, or material classifier/configuration change. Equal fingerprints cannot relaunch work.

`Retry-After` accepts one nonnegative integer delta seconds or one IMF-fixdate. A fake clock clamps past dates to zero. Multiple values, negatives, fractions, malformed dates, and values over five minutes are invalid. `rate_limited` retries once at most and only with valid guidance no greater than `maxRetryAfterMs: 300000`; otherwise it blocks. Quota pauses plan-wide; protocol pauses task-scoped; cancellation follows its explicit resumable rule.

## Artifacts, privacy, cleanup, and parent memory

Artifacts are optional diagnostics, never complete-output storage or retrieval. `crew.artifacts` defaults are:

```text
mode: off
maxBytesPerRun: 10 MiB
maxTotalBytes: 100 MiB
cleanupDays: 7
storage: user
```

`mode` is `off | compact | raw`. `compact` uses this closed schema only: `schemaVersion`, diagnostic `runId`, `planRunId`, optional `taskId`/`attemptId`, validated role/attempt/provider values, event type, timestamp, optional duration milliseconds, optional exit code/signal enum, optional bounded tool name, byte/event/token counts, classifier classification/reason key, cap flags, and safe record ID. Allowed event types are `process.start`, `tool.start`, `tool.end`, `process.error`, `process.end`, `artifact.cap_reached`, and `memory.cap_reached`. IDs are at most 128 ASCII `[A-Za-z0-9._:-]` characters; tool names/reason keys are at most 64 characters from their validated enums/patterns; numeric counters are finite nonnegative safe integers; timestamps are normalized ISO-8601. Unknown keys are dropped before persistence, control characters are rejected, and no message text, command arguments, tool input/output, provider body/header, URL, credential, reasoning, or arbitrary filesystem path is copied. Redaction means omission of every field outside this allowlist, not best-effort mutation of opaque strings. `raw` alone may contain opaque user/provider output and requires explicit opt-in plus a warning that it may contain credentials/sensitive content. Legacy `artifacts.enabled: true` migrates to `raw` with warning; `false` to `off`. Storage is Pi user-data, not repository storage/scanning.

Validate `maxBytesPerRun` from 1 MiB through 1 GiB, `maxTotalBytes >= maxBytesPerRun` and at most 10 GiB, and `cleanupDays` 1..365; zero is valid only with `off`. Accounting is atomic under a cross-process total lock. Cleanup may evict only oldest retained records past retention whose related task is terminal and, when review is enabled, whose durable legacy review state is terminal (`ship`, `needs_work`, `major_rethink`, or `failed` as applicable to the final task state). Active, paused, `review_pending`, and `claiming` records are never eligible. If capacity cannot be made, recording stops with `artifact.cap_reached`; it never deletes ineligible references.

Parent reducer configuration is deliberately separate under `crew.memory`:

```text
maxParentMessageBytes: 1 MiB  # valid 64 KiB..16 MiB
maxParentEvents: 1000         # valid 100..10000
```

The reducer replaces accumulated message snapshots rather than appending them, retains bounded allowlisted metadata/events/errors/final status, and is independent of snapshot count. It truncates retained in-memory display state explicitly at the byte cap, emits `memory.cap_reached`, and preserves only an already-existing safe output reference when one exists; it creates no new retrieval API/reference. It does not promise complete output preservation.

User-data artifact/pause directories are `0700`; files are `0600`. Metadata is allowlisted/redacted. Only raw may hold opaque content.

## Explicit process metadata

Every Crew process validates metadata before spawn. Roles are `planner | worker | reviewer | analyst | integration-reviewer`; attempt kinds are `initial | repair | replan | review | rereview | integration | retry | recovery`. `PI_CREW_ROLE`, `PI_CREW_ATTEMPT_KIND`, and `PI_CREW_POLICY_PROVIDER` are required.

`PI_CREW_POLICY_PROVIDER` is exactly `none`, `superpowers`, or `custom:<id>`, where `<id>` matches `[a-z0-9][a-z0-9._-]{0,63}`. An absent legacy/current provider maps to `none`; the built-in Superpowers provider maps to `superpowers`; another configured provider maps to bounded valid `custom:<id>` or launch fails. This is a bounded union/pattern contract, not an enum claim for arbitrary IDs.

`PI_CREW_TASK_ID` is required only for task-scoped recovery and task-scoped worker/reviewer/analyst work. It is absent for planner, plan/integration review, and the taskless plan-scoped quota analyst recovery. Invalid combinations fail before launch.

The following matrix is exhaustive; every role/scope and attempt combination not listed fails before spawn. The canonical quota record and its taskless analyst recovery omit `taskId`.

| Role/scope | Task ID | Allowed attempt kinds |
|---|---|---|
| planner | absent | initial, replan |
| worker task work | required | initial, repair, retry, recovery |
| reviewer task work | required | review, rereview |
| reviewer plan work | absent | review, rereview |
| analyst task work | required | initial, repair, recovery |
| analyst taskless quota recovery | absent | recovery |
| integration-reviewer | absent | integration, review, rereview |

## Acceptance, rollout, and limits

Tests use fake clocks and no sleeps. They cover canonical plan quota creation/merge/reinitialization after terminal generations with stale token/PID/result fields cleared, cross-record concurrency and embargo clearing; every dormant-child spawn-barrier crash boundary while validated metadata remains present; taskless operation-result reconciliation; the full input-to-classification/reason-key table and precedence conflicts; the exhaustive metadata/provider matrix including taskless quota omission; pause/restart/recovery CAS and reservation rollback; workspace validation; review-pending/claiming artifact retention including fake-clock cleanup; the closed compact schema and raw privacy warning; exact reducer cap and cap+1 behavior plus snapshot-count independence; artifact accounting/permissions; and corruption fail-closed behavior.

Implement serially: schema/config/migrations/reducer; metadata validator; pure classifier; pause writing/reservation release; recovery barrier/workspace validation; scheduler integration; deterministic regression and review. The bounded pause state machine is not generalized crash recovery; workspace overflow requires manual validation; artifact caps may stop diagnostics but never remove protected records; Phase 2 owns review redesign.
