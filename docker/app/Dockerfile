# syntax=docker/dockerfile:1

# The app image. `next build` runs in here and never on the host tree: this
# repo's `.next/` belongs to the owner's running dev server on port 3001, and a
# container build that wrote into it would serve them stale modules.
#
# Three stages, and the reason the runner copies the FULL node_modules rather
# than a `--omit=dev` install: `next start` re-reads `next.config.ts` at boot,
# which needs `typescript`, and `src/lib/auth/db.ts` needs `pg` — both are
# devDependencies today (Task 17 promotes `pg`). Copying the deps stage costs
# image bytes and costs nothing in correctness.
#
# Node 24.22.0 is the Active LTS line (Docker's `lts-alpine` alias still resolves
# to 24 while 26 is `current`), which is what a long-lived production container
# wants. Next 16.4 requires Node >= 20.9, so nothing here forces a newer major.

FROM node:24.22.0-alpine3.24 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24.22.0-alpine3.24 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No build-time inlining of anything vendor-facing: the client bundle's only
# origin is this stack's own, and it learns it at runtime from `APP_URL` (see
# src/lib/config.ts). spec §15's second fitness claim is that a clean image holds
# no trace of the hosted project, and the way to keep that true is to leave the
# arguments that would have carried it out of the file.
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
# `prebuild` runs scripts/check-staff-routes.mjs, scripts/check-themes.mjs and
# scripts/audit-secrets.mjs, which is why `scripts` survives .dockerignore.
# `.next/cache` is the incremental build cache: dead weight in an image, and
# `next start` never reads it, so it is deleted in this stage rather than copied
# into the next one.
RUN npm run build && rm -rf .next/cache .next/trace

FROM node:24.22.0-alpine3.24 AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# --chown, not a later `chown -R`: a separate chown layer re-writes every file
# it touches, which on node_modules means paying for the tree twice.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=node:node /app/next-env.d.ts ./next-env.d.ts
# Stored bytes live in the `uploads` volume at this exact path, and the directory
# has to exist in the IMAGE with node owning it: Docker seeds a fresh named
# volume from the image's target directory, so creating it here is what lets the
# app write after `USER node`. A `docker compose down -v` therefore costs an
# empty tree, not a permission error on the first upload.
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 3000
# node as PID 1, not `npm run start`: npm forwards SIGTERM only after its own
# grace period, and Compose's stop timeout would kill in-flight requests.
CMD ["node", "./node_modules/next/dist/bin/next", "start"]
