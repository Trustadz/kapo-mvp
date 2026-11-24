# Kapo repository instructions

These instructions apply to Kapo. Follow the user's current request when it
specifies a narrower scope or a different workflow.

## Branch, test, and review

- Use a dedicated branch for each distinct change: `feat/<issue>-<slug>`,
  `fix/<issue>-<slug>`, `docs/<slug>` or `chore/<slug>`. Keep unrelated work on
  its own branch or checkout. Preserve existing working files and stage only
  the intended paths.
- Use a separate git worktree (workspace) under `data/worktrees/<slug>` for
  additional or parallel work. Do not switch the root checkout off an active
  feature branch; add the new branch as a worktree and leave the root checkout
  where it is.
- Before asking for local approval, run `npm run typecheck`, `npm test`, and
  `npm run build`. Run `npm run test:e2e` for changes that affect the UI, API,
  migrations, Docker, or the release workflow (install Chromium once with
  `npx playwright install chromium`). Report which checks ran and any remaining
  manual verification.
- For changes the user wants to try, run a local preview from the feature branch
  with a dedicated database and port, and give the user the URL. A local preview
  does not put code on GitHub.
- **Stop for local approval before submitting a PR.** After the local change and
  checks are ready, present the summary, the local diff/stat, the preview URL
  when applicable, and the checks that ran, then ask the user to approve
  submitting a PR. Do not push the branch or open a PR until the user explicitly
  approves. Approval to submit a PR is not approval to merge.
- After local approval, open a draft PR against `main` for user testing and
  review. Include the preview and the checks that correspond to the PR. GitHub
  **Verify** runs for both draft and ready PRs.
- Let the user test and approve before merging. A request to review or test does
  not authorize merging or publishing. A request to publish, ship, or release
  authorizes merging its passing PR and running the release workflow.

See [build spec §11](docs/build-spec.md#11-agent-write-scopes-avoid-concurrent-edits)
for file ownership when more than one agent works in this checkout.

## UI copy and helper text

Default to **no helper text**. Labels, placeholders, structure and validation
messages should carry the meaning. Add supporting copy only for an exception
listed in the [helper text guidelines](docs/helper-text.md), cite the exception
in the PR, and include a screenshot. Do not add prospective helper text for a
hypothetical question; wait for a real question or observed confusion. When
touching a screen, remove helper text that no longer meets the guidelines.

## Release

- **Verify** runs typecheck, Vitest and the production build automatically on
  pull requests and pushes to `main`; the separate **Changelog** workflow checks
  the fragment contract. Shipping uses the separate, manual **Publish container**
  workflow on `main`, which reruns verification. Trigger it only with the user's
  authorization; the owner can also start it in GitHub Actions.
- The owner chooses which approved PRs ship by merging them before publishing.
  Do not merge a PR the user has not approved for the next version, and never
  create a release-version commit or PR.
- The workflow calculates the next version from the latest stable Git tag using
  the selected `patch`, `minor`, or `major` increment, then tags the image and
  repository and creates the GitHub Release. Do not edit `package.json` for a
  release; the tag-derived version is passed to the Docker build and reported by
  the MCP handshake.
- Add one Markdown fragment under `changelog.d/` for each user-facing change,
  following [changelog.d/README.md](changelog.d/README.md). Do not edit
  `CHANGELOG.md` in a feature or fix PR; the Changelog workflow rejects it.
  Apply the `changelog-not-required` label only when the PR has no user-visible
  change.
- Release notes combine the pending fragments, any curated `## Unreleased`
  content and GitHub's generated PR list.
- Label PRs so generated notes group correctly: `type: feature` for **Added**,
  `type: bug` for **Fixed**, `type: improvement`, `type: accessibility` or
  `type: design` for **Improved**, and `type: docs` for **Documentation**.
  Unlabeled PRs land under **Other changes**.
- After publishing, verify that `vX.Y.Z` and `latest` point at the release, that
  the GitHub Release exists, and that its notes include the upgrade notes. Then
  run `npm run changelog:release -- X.Y.Z` in a small docs change to fold the
  fragments (and any remaining `## Unreleased` content) into
  `## X.Y.Z — YYYY-MM-DD` and delete the consumed fragments.
- See [release instructions](README.md#publish-a-release).
