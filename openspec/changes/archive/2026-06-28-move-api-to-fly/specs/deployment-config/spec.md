## MODIFIED Requirements

### Requirement: Vercel deploy descriptors

The Vercel-hosted app (`apps/web`) SHALL include a `vercel.json` deploy descriptor
configured for the monorepo, defining the build and install behavior for that app
rooted at its workspace directory, for deployment as a Vercel project. `apps/api`
is **not** a Vercel app — it deploys to Fly.io (see _Fly.io deploy descriptors_).

#### Scenario: Web app has a descriptor

- **WHEN** `apps/web` is inspected
- **THEN** it contains a `vercel.json` describing its install and build for
  deployment as a Vercel project

#### Scenario: API is not a Vercel app

- **WHEN** `apps/api` is inspected
- **THEN** it contains no `vercel.json` and no Vercel serverless function entry —
  the API's deploy descriptor is its Fly `fly.toml` + `Dockerfile`

### Requirement: Fly.io deploy descriptors

The Fly.io-hosted services (`apps/match`, `apps/bots`, `apps/api`) SHALL each
include a `fly.toml` and a production `Dockerfile` capable of building the service
from the monorepo and running it on Node 22.

#### Scenario: Each Fly service has a descriptor and Dockerfile

- **WHEN** `apps/match`, `apps/bots`, and `apps/api` are inspected
- **THEN** each contains a `fly.toml` and a multi-stage production `Dockerfile` that
  builds the service from the workspace and runs it on Node 22

#### Scenario: Dockerfile builds the service

- **WHEN** the production `Dockerfile` for a Fly service is built
- **THEN** the image builds successfully and its entry runs the service
