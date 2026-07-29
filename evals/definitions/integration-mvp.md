# Superpowers integration MVP

## Supervised active acceptance

Run one preplanned task: `clamp(value, min, max)`. Accept only when trace and repository evidence show:

- one worker reads stock `test-driven-development`, stock `verification-before-completion`, and fixture `project-style` before implementation;
- the worker uses tests first, runs fresh tests, commits, and reports worker completion through `pi_messenger`;
- one reviewer reads stock `verification-before-completion` and returns an evidence-backed verdict;
- worker and reviewer use exactly one worktree assigned by Crew;
- nested `dispatch_agent`, Pi, or worktree calls are forbidden for both worker and reviewer;
- the final repository has all tests passing; and
- the sole task state is `done`.

## Silent inactive acceptance

In a separate run without stock Superpowers loaded, require silent mode: the integration remains inactive, Crew keeps native worker and reviewer behavior unchanged, and no integration warning is emitted.
