# Crew Communication Restoration Design

## Goal

Restore Crew children as full mesh participants so planners, workers, reviewers, analysts, and lobby workers can register, appear in presence, receive messages, and communicate within safe role boundaries. Restore live team broadcasts and make overlay send failures visible.

## Root Cause

Commit `62bee20` introduced a child action allowlist in `crew/child-actions.ts`. The list denies `join`, `task.start`, and `task.block`, even though packaged Crew prompts require those actions. Because the router checks the list before handling `join`, a child cannot register. Its inbox watcher never starts, direct messages remain unread, allowed messaging actions later fail as not registered, and `chatty` coordination instructions cannot produce status broadcasts.

The current run provided direct evidence: worker reports said `join` and `task.start` were controller-only, no worker join events appeared in the feed, and a direct message remained in the intended worker inbox.

A separate degradation in commit `830842b` changed worker broadcasts from live peer delivery to feed-only logging. That prevents workers from using broadcasts for team conversation even when registration works.

The overlay has an additional presentation bug. Message validation and delivery failures set a notification while leaving message mode active, but `renderLegend()` renders the message bar before notifications. Enter therefore appears to do nothing.

## Role-Specific Action Policy

Replace the single child allowlist with a role-aware policy.

Every Crew child role may use mesh coordination actions:

- `join` and `leave`
- `status`, `list`, `whois`, `feed`, and `set_status`
- `send` and `broadcast`
- `crew.status` and `crew.agents`

Workers, including lobby workers after assignment, may additionally use the task protocol:

- `reserve` and `release`
- `task.show`, `task.list`, and `task.ready`
- `task.start`, `task.progress`, `task.done`, and `task.block`

Planners, reviewers, and analysts remain read-only with respect to task execution unless they are deliberately launched through the worker role for a Crew task. The effective process role, not a task label supplied by an untrusted prompt, determines permission.

These actions remain controller-only:

- planning, cancellation, work dispatch, review dispatch, and synchronization;
- task creation, splitting, reset, deletion, approval, rejection, and revision;
- Team setup, profiles, charters, memory administration, and other Team control operations;
- unknown future actions, which remain denied by default.

`join` must be evaluated before registration is required. The router must still apply the child policy before executing the action.

## Task Ownership

Permission to call a task action does not grant permission to mutate arbitrary tasks.

- `task.progress`, `task.done`, and `task.block` require `task.assigned_to` to equal the registered child name.
- `task.start` may claim only a ready, startable task through the existing atomic task action. It cannot take an active, blocked, approval-gated, or dependency-blocked task.
- A lobby assignment is already started by Crew. Its prompt continues to forbid a second `task.start` call.
- Controller calls retain their existing authority.

The ownership check must live in the task handler or task-action boundary, not only in prompts.

## Live Broadcasts

Remove the worker-only feed shortcut from `executeSend()`.

A broadcast will:

1. Resolve all active peers except the sender.
2. Validate each peer registration.
3. Write one inbox message per valid peer.
4. Record one project feed event.
5. Return successful and failed recipients.

A partial broadcast succeeds and reports failures. A broadcast with no successful recipients returns a bounded error. Existing per-process message budgets remain in force, including the `chatty` default of ten outgoing messages. Incoming inbox messages continue to be delivered as steering turns with reply guidance.

Broadcasts are therefore both live peer communication and user-visible feed activity. Direct messages remain the preferred path for urgent or targeted questions.

## Overlay Send Feedback

The overlay must display validation and delivery errors while preserving the typed message.

Message mode will render an active notification together with, or ahead of, the composer instead of hiding it behind the normal message bar. Successful sends continue to clear the composer. Failed sends keep the input and recipient text so the user can correct and retry.

This covers empty or malformed mentions, no active peers, invalid recipients, and delivery failures.

## Tests

Add regression coverage for:

- an unregistered child successfully calling `join`;
- each child role's allowed and denied action matrix;
- a worker starting, progressing, completing, and blocking only its own task;
- a child being denied controller, approval, Team, and unknown actions;
- a worker broadcast writing to every active peer inbox and exactly one feed event;
- partial and complete broadcast failures;
- an inbox watcher delivering a direct message to a registered child;
- the `chatty` budget still limiting outgoing messages;
- overlay Enter showing errors while preserving input;
- successful overlay sends clearing input.

Tests must reproduce the current regression before production changes. Existing controller-only approval tests remain unchanged and must continue to pass.

## Scope

This change does not add a visual TUI to headless Crew processes. Crew children continue to run in non-interactive Pi mode and participate through the `pi_messenger` tool, registry, inbox watcher, and steering messages.

This change does not alter worktree handling, planning behavior, dependency scheduling, model selection, or Team approval policy.
