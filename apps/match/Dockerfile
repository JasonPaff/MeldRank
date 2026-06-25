# syntax=docker/dockerfile:1
# Multi-stage production image for the Match Service (Colyseus) on Node 22.
#
# Build context is the REPO ROOT so the whole pnpm workspace is available.
# Deploy from the repository root with:
#   fly deploy --config apps/match/fly.toml --dockerfile apps/match/Dockerfile
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
EXPOSE 2567
CMD ["pnpm", "--filter", "@meldrank/match", "start"]
