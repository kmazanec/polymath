# Multi-stage build for the Polymath agent service.
# Build context is the repo root (see docker-compose.yml) so the workspace
# packages the agent depends on (@polymath/contract, @polymath/booleans) are
# available. The agent and its deps export TypeScript source and run under tsx;
# compiling to JS is a later optimisation, not needed for the walking skeleton.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /app
# Copy manifests first for a cacheable install layer.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/contract/package.json packages/contract/
COPY packages/booleans/package.json packages/booleans/
COPY packages/statechart/package.json packages/statechart/
COPY packages/bkt/package.json packages/bkt/
COPY packages/graph/package.json packages/graph/
COPY apps/agent/package.json apps/agent/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @polymath/agent...

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/contract packages/contract
COPY packages/booleans packages/booleans
COPY packages/statechart packages/statechart
COPY packages/bkt packages/bkt
COPY packages/graph packages/graph
COPY apps/agent apps/agent
COPY lessons lessons
# seedTransferBank reads seed_data/transfer_items.json (repo root) at boot.
COPY seed_data seed_data
WORKDIR /app/apps/agent
EXPOSE 8080
# Migrations run on boot (index.ts calls runMigrations before listening).
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
