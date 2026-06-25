## ADDED Requirements

### Requirement: Pull-request quality gate

The repository SHALL include a GitHub Actions workflow that runs the workspace quality gate — `lint`, `typecheck`, `test`, and `build` — on every pull request and on pushes to `main`, failing the workflow if any check fails.

#### Scenario: Checks run on pull requests

- **WHEN** a pull request is opened or updated
- **THEN** the workflow runs `lint`, `typecheck`, `test`, and `build` across the workspace and reports a status that fails if any check fails

#### Scenario: Workflow uses the pinned toolchain

- **WHEN** the workflow sets up its environment
- **THEN** it installs pnpm at the version from `packageManager`, uses Node 22, and runs `pnpm install --frozen-lockfile`

### Requirement: Build and dependency caching

The CI workflow SHALL cache pnpm dependencies and Turborepo build artifacts so that unchanged work is not recomputed on every run.

#### Scenario: Caching is configured

- **WHEN** the workflow is inspected
- **THEN** it caches the pnpm store and Turborepo's cache keyed appropriately, so reruns reuse unchanged results

### Requirement: Checks-only scope

The CI introduced by this change SHALL run quality checks only and SHALL NOT perform deployments.

#### Scenario: No deploy steps are present

- **WHEN** the CI workflow is inspected
- **THEN** it contains no steps that deploy to Vercel, Fly.io, or any other host
