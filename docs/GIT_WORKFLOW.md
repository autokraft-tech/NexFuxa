# NexFuxa Git workflow

## Branches and remotes

| Reference | Purpose |
| --- | --- |
| `upstream/master` | Official FUXA source from `https://github.com/frangoteam/FUXA.git` |
| `origin/master` | Clean official-source mirror in `https://github.com/autokraft-tech/NexFuxa.git` |
| `origin/nexfuxa` | Permanent customization branch and GitHub default branch |
| `feature/*` | Features created from the current `nexfuxa`, with PRs targeting `nexfuxa` |

The local checkout also retains `legacy-fuxa` pointing to `autokraft-tech/FUXA` to preserve its earlier remote references. Use `origin` for NexFuxa work. A remote named `origin` must not point to that older fork.

At the initial verified sync point on 2026-10-13, local `master`, `origin/master`, and `upstream/master` all pointed to `2efc900f09931a36ae32e0b196ea3b808f445e22`. The `nexfuxa` branch was created from that clean commit. [PR #2](https://github.com/autokraft-tech/NexFuxa/pull/2) was then squash-merged into `nexfuxa` as `6c62fafcf18f7664cbd4ac6b1db741678d6cb5d1`.

Never commit custom features to `master`, force-reset `nexfuxa` to upstream, force-push shared branches, or rewrite published shared history. Preserve local changes before switching branches; do not use reset or clean to discard work.

## Feature development

Start with a clean working tree. If local changes exist, preserve them on their current branch or in a suitable isolated checkout before switching. Fetch the fork and fast-forward the local customization branch:

```powershell
git status --short
git fetch origin
git switch nexfuxa
git merge --ff-only origin/nexfuxa
git switch -c feature/my-feature
```

Stop if a command fails or the local branch has diverged. Implement and test the feature, commit only intended source and documentation files, then publish the feature branch and create its PR explicitly against `nexfuxa`:

```powershell
git push -u origin feature/my-feature
gh pr create --repo autokraft-tech/NexFuxa --base nexfuxa --head feature/my-feature
```

Review the diff and relevant test evidence before merging. Regular feature PRs may use squash merge. Keep the feature branch until the merged result has been verified. A GitHub default branch of `nexfuxa` helps new PRs select the correct base, but always check the base explicitly.

### PR checks

The [NexFuxa CI workflow](../.github/workflows/nexfuxa-ci.yml) runs for PRs targeting `nexfuxa`, pushes to `nexfuxa`, and manual dispatch. Before merging a customization PR, require all three checks to pass on its current head: `plc-model-tests` (Phase 3A/3B), `server-tests` (server tests and TypeScript build), and `client-build` (script and Phase 3B race tests plus Angular production build). Review any failure and fix the cause on the PR branch; do not skip a failing check. The workflow tests with Node.js 20 in isolated GitHub-hosted Ubuntu 24.04 jobs with no production credentials or PLC connection. Node.js 22 and Docker runtime upgrades need separate planning and validation.

The corresponding local commands are `node --test tools/plc-device-model/test/phase3a.test.cjs tools/plc-device-model/test/phase3b.test.cjs` from the repository root, `npm ci`, `npm test`, and `npm run build` from `server`, and `npm ci`, `npm run test:scripts`, `node --test test/plc-device-models-race.test.cjs`, and `npm run build -- --configuration production` from `client`. These commands use temporary SQLite test data only; they must not target `.local/fuxa-dev` or a production project.

## Official updates

Official synchronization and customization integration are separate operations. First fetch both official and fork references:

```powershell
git fetch upstream master
git fetch origin master nexfuxa
git merge-base --is-ancestor origin/master upstream/master
git merge-base --is-ancestor master upstream/master
```

Both ancestry checks must succeed before proceeding. A nonzero result means the mirror or local `master` has diverged from official history; stop and inspect it. Do not resolve divergence by deleting commits or force-pushing. Also preserve any uncommitted work before switching.

Advance only `master` to the fetched official sync point:

```powershell
git switch master
git merge --ff-only origin/master
git merge --ff-only upstream/master
git push origin master
git rev-parse master origin/master upstream/master
```

Verify that the three printed commit IDs are identical. Record that sync point in the integration PR. A rejected push or failed fast-forward requires inspection; it does not authorize history replacement. These commands do not merge official changes into `nexfuxa`.

Create a separate integration branch from current `nexfuxa`:

```powershell
git switch nexfuxa
git merge --ff-only origin/nexfuxa
git switch -c feature/integrate-upstream-YYYYMMDD
git merge origin/master
```

Replace `YYYYMMDD` with the actual integration date. Resolve conflicts on this branch, run the relevant application builds and tests, inspect the custom widgets and bindings, and publish a PR targeting `nexfuxa`. Use a merge commit for official integration PRs so upstream ancestry is retained for later integrations. Do not merge an upstream update automatically.

## Conflict resolution

Inspect each conflict against the official update and the NexFuxa customization it affects. Preserve intended customization behavior while adapting to upstream APIs; do not accept one entire side merely to clear conflicts. Stage the resolved files and complete the merge with a normal commit on the integration branch, then test the combined result.

If a resolution is uncertain, leave the integration unmerged and report the conflict and options for review. Never edit a saved FUXA database to resolve a source conflict. Preserve the SVG reuse policy, PLC binding contracts, and runtime data exclusions. Push fixes as new commits instead of rewriting a published integration or customization branch.

## Releases and runtime data

Release a reviewed, tested commit from `nexfuxa`. Verify that its PRs are merged, build and test the exact commit, then create an immutable annotated version tag such as `nexfuxa-v0.1.0` pointing to that approved SHA and publish the tag. Record the source SHA, build results, relevant upstream sync point, and known limitations in the release notes. Do not move an existing release tag; corrections require a new version.

Build deployment artifacts from the tagged source. Back up the target environment before any separately approved deployment, and retain the prior release artifact and compatible data backup for rollback. Roll back by selecting the earlier release artifact and following its restoration instructions, not by resetting `nexfuxa` or rewriting Git history.

Keep `.local/fuxa-dev`, production runtime directories, databases, logs, images, and backups out of Git. Source operations must not stop, recreate, migrate, or delete existing Docker runtime data unless that operation is separately authorized. Validate development Compose with `docker compose -f compose.dev.yml config`; run destructive lifecycle commands only when expressly authorized. The [valve README](../custom/widgets/valves/README.md#backup-and-restoration) documents stopped-container backups and restoration for the development stack.
