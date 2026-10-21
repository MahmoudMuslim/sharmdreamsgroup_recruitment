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
# Inlined into the client bundle at build time, so they must be present HERE and
# not at runtime. Both are already public — the URL ships to every browser and
# the anon key is a tokenless-role key — but neither may be read from the host's
# `.env.local`, which is why `.dockerignore` excludes it and docker/.env carries
# the two values instead.
ARG NEXT_PUBLIC_SUPABASE_URL=""
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=""
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
# `prebuild` runs scripts/check-staff-routes.mjs and scripts/check-themes.mjs,
# which is why `scripts` survives .dockerignore. `.next/cache` is the
# incremental build cache: dead weight in an image, and `next start` never reads
# it, so it is deleted in this stage rather than copied into the next one.
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
USER node
EXPOSE 3000
# node as PID 1, not `npm run start`: npm forwards SIGTERM only after its own
# grace period, and Compose's stop timeout would kill in-flight requests.
CMD ["node", "./node_modules/next/dist/bin/next", "start"]
