# Crew Communication Restoration Design

## Goal

Restore Crew workers as registered mesh participants so they can receive direct messages, broadcast to active peers, report `chatty` updates, and perform their assigned task protocol without exposing controller-only orchestration.

## Confirmed Regressions

The child action allowlist in `crew/child-actions.ts` denies `join`, `task.start`, and `task.block`, although the packaged worker prompt requires them. A denied `join` prevents registration and the inbox watcher from starting. Direct messages then remain unread and later worker actions fail.

`executeSend()` also has a `PI_CREW_WORKER` branch that logs broadcasts only to the feed. It bypasses the existing peer-delivery path, so workers cannot use broadcasts for team conversation.

Separately, message-send failures appear to do nothing in the overlay. The handler sets a notification but remains in message mode, while the renderer shows the composer instead of the notification.

## Smallest Correction

### Role-aware child actions

Replace the single child allowlist with a fail-closed role-aware check.

All Crew child roles may use existing read-only coordination and messaging actions, including `join`, presence, feed, direct messages, broadcasts, and status updates.

Execution workers may additionally use the worker protocol already named in their prompt:

- reservations;
- task inspection;
- `task.start`;
- `task.progress`;
- `task.done`;
- `task.block`.

Planning, work dispatch, review dispatch, task creation and revision, approval decisions, and Team administration remain controller-only. Unknown actions remain denied.

The router must allow a permitted child to call `join` before requiring registration. Permission must come from the process's Crew role, not from an action argument or task label.

### Task ownership

Allowing worker task actions must not allow mutation of another worker's task.

- Progress, completion, and blocking require the registered child to own the task.
- Starting a task uses the existing atomic ready-task checks.
- Lobby workers keep their existing rule that an assigned task is already started.

Ownership is enforced in code, not only in prompts.

### Live worker broadcasts

Remove the worker-only feed shortcut from `executeSend()`. Worker broadcasts use the existing broadcast path, which already:

- resolves active peers and excludes the sender;
- validates recipients;
- writes peer inbox messages;
- reports partial or complete delivery failure;
- records one broadcast feed event;
- applies the configured message budget.

No second broadcast implementation or delivery format is added.

### Visible send errors

While message mode is active, render its current notification without discarding the typed message. A failed send leaves the composer content available for correction. A successful send keeps the current behavior of clearing and closing the composer.

## Tests

Add focused regression tests proving:

- an unregistered Crew child can call `join`;
- each effective child role permits only its intended action set;
- a worker can start, progress, complete, and block its own task but not another worker's task;
- controller-only and unknown actions remain denied;
- a worker broadcast reaches every active peer inbox and records one feed event;
- direct inbox delivery works after child registration;
- message budgets still apply;
- overlay send errors are visible and preserve input;
- successful overlay sends clear input.

Existing approval and controller-boundary tests must continue to pass.

## Scope

This change restores existing mesh behavior. It does not add a new messaging protocol, visual TUI for headless children, scheduler, worktree behavior, planning behavior, or Team policy.
