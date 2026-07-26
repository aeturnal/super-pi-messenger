# Status Heartbeat Render Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent unchanged pi-messenger heartbeat ticks from requesting terminal renders while preserving status changes, stuck detection, and lifecycle behavior.

**Architecture:** Keep the existing 15-second heartbeat and status computation. Add one extension-local cache of the final formatted footer string, emit `ctx.ui.setStatus()` only when that string changes, and reset the cache when leave or shutdown clears the status lifecycle.

**Tech Stack:** TypeScript, Pi extension API, Vitest fake timers, Node.js filesystem test fixtures.

## Global Constraints

- Preserve the 15-second heartbeat cadence.
- Run peer and stuck-agent checks on every heartbeat.
- Preserve immediate status updates from existing events.
- Preserve planning, autonomous work, overlay, messaging, and stale-context behavior.
- Do not modify Pi core or redesign polling/overlay architecture.
- Treat `/home/dominic/projects/pi-messenger` as canonical source and tests.
- Mirror only the verified production delta into `/home/dominic/.pi/agent/npm/node_modules/pi-messenger/index.ts`.

---

## File Structure

- Modify `tests/status-heartbeat.test.ts`: regression coverage for unchanged heartbeat suppression, changed formatted status emission, and leave/rejoin cache reset.
- Modify `index.ts`: extension-local `lastRenderedStatus` cache, guarded status emission, and lifecycle resets.
- Modify `/home/dominic/.pi/agent/npm/node_modules/pi-messenger/index.ts`: mirror the verified production logic into the active v0.14.1 installation; do not copy unrelated upstream changes.

### Task 1: Add and Verify Status Render Deduplication in the Durable Checkout

**Files:**
- Modify: `tests/status-heartbeat.test.ts`
- Modify: `index.ts:230-346, 462-504, 1086-1125`

**Interfaces:**
- Consumes: existing `updateStatus(ctx: ExtensionContext): void`, `ctx.ui.setStatus(key, text)`, the 15-second heartbeat, and action routing through the registered `pi_messenger` tool.
- Produces: extension-local `lastRenderedStatus: string | undefined`; unchanged formatted statuses do not call `setStatus`, changed statuses call it once, and successful leave/shutdown resets the cache.

- [ ] **Step 1: Install the durable checkout's declared dependencies**

Run:

```bash
cd /home/dominic/projects/pi-messenger
npm install --no-package-lock
```

Expected: exit 0 and a usable local Vitest installation without creating a repository lockfile.

- [ ] **Step 2: Add the failing unchanged-heartbeat regression**

Add this test inside `describe("status heartbeat", ...)` in `tests/status-heartbeat.test.ts`:

```ts
it("does not render an unchanged status on heartbeat ticks", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-messenger-cwd-"));
  tempCwds.push(cwd);
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".pi", "pi-messenger.json"), JSON.stringify({ autoRegister: true }));

  const pi = await loadExtension();
  const sessionStart = pi.handlers.get("session_start")?.[0];
  expect(sessionStart).toBeTruthy();

  const ctx = createEventContext(cwd, () => true);
  await sessionStart?.({}, ctx);
  expect(ctx.ui.setStatus).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(45_000);

  expect(ctx.ui.setStatus).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Run the focused regression and verify RED**

Run:

```bash
cd /home/dominic/projects/pi-messenger
npx vitest run tests/status-heartbeat.test.ts -t "does not render an unchanged status on heartbeat ticks"
```

Expected: FAIL because `setStatus` is called once initially plus once per 15-second tick (four calls total after 45 seconds), proving the test captures the no-op redraw bug.

- [ ] **Step 4: Implement the minimal render cache**

In `index.ts`, declare the cache immediately before `updateStatus`:

```ts
let lastRenderedStatus: string | undefined;

