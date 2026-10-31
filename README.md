# @leptoquark1/ts-aoe-pathfinder

> OpenAge's Pathfinding TypeScript Port

A dependency-free, native ESM TypeScript library, inspired by the
[openage](https://github.com/SFTtech/openage) pathfinder.

## Status

Project skeleton. The package, build, test, lint, release, and publishing setup are in place. The
pathfinding implementation and public API will follow.

## Installation

```bash
pnpm add @leptoquark1/ts-aoe-pathfinder
```

```bash
npm install @leptoquark1/ts-aoe-pathfinder
```

Requires Node.js `>=22.12.0`. The package is ESM-only and ships TypeScript declarations.

## Project structure

```text
src/index.ts          Public package entry point
test/                 Vitest test suite
.github/workflows/    CI and release automation
.changeset/           Changesets configuration
```

## Development

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm check:package
```

Run everything that CI runs:

```bash
pnpm check
```

## Toolchain

- TypeScript 7 with `NodeNext` ESM output and declaration maps
- Vitest with V8 coverage
- Biome for linting, formatting, and import organization
- publint and Are the Types Wrong for package export validation
- Changesets for versioning and changelog generation
- GitHub Actions for CI and npm publishing with provenance

## Releasing

1. Add a changeset: `pnpm changeset`
2. Commit and merge the change.
3. The release workflow opens a versioning PR.
4. Merging that PR publishes to npm.

Add an `NPM_TOKEN` repository secret with publish access to `@leptoquark1`.

## License

[GPL-3.0-or-later](LICENSE)
