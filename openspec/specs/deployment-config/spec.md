# deployment-config Specification

## Purpose

Provide the per-app deploy descriptors for Vercel and Fly.io targets and a secret-free provisioning runbook so external resources and their environment variables can be reproduced manually.

## Requirements

### Requirement: Vercel deploy descriptors

The Vercel-hosted apps (`apps/web`, `apps/api`) SHALL each include a `vercel.json` deploy descriptor configured for the monorepo, defining the build and install behavior for that app rooted at its workspace directory.

#### Scenario: Each Vercel app has a descriptor

- **WHEN** `apps/web` and `apps/api` are inspected
- **THEN** each contains a `vercel.json` describing its install and build for deployment as a separate Vercel project

### Requirement: Fly.io deploy descriptors

The Fly.io-hosted services (`apps/match`, `apps/bots`) SHALL each include a `fly.toml` and a production `Dockerfile` capable of building the service from the monorepo and running it on Node 22.

#### Scenario: Each Fly service has a descriptor and Dockerfile

- **WHEN** `apps/match` and `apps/bots` are inspected
- **THEN** each contains a `fly.toml` and a multi-stage production `Dockerfile` that builds the service from the workspace and runs it on Node 22

#### Scenario: Dockerfile builds the service

- **WHEN** the production `Dockerfile` for a Fly service is built
- **THEN** the image builds successfully and its entry runs the service

### Requirement: Provisioning runbook

The repository SHALL include a provisioning runbook enumerating the external resources to create (Neon, Upstash, Clerk, Vercel projects, Fly apps) and the environment variables each populates, so manual provisioning is reproducible. The runbook SHALL NOT contain real secrets.

#### Scenario: Runbook maps resources to variables

- **WHEN** the provisioning runbook is read
- **THEN** it lists each external resource and the environment variables it provides, referencing `.env.example` for variable shape, and contains no real credentials
