# Build the F-16 baseline Vite static bundle and serve it from nginx under
# /baseline/ (the SPA's Vite `base`). Build context is the repo root (workspace
# packages are needed at build time — @polymath/booleans, the shared validator).

FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/booleans/package.json packages/booleans/
COPY apps/baseline/package.json apps/baseline/
RUN pnpm install --frozen-lockfile --filter @polymath/baseline...
COPY tsconfig.base.json ./
COPY packages/booleans packages/booleans
COPY apps/baseline apps/baseline
RUN pnpm --filter @polymath/baseline build

FROM nginx:1.27-alpine AS runtime
# Vite builds with base=/baseline/, so the bundle's asset URLs are /baseline/...;
# serve the static files under that path. The SPA fallback resolves client routes.
COPY --from=build /app/apps/baseline/dist /usr/share/nginx/html/baseline
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location /baseline/ {\n    try_files $uri /baseline/index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
