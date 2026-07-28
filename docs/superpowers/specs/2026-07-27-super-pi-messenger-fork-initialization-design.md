# Super Pi Messenger Fork Initialization Design

**Date:** 2026-07-27  
**Status:** Approved

## 1. Purpose

Establish Super Pi Messenger as an independently maintained public GitHub fork of `nicobailon/pi-messenger` before product implementation begins.

The initialization must create a safe repository boundary, preserve visible upstream lineage, apply the approved public product identity, and avoid premature changes to compatibility-sensitive runtime names.

## 2. Repository identity

The public repository will be a real GitHub fork:

```text
nicobailon/pi-messenger
        ↓ GitHub fork relationship
aeturnal/super-pi-messenger
```

The repository will be public and owned initially by the personal GitHub account `aeturnal`. It may be transferred to an organization later without changing the initial architecture.

Super Pi Messenger is independently maintained. The GitHub fork relationship records its source lineage but does not make upstream authoritative for product decisions, releases, or scheduling.

## 3. Repository authority and remotes

The local repository will use this remote layout:

```text
origin    https://github.com/aeturnal/super-pi-messenger.git
upstream  https://github.com/nicobailon/pi-messenger.git
```

`origin` is authoritative for Super Pi Messenger development. Product branches, issues, reviews, tags, and releases belong to the new repository.

`upstream` exists only for fetching and comparing later upstream changes. Its push URL must be disabled locally so an accidental push cannot target `nicobailon/pi-messenger`.

The current local history remains intact, including the approved naming-design commit. The approved PRD and supporting documents will be committed locally before the initialized `main` branch is pushed to the new origin.

## 4. Staged rename boundary

### 4.1 Rename during initialization

The initial repository setup will change public repository and product identity:

- GitHub repository name to `super-pi-messenger`
- README title and product description to Super Pi Messenger
- GitHub repository metadata plus README and documentation repository, issue, badge, and source links
- The `package.json` package name and its `repository`, `homepage`, and `bugs` identity metadata
- Product-level documentation references
- Independent-maintenance, upstream-lineage, and non-affiliation notices

The README must identify the repository as an independently maintained prerelease fork. It must not imply that the existing `npm:pi-messenger` package installs Super Pi Messenger.

Before npm publication, development installation will use the GitHub repository source:

```bash
pi install git:github.com/aeturnal/super-pi-messenger
```

### 4.2 Preserve during initialization

The following compatibility-sensitive technical names remain unchanged:

- `pi_messenger` tool name
- Crew action names such as `plan`, `work`, and `review`
- `.pi/messenger` state directory
- Existing configuration keys
- Source directory names
- TypeScript symbols and APIs
- The existing `pi-messenger` executable and installer behavior

The initial setup renames the package and repository identity metadata together while retaining the compatibility executable. Any future executable, state-path, command, API, or migration changes require a dedicated compatibility phase and tests.

## 5. Initialization sequence

The setup must execute in this order:

1. Verify GitHub authentication is active for `aeturnal`.
2. Check whether `aeturnal/pi-messenger` or `aeturnal/super-pi-messenger` already exists.
3. Stop for inspection if either repository name would conflict with the operation.
4. Create a real GitHub fork of `nicobailon/pi-messenger` under `aeturnal`.
5. Rename the GitHub fork to `super-pi-messenger`.
6. Verify that GitHub still reports `nicobailon/pi-messenger` as its parent.
7. Rename the current local `origin` remote to `upstream`.
8. Disable the `upstream` push URL while retaining its fetch URL.
9. Add `https://github.com/aeturnal/super-pi-messenger.git` as the new `origin`.
10. Verify the remote names and URLs before any push.
11. Commit the approved currently untracked `PRD.md`, `docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md`, and `docs/superpowers/plans/2026-07-27-super-pi-messenger-document-rename.md` using explicit paths.
12. Commit the fork-initialization implementation plan generated from this design using its explicit path.
13. Apply, verify, and commit the approved public README and GitHub repository-metadata changes.
14. Run the existing test suite and documentation integrity checks.
15. Push local `main` to the new `origin` and establish its tracking branch.
16. Verify the remote branch, GitHub fork relationship, repository metadata, upstream push guard, and clean working tree.

No implementation feature work begins until this initialization succeeds.

## 6. Failure handling and safety

Initialization is fail-closed.

The process must stop before changing remotes or pushing when:

- GitHub authentication does not identify `aeturnal` as the active account.
- A target repository name already exists unexpectedly.
- GitHub cannot create or verify the fork relationship.
- The local repository is not based on the expected upstream.
- Documentation or tests fail before the first push.

Every Git operation that stages or commits files must use explicit paths. Broad commands such as `git add .` are prohibited during initialization.

No force push is allowed. No push may target `upstream`. The original upstream URL must remain available as the `upstream` fetch URL.

If GitHub fork creation succeeds but later local setup fails, the fork remains intact and the process stops with the current local and remote state reported. Recovery must resume from verified durable state rather than recreating or overwriting the repository.

## 7. Ongoing upstream synchronization

Upstream changes are optional inputs, not automatic updates.

When an upstream change is useful:

1. Fetch it from `upstream`.
2. Integrate it on a dedicated branch.
3. Review its effect on Super Pi Messenger requirements and Superpowers compatibility.
4. Run the complete relevant test suite.
5. Merge it through the Super Pi Messenger review process.

`main` must never automatically track or pull from `upstream/main`.

## 8. Development and release model

After initialization:

- `aeturnal/super-pi-messenger` is the authoritative project.
- The temporary global Crew–Superpowers compatibility extension remains in use during early development.
- Fork implementation follows the approved PRD milestones.
- Initial development installations use the GitHub source.
- The future npm package name is `super-pi-messenger`.
- npm publication requires a separate packaging and migration design with installation, upgrade, removal, state-compatibility, and command-compatibility tests.
- The temporary global compatibility extension is retired only after the packaged adapter inside Super Pi Messenger is verified.

## 9. Non-goals

Fork initialization does not:

- Rename Crew
- Rename `pi_messenger`
- Rename `.pi/messenger`
- Rename configuration keys, source directories, or TypeScript symbols
- Publish an npm package
- Implement PRD runtime features
- Automatically merge future upstream changes
- Claim affiliation with or endorsement by Obra
- Remove or modify the separately installed stock Superpowers package

## 10. Acceptance checks

Initialization is complete when all of the following are true:

1. `aeturnal/super-pi-messenger` exists publicly as a GitHub fork of `nicobailon/pi-messenger`.
2. Local `origin` fetches from and pushes to `aeturnal/super-pi-messenger`.
3. Local `upstream` fetches from `nicobailon/pi-messenger` and has a disabled push URL.
4. Local `main` tracks `origin/main`, not `upstream/main`.
5. The existing naming-design commit and approved product documents exist on `origin/main`.
6. The README uses Super Pi Messenger branding, states independent maintenance and upstream lineage, and disclaims Obra affiliation or endorsement.
7. The README does not claim that `npm:pi-messenger` installs Super Pi Messenger.
8. Git-source installation instructions point to `aeturnal/super-pi-messenger`.
9. Compatibility-sensitive technical names remain unchanged.
10. Existing tests and document integrity checks pass.
11. No force push or upstream push occurred.
12. The local working tree is clean after initialization.
