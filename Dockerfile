# syntax=docker/dockerfile:1
#
# Ship's Log — multi-stage image (mirrors the DA-RAG VPS deployment pattern).
#
#   stage 1 (builder): full `npm ci`, build the SPA (npm run build:ui → dist/ui).
#   stage 2 (runtime):  slim node:20, prod deps only + the `tsx` loader, the
#                       server source, the built SPA, and the bundled demo dataset.
#
# The server is run directly from TypeScript by `tsx` (there is no separate server
# compile step — `npm start` === `tsx src/server/index.ts`), so the runtime image
# ships `src/` and the `tsx` runner rather than transpiled JS.
#
# RUNTIME LAYOUT IS LOAD-BEARING: the entry (src/server/index.ts) resolves the
# repo root as `../..` from src/server and reads `<root>/demo` and `<root>/dist/ui`.
# Everything therefore lives under /app with that exact shape preserved:
#   /app/src/server/index.ts  →  /app/demo  and  /app/dist/ui
#
# Native deps (`sharp`, `@node-rs/argon2`) resolve their platform-specific
# optional packages (@img/sharp-linux-*, @node-rs/argon2-linux-*) at install time.
# Because the install runs INSIDE this linux image, the correct linux binaries are
# fetched for the build platform — the host's darwin-arm64 binaries are excluded
# by .dockerignore and never copied in.

# ----------------------------------------------------------------------------
# Stage 1 — builder: install everything and build the SPA bundle.
# ----------------------------------------------------------------------------
FROM node:20-bookworm AS builder
WORKDIR /app

# Install all deps (incl. dev: vite, react, typescript) against the lockfile.
# Cache mount keeps the npm cache warm across builds without bloating layers.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Bring in the sources needed to build the SPA. The server TS is copied too so a
# single context covers both; only what the runtime needs is carried to stage 2.
COPY tsconfig.json tsconfig.ui.json ./
COPY src ./src

# Build the SPA → /app/dist/ui (vite config emits there; see src/ui/vite.config.ts).
RUN npm run build:ui

# ----------------------------------------------------------------------------
# Stage 2 — runtime: slim image with prod deps + tsx, the server, the SPA, demo.
# ----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# `git` is REQUIRED at runtime: the git layer (simple-git) shells out to the git
# binary to clone the data repo on boot and to commit/pull/push (P2 sync). The
# slim image omits it, so install it. `ca-certificates` lets HTTPS clones verify
# certs; `openssh-client` lets SSH (deploy-key) clones/pushes work.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates openssh-client \
 && rm -rf /var/lib/apt/lists/*

# Production dependencies only (drops vite/react/typescript/etc.), then add `tsx`
# as the runtime TS loader. `tsx` lives in devDependencies, so `npm ci --omit=dev`
# drops it. It is installed pinned and GLOBALLY (`-g` → /usr/local/bin/tsx): a
# local `--no-save` install gets pruned in NODE_ENV=production (npm treats the
# un-saved package as dev and drops it from the production tree), whereas a global
# install is immune to that pruning, lands tsx on PATH, and never mutates
# package.json or the lockfile. esbuild (tsx's native dep) resolves the correct
# linux binary because this install runs inside the image.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev \
 && npm install -g tsx@4.22.4 \
 && npm cache clean --force

# Server + shared data-layer source (run directly by tsx). The UI source is NOT
# needed at runtime — only its built output (copied below).
COPY tsconfig.json ./
COPY src/server ./src/server
COPY src/data ./src/data

# The built SPA and the bundled demo dataset, placed at the exact paths the entry
# resolves relative to import.meta.url (../.. from src/server → /app).
COPY --from=builder /app/dist/ui ./dist/ui
COPY demo ./demo

# The users store defaults to /app/var/users.json (USERS_PATH). Create the dir so
# a first boot can write it even before the named volume is populated; in
# production this path is a mounted volume (see docker-compose.yml).
RUN mkdir -p /app/var \
 && chown -R node:node /app/var

# Drop to the unprivileged `node` user baked into the official image.
USER node

EXPOSE 8080

# `npm start` === `tsx src/server/index.ts`. Invoke the globally-installed `tsx`
# on PATH (NOT `npx`, which would try to fetch tsx from the network at boot on a
# locked-down VPS). tsx is a node shebang script, so PID 1 is node — clean signal
# handling.
CMD ["tsx", "src/server/index.ts"]
