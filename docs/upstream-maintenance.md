# Selective upstream maintenance

`upstream` is a read-only source for optional maintenance, not a release dependency. The upstream push URL must remain `DISABLED`. Super Pi Messenger `main` never tracks `upstream/main`; upstream changes never merge automatically, and product progress never waits for upstream acceptance or releases.

## On-demand intake procedure

1. Fetch and prune the disabled-push `upstream` remote on demand: `git fetch upstream --prune`. Do not push to it.
2. Inspect new commits and releases without presuming they should be imported.
3. Record a candidate only when it addresses a Super Pi Messenger need or useful inherited maintenance.
4. Create a dedicated integration branch from current Super Pi Messenger `main`.
5. Import the smallest coherent upstream commit range; preserve authorship and attribution (for example, by cherry-picking rather than recreating work without credit).
6. Review conflicts and behavior against the PRD, the external-Superpowers compatibility boundary, and fork-specific behavior.
7. Run inherited unit tests and relevant eval acceptance checks.
8. Merge only through the Super Pi Messenger review process after normal approval.

## Candidate record

For each considered candidate, record the upstream commit range or release, source URL, rationale, affected fork behavior, integration branch, test and eval results, conflicts, review decision, and retained authorship/attribution. Rejected candidates may be recorded briefly so later maintainers do not repeat investigation.

No bulk synchronization, automatic merge bot, or branch-tracking configuration is permitted. Security or urgent maintenance still follows this selective, reviewed, tested procedure; urgency does not remove attribution or validation.
