# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets) and holds
pending changesets (`.changeset/*.md`).

**Rule:** the version only changes for package changes (`src/` and `package.json`) —
package changes require a changeset, and a PR that adds a changeset without package
changes fails CI.

The full release flow, commands and configuration are documented in
[docs/RELEASING.md](../docs/RELEASING.md).
