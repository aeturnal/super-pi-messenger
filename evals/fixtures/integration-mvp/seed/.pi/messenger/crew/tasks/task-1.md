# Implement clamp with test-first evidence

- Read the `project-style` skill.
- Observe the failing tests before implementation.
- Implement only `clamp`.
- Run fresh tests.
- Commit the implementation.
- Report completion with `pi_messenger({ action: "task.done", ... })`, then exit.
- Do not invoke `review`; Crew starts the single automatic review after `task.done` and worker exit.
- Do not start nested agents.
- Do not create, switch to, or manage nested worktrees.
