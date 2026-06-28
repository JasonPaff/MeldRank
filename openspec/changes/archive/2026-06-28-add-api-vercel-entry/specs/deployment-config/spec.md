## MODIFIED Requirements

### Requirement: Vercel deploy descriptors

The Vercel-hosted apps (`apps/web`, `apps/api`) SHALL each include a `vercel.json`
deploy descriptor configured for the monorepo, defining the build and install
behavior for that app rooted at its workspace directory. For `apps/api` — which is
served as a serverless function rather than a long-lived process — the descriptor
SHALL additionally configure the **serverless function entry** and the request
routing that maps the API's tRPC paths onto that function, and SHALL ensure the
`@meldrank/shared` workspace dependency is bundled for the function, so the deploy
artifact is the function (not the standalone `.listen()` server).

#### Scenario: Each Vercel app has a descriptor

- **WHEN** `apps/web` and `apps/api` are inspected
- **THEN** each contains a `vercel.json` describing its install and build for
  deployment as a separate Vercel project

#### Scenario: API descriptor configures the serverless function

- **WHEN** `apps/api/vercel.json` is inspected
- **THEN** it configures the serverless function entry and routes the API's tRPC
  paths to that function, and arranges for the `@meldrank/shared` workspace
  dependency to be bundled — rather than describing a build that emits no
  deployable artifact
