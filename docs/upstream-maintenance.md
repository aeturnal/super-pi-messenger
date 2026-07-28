# Selective upstream maintenance

`upstream` is a read-only source for optional maintenance, not a release dependency. Its push URL remains disabled. Pi Super Messenger `main` never tracks `upstream/main`; upstream changes are never merged automatically, and product progress never waits for upstream acceptance or releases.

## On-demand intake procedure

1. Fetch and prune the disabled-push `upstream` remote on demand (`git fetch --prune upstream`). Do not push to it.
2. Inspect new commits and releases without presuming they should be imported.
3. Record a candidate only when it addresses a Pi Super Messenger need or useful inherited maintenance.
4. Create a dedicated integration branch from current Pi Super Messenger `main`.
5. Import the smallest coherent upstream commit range, preserving authorship and attribution (for example, by cherry-picking rather than recreating work without credit).
6. Review conflicts and behavior against the PRD, the external-Superpowers compatibility boundary, and fork-specific behavior.
7. Run inherited unit tests and relevant eval acceptance checks.
8. Merge only through the Pi Super Messenger review process after normal approval.

## Candidate record

For each considered candidate, record the upstream commit range or release, source URL, rationale, affected fork behavior, integration branch, test and eval results, conflicts, review decision, and retained authorship/attribution. Rejected candidates may be recorded briefly so later maintainers do not repeat investigation.

No bulk synchronization, automatic merge bot, or branch-tracking configuration is permitted. Security or urgent maintenance still follows this selective, reviewed, tested procedure; urgency does not remove attribution or validation.
