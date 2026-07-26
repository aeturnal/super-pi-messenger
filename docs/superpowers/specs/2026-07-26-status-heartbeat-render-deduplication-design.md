# Status Heartbeat Render Deduplication Design

## Problem

After a Pi session joins pi-messenger, the extension runs a status heartbeat every 15 seconds. Each heartbeat recomputes the footer status and unconditionally calls `ctx.ui.setStatus()`. Pi treats every `setStatus()` call as a render request, even when the status text is unchanged. Those periodic terminal writes can pull a terminal viewport away from scrollback or visibly flash/redraw the TUI after Crew work has finished.

The heartbeat itself must remain because time-based peer expiry and stuck-agent detection need periodic evaluation.

## Scope

Change only status-render emission. Preserve:

- the 15-second heartbeat cadence;
- peer and stuck-agent checks on every heartbeat;
- immediate status updates triggered by existing events;
- planning, autonomous work, overlay, and messaging behavior;
- the existing stale-context heartbeat handling on upstream `main`.

Do not redesign the overlay, remove polling, or change Pi core.

## Design

Maintain an extension-instance cache named `lastRenderedStatus` containing the final ANSI-formatted status string most recently passed to `ctx.ui.setStatus("messenger", ...)`.

On each `updateStatus(ctx)` call:

1. Perform the existing UI/registration guards.
2. Run stuck-agent detection and compute the current status exactly as today.
3. Compare the completed status string with `lastRenderedStatus`.
4. If equal, do not call `setStatus()`; all non-render heartbeat work still occurred.
5. If different, update `lastRenderedStatus` and call `setStatus()` once.

Cache the final formatted string rather than a semantic object. This keeps every display dependency—including theme ANSI codes—in the comparison without duplicating the status model.

Reset `lastRenderedStatus` when messenger status is explicitly cleared during leave and during session shutdown. A later join or replacement extension instance must therefore emit its initial status even if its visible text matches the prior session.

## Active Install and Durable Source

The canonical implementation and tests will live in the durable checkout at `/home/dominic/projects/pi-messenger`, based on upstream `main`.

After the regression passes in that checkout, mirror only the equivalent production change into the active installed package at `/home/dominic/.pi/agent/npm/node_modules/pi-messenger/index.ts`. The active copy provides immediate relief; the durable checkout preserves tests, history, and an upstream-ready patch. A package reinstall may overwrite the active copy, but not the durable checkout.

Pi must be reloaded after patching so the running extension instance uses the new code.

## Error Handling and Lifecycle

The deduplication check must remain inside the existing `updateStatus()` stale-context error boundary. Non-stale errors continue to propagate. A suppressed render must not suppress stuck notifications or other status computation side effects.

The cache is extension-instance local and requires no persistence. Shutdown cleanup resets it defensively; a newly loaded extension also starts with `undefined` naturally.

## Testing

Use fake timers and the existing status-heartbeat test harness.

Regression coverage must prove:

1. With a registered UI context and unchanged status, the initial status is rendered once and subsequent 15-second heartbeat ticks do not call `setStatus()` again.
2. When a status input changes, a later update calls `setStatus()` with the changed value.
3. Leave clears the footer/cache, and a later join can render an initial status again.
4. Existing stale-context behavior still stops an invalid heartbeat, and non-stale errors still propagate.

Follow red-green-refactor:

- add the unchanged-heartbeat regression and observe it fail because `setStatus()` is called repeatedly;
- implement the minimal cache/check/reset behavior;
- run focused status-heartbeat tests;
- run the complete upstream test suite;
- mirror the production delta to the active install;
- verify the active and durable implementations contain equivalent deduplication logic.

## Success Criteria

- An idle, registered pi-messenger session produces no status render requests on unchanged heartbeat ticks.
- Real status changes still appear.
- Time-based detection continues running.
- Leave/rejoin and reload lifecycle behavior remains correct.
- Focused and complete test suites pass.
