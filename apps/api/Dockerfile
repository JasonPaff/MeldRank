# syntax=docker/dockerfile:1
# Multi-stage production image for the stateless tRPC API on Node 22. The container
# runs the service entry (`tsx src/index.ts`), which validates the environment,
# constructs the db/redis/lobby dependencies, and serves the tRPC `appRouter` over a
# long-lived HTTP server on PORT (3001) with the single-origin CORS policy.
#
# Build context is the REPO ROOT so the whole pnpm workspace — including the
# `@meldrank/shared` TS source the API imports — is available and `tsx` transpiles it
# at runtime. Deploy from the repository root with:
#   fly deploy --config apps/api/fly.toml --dockerfile apps/api/Dockerfile
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app

# --- deps: install the full workspace from the committed lockfile ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps ./apps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# --- runtime: slim image that runs the service entry ---
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app ./
EXPOSE 3001
CMD ["pnpm", "--filter", "@meldrank/api", "start"]
