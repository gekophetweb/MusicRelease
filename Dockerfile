# syntax=docker/dockerfile:1
# One image, two containers: the website ("app") and the scheduler ("worker").

FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma's config reads DATABASE_URL; a placeholder is enough for generate/build (nothing connects).
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build

# ---- dependencies (incl. dev, needed to build) ----
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ---- build the website and bundle the worker ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build && npm run build:worker

# ---- Prisma CLI for `migrate deploy` at startup (kept apart from the app) ----
FROM base AS migrate
WORKDIR /migrate
COPY prisma.config.ts ./
COPY prisma ./prisma
# Keep this version equal to "prisma" in package.json.
RUN npm init -y >/dev/null \
 && npm install --omit=dev --no-audit --no-fund prisma@7.10.1 dotenv@18.0.10

# ---- runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=migrate --chown=node:node /migrate /migrate
COPY --chown=node:node docker/start-app.sh /usr/local/bin/start-app
USER node
EXPOSE 3000
CMD ["start-app"]
