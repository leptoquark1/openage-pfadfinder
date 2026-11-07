# Releasing

Versioning and releases of `@leptoquark1/openage-pfadfinder` are managed with
[Changesets](https://github.com/changesets/changesets).

## Rule: the version only changes for package changes

The library lives in `packages/pfadfinder/`. Package changes are changes under
`packages/pfadfinder/src/` (including renames and deletions) and to
`packages/pfadfinder/package.json`. The private workspace root and the demo app
(`apps/demo`, listed under `ignore`) are never versioned.

- Package changes **require** a changeset (`pnpm changeset`). If no release is
  warranted (e.g. a devDependency bump), use `pnpm changeset add --empty`.
  - Moves and renames count too: CI and Changesets see a file moved under
    `packages/pfadfinder/src/` as deleted plus added, so a pure restructuring
    needs an (empty) changeset as well.
  - An empty changeset has no package entries in its frontmatter. The next
    `changeset version` deletes it without bumping a version or writing a
    `CHANGELOG.md` entry. A line of text below the frontmatter is optional and
    only explains the changeset to reviewers.
- A changeset **without** package changes fails CI.
- The version PR (`changeset-release/*`) is exempt.

Enforced by the **Changeset rules** step in
[ci.yml](../.github/workflows/ci.yml), compared against the PR's base branch.
"Package changed" is defined by `changedFilePatterns` in
[.changeset/config.json](../.changeset/config.json); its patterns are relative
to each package directory and must stay in sync with `RELEASE_RE` in ci.yml.

## CI

CI runs the same steps as `pnpm check`: lint, typecheck, tests with coverage,
build and package validation. Only PRs that change nothing but documentation
(`*.md`, `docs/`, `LICENSE`) skip them.

## Release flow

1. Change code, add a changeset with a bump level (patch/minor/major) and
   changelog text, commit both, open a PR.
2. After the merge into `main`, the [Release workflow](../.github/workflows/release.yml)
   opens or updates the **"chore: release"** PR (version bump + `CHANGELOG.md`).
3. Merging that PR publishes to npm (with provenance), pushes the tag
   `@leptoquark1/openage-pfadfinder@<version>` and creates a GitHub Release. `prepublishOnly` runs `pnpm check`
   first.

Requires the repo secret **`NPM_TOKEN`** (npm token with publish rights for
`@leptoquark1`).

Manual fallback (no provenance, no GitHub Release):
`pnpm run version`, commit, then `NODE_AUTH_TOKEN=<token> pnpm run release` and
`git push origin main --tags`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Some packages have been changed but no changesets were found" | Add a changeset (or an empty one) |
| "Changeset added or modified, but no files under packages/pfadfinder/src/ or packages/pfadfinder/package.json changed" | Remove the changeset file |
| Release PR open, but not ready to ship | Don't merge it; new changesets update it automatically |
| Cancel a release | Close the release PR and delete `changeset-release/main` |
| Wrong version published | Publish a corrected version (npm unpublish is effectively impossible) |
