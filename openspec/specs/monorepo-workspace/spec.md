# monorepo-workspace

## Purpose

Defines the structure and conventions of the MeldRank pnpm + Turborepo monorepo: the workspace layout, dependency boundaries between packages and apps, shared TypeScript configuration, and the root-level commands that orchestrate builds, type-checking, linting, and tests across all workspaces.

## Requirements

### Requirement: Workspace package layout

The repository SHALL be a pnpm + Turborepo monorepo containing exactly the package and app workspaces defined by Technical Architecture §7: `packages/engine`, `packages/shared`, `apps/web`, `apps/api`, `apps/match`, and `apps/bots`. Each workspace SHALL have its own `package.json` and be discoverable by the pnpm workspace configuration.

#### Scenario: All defined workspaces are present and recognized

- **WHEN** `pnpm -r list --depth -1` is run at the repo root
- **THEN** all six workspaces (`packages/engine`, `packages/shared`, `apps/web`, `apps/api`, `apps/match`, `apps/bots`) are listed as workspace members

#### Scenario: No undeclared workspaces exist

- **WHEN** the `packages/` and `apps/` directories are inspected
- **THEN** only the six workspaces named in Technical Architecture §7 exist; no additional packages or apps are present

### Requirement: Engine package is dependency-free

The `packages/engine` workspace SHALL declare zero runtime (`dependencies`) entries, so the Game Engine remains pure TypeScript runnable in the client, the Match Service, and bots without pulling transitive runtime deps.

#### Scenario: Engine has no runtime dependencies

- **WHEN** `packages/engine/package.json` is inspected
- **THEN** its `dependencies` field is empty or absent (only `devDependencies` are permitted)

### Requirement: Shared package is the schema home

The `packages/shared` workspace SHALL depend on Zod and SHALL be importable by every other workspace, providing the location for shared types and the Variant Definition schema.

#### Scenario: Apps and engine can import from shared

- **WHEN** any `apps/*` workspace or `packages/engine` imports an exported symbol from `packages/shared`
- **THEN** the import resolves and type-checks successfully across the workspace boundary

### Requirement: Shared TypeScript configuration

The repository SHALL provide a single strict base `tsconfig` that every workspace extends, so compiler settings are defined once and inherited consistently.

#### Scenario: Every workspace extends the base config

- **WHEN** each workspace's `tsconfig.json` is inspected
- **THEN** it extends the shared base `tsconfig` rather than redefining strictness/compiler options independently

#### Scenario: Strict type-checking is enforced

- **WHEN** `pnpm typecheck` is run at the repo root
- **THEN** TypeScript runs in strict mode across all workspaces and reports zero errors on the scaffold

### Requirement: Root workspace commands

The root `package.json` SHALL expose Turborepo-orchestrated commands — `build`, `typecheck`, `lint`, `test`, and `dev` — that fan out across the workspaces.

#### Scenario: Workspace-wide checks pass on the scaffold

- **WHEN** `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` are each run at the repo root
- **THEN** each command runs across all relevant workspaces and completes successfully

#### Scenario: Test runner is wired for the engine

- **WHEN** `pnpm test` is run
- **THEN** the configured test runner executes in `packages/engine` (even if only a placeholder test exists) and reports a passing result