function updateStatus(ctx: ExtensionContext): void {
```

Replace the unconditional status call with:

```ts
const nextStatus = `msg: ${nameStr}${countStr}${unreadStr}${planningStr}${activityStr}${crewStr}`;
if (nextStatus !== lastRenderedStatus) {
  ctx.ui.setStatus("messenger", nextStatus);
  lastRenderedStatus = nextStatus;
}
```

Keep `maybeAutoOpenCrewOverlay(ctx)` after this block so heartbeat side effects remain unchanged. Assign the cache only after `setStatus()` succeeds so a thrown render error cannot mark an unrendered value as current.

- [ ] **Step 5: Run the focused regression and verify GREEN**

Run:

```bash
cd /home/dominic/projects/pi-messenger
npx vitest run tests/status-heartbeat.test.ts -t "does not render an unchanged status on heartbeat ticks"
```

Expected: PASS with exactly one `setStatus` call.

- [ ] **Step 6: Add changed-status characterization coverage**

Add this test to `tests/status-heartbeat.test.ts`. It changes the theme output, which is part of the final cached status string, and proves deduplication does not hide real formatted changes:

```ts
it("renders when the formatted status changes", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-messenger-cwd-"));
  tempCwds.push(cwd);
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".pi", "pi-messenger.json"), JSON.stringify({ autoRegister: true }));

  const pi = await loadExtension();
  const sessionStart = pi.handlers.get("session_start")?.[0];
  const ctx = createEventContext(cwd, () => true);
  let themePrefix = "";
  ctx.ui.theme.fg = vi.fn((_color: string, text: string) => `${themePrefix}${text}`);

  await sessionStart?.({}, ctx);
  expect(ctx.ui.setStatus).toHaveBeenCalledTimes(1);

  themePrefix = "changed:";
  vi.advanceTimersByTime(15_000);

  expect(ctx.ui.setStatus).toHaveBeenCalledTimes(2);
  expect(ctx.ui.setStatus.mock.calls[1]?.[1]).toContain("changed:");
});
```

- [ ] **Step 7: Add the failing leave/rejoin lifecycle regression**

Add this test to `tests/status-heartbeat.test.ts`:

```ts
it("renders again after leave clears the status cache and the session rejoins", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-messenger-cwd-"));
  tempCwds.push(cwd);
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".pi", "pi-messenger.json"), JSON.stringify({ autoRegister: true }));

  const pi = await loadExtension();
  const sessionStart = pi.handlers.get("session_start")?.[0];
  const tool = pi.tools.find(tool => tool.name === "pi_messenger");
  const ctx = createEventContext(cwd, () => true);

  await sessionStart?.({}, ctx);
  expect(ctx.ui.setStatus).toHaveBeenCalledTimes(1);

  await tool.execute("leave-call", { action: "leave" }, new AbortController().signal, undefined, ctx);
  expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("messenger", undefined);

  await tool.execute("join-call", { action: "join" }, new AbortController().signal, undefined, ctx);

  expect(ctx.ui.setStatus).toHaveBeenCalledTimes(3);
  expect(ctx.ui.setStatus.mock.calls[2]?.[1]).toMatch(/^msg: /);
});
```

- [ ] **Step 8: Run the lifecycle regression and verify RED**

Run:

```bash
cd /home/dominic/projects/pi-messenger
npx vitest run tests/status-heartbeat.test.ts -t "renders again after leave clears the status cache and the session rejoins"
```

Expected: FAIL after the deduplication cache exists because rejoin computes the same formatted string and suppresses the third `setStatus` call.

- [ ] **Step 9: Reset the cache on successful leave and shutdown**

In the existing successful-leave block in the tool executor:

```ts
if (action === "leave" && !state.registered) {
  lastRenderedStatus = undefined;
  overlayHandle?.hide();
```

At the start of `session_shutdown` cleanup, add:

```ts
pi.on("session_shutdown", async () => {
  latestCtx = null;
  lastRenderedStatus = undefined;
```

Do not reset on a failed leave, because its visible messenger status remains active.

- [ ] **Step 10: Run all status-heartbeat tests**

Run:

```bash
cd /home/dominic/projects/pi-messenger
npx vitest run tests/status-heartbeat.test.ts
```

Expected: all status-heartbeat tests PASS, including stale-context and non-stale-error coverage.

- [ ] **Step 11: Run the complete upstream test suite**

Run:

```bash
cd /home/dominic/projects/pi-messenger
npm test
```

Expected: exit 0 with zero failed test files and zero failed tests.

- [ ] **Step 12: Inspect and commit the canonical patch**

Run:

```bash
cd /home/dominic/projects/pi-messenger
git diff --check
git diff -- index.ts tests/status-heartbeat.test.ts
git status --short
git add index.ts tests/status-heartbeat.test.ts
git commit -m "fix: avoid unchanged status heartbeat renders"
```

Expected: the implementation commit contains only cache logic, lifecycle resets, and regression tests.

### Task 2: Mirror and Verify the Fix in the Active Pi Installation

**Files:**
- Modify: `/home/dominic/.pi/agent/npm/node_modules/pi-messenger/index.ts`
- Reference: `/home/dominic/projects/pi-messenger/index.ts`

**Interfaces:**
- Consumes: the verified cache behavior from Task 1.
- Produces: the same `lastRenderedStatus` behavior in the currently installed pi-messenger v0.14.1 without importing unrelated upstream-main changes.

- [ ] **Step 1: Back up the active installed source**

Run:

```bash
cp /home/dominic/.pi/agent/npm/node_modules/pi-messenger/index.ts \
  /home/dominic/.pi/agent/npm/node_modules/pi-messenger/index.ts.before-status-dedup
```

Expected: backup exists and is byte-identical to the pre-patch active source.

- [ ] **Step 2: Apply only the verified production changes**

Edit `/home/dominic/.pi/agent/npm/node_modules/pi-messenger/index.ts` to make these three equivalent changes from Task 1:

```ts
let lastRenderedStatus: string | undefined;
```

```ts
const nextStatus = `msg: ${nameStr}${countStr}${unreadStr}${planningStr}${activityStr}${crewStr}`;
if (nextStatus !== lastRenderedStatus) {
  ctx.ui.setStatus("messenger", nextStatus);
  lastRenderedStatus = nextStatus;
}
```

```ts
if (action === "leave" && !state.registered) {
  lastRenderedStatus = undefined;
```

and:

```ts
pi.on("session_shutdown", async () => {
  lastRenderedStatus = undefined;
```

Preserve the installed v0.14.1 imports and all unrelated source exactly.

- [ ] **Step 3: Verify the active patch is minimal and structurally equivalent**

Run:

```bash
diff -u \
  /home/dominic/.pi/agent/npm/node_modules/pi-messenger/index.ts.before-status-dedup \
  /home/dominic/.pi/agent/npm/node_modules/pi-messenger/index.ts

python3 - <<'PY'
from pathlib import Path
paths = [
    Path('/home/dominic/projects/pi-messenger/index.ts'),
    Path('/home/dominic/.pi/agent/npm/node_modules/pi-messenger/index.ts'),
]
needles = [
    'let lastRenderedStatus: string | undefined;',
    'if (nextStatus !== lastRenderedStatus) {',
    'ctx.ui.setStatus("messenger", nextStatus);',
    'lastRenderedStatus = nextStatus;',
]
for path in paths:
    text = path.read_text()
    missing = [needle for needle in needles if needle not in text]
    if missing:
        raise SystemExit(f'{path}: missing {missing}')
    if text.count('lastRenderedStatus = undefined;') < 2:
        raise SystemExit(f'{path}: missing leave/shutdown cache resets')
    print(f'{path}: deduplication and lifecycle reset structure present')
PY
```

Expected: `diff` shows only the cache declaration, guarded `setStatus`, and two lifecycle resets; Python exits 0 for both sources.

- [ ] **Step 4: Re-run canonical tests after mirroring**

Run:

```bash
cd /home/dominic/projects/pi-messenger
npx vitest run tests/status-heartbeat.test.ts
npm test
```

Expected: focused and complete suites both exit 0 with zero failures.

- [ ] **Step 5: Reload running Pi sessions and verify the symptom**

In each running Pi TUI that loaded pi-messenger, run:

```text
/reload
```

Then join messenger if necessary, scroll away from the active prompt, and wait at least 45 seconds with no status changes.

Expected: no 15-second viewport snap or flash. Trigger an actual status change (for example, another agent joining or leaving) and confirm the footer updates once.

- [ ] **Step 6: Record final evidence**

Run:

```bash
cd /home/dominic/projects/pi-messenger
git status --short
git log -2 --oneline --decorate
```

Expected: the durable checkout has the committed design and implementation; any remaining untracked or modified files are explained, and the active install backup remains available for rollback.
