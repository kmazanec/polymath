# Build the Vite static bundle and serve it from nginx. Build context is the
# repo root (workspace packages are needed at build time).

FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/contract/package.json packages/contract/
COPY packages/booleans/package.json packages/booleans/
COPY packages/statechart/package.json packages/statechart/
COPY apps/agent/package.json apps/agent/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @polymath/web...
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
# PostHog config is read via import.meta.env, which Vite INLINES at BUILD time — so it
# must be present as a build ARG here or the deployed bundle silently lacks it. Both are
# optional (blank => PostHog fails closed to a no-op at runtime). Pass via
# `docker build --build-arg VITE_POSTHOG_KEY=… --build-arg VITE_POSTHOG_HOST=…` (or the
# compose `web.build.args`).
ARG VITE_POSTHOG_KEY=
ARG VITE_POSTHOG_HOST=
ENV VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY
ENV VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST
RUN pnpm --filter @polymath/web build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
# SPA fallback so client-side routes resolve to index.html.
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location / {\n    try_files $uri /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80

# --------------------------------------------------------------------------
# Dev target: the Vite dev server (HMR) instead of the static nginx bundle.
# Selected by docker-compose.override.yml so the full Caddy stack on :8080 hot-
# reloads. NOT used in production (compose.prod.yaml builds the default `runtime`
# stage). Source is bind-mounted by the override; this image only needs deps + the
# vite binary. It reuses the `build` stage (deps already installed) and runs vite
# on :80 so Caddy's `reverse_proxy web:80` reaches it unchanged. HMR is configured
# in vite.config.ts (clientPort 8080) so the browser's HMR websocket goes back
# through Caddy on the published host port.
# --------------------------------------------------------------------------
FROM build AS dev
WORKDIR /app/apps/web
EXPOSE 80
CMD ["pnpm", "exec", "vite", "--host", "0.0.0.0", "--port", "80"]
