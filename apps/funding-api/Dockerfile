FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare yarn@4.9.4 --activate

COPY package.json yarn.lock .yarnrc.yml tsconfig.json tsconfig.build.json ./
COPY apps ./apps
COPY packages ./packages

RUN yarn install --immutable
RUN yarn build

FROM node:22-bookworm-slim AS runner

ARG FUNDING_PLATFORM_ENV=production

ENV NODE_ENV=production
ENV FUNDING_PLATFORM_ENV=${FUNDING_PLATFORM_ENV}
ENV FUNDING_API_PORT=3333

WORKDIR /app

RUN corepack enable && corepack prepare yarn@4.9.4 --activate

COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/funding-api/package.json ./apps/funding-api/package.json
COPY packages/funding-core/package.json ./packages/funding-core/package.json
COPY packages/funding-models/package.json ./packages/funding-models/package.json

RUN yarn workspaces focus @openg7/funding-api --production

COPY --from=builder /app/dist/apps/funding-api ./dist/apps/funding-api
COPY --from=builder /app/dist/packages/funding-core ./dist/packages/funding-core
COPY scripts/operations-watch.mjs ./scripts/operations-watch.mjs
COPY scripts/operations-health.mjs ./scripts/operations-health.mjs

EXPOSE 3333

# These named volumes mount here; Docker gives a freshly created
# volume the ownership of whatever already exists at that path in the image,
# so this must be created and chowned before USER node switches away from
# root. Rehearsal records are private synthetic test data, separate from media.
RUN mkdir -p /app/var/sponsor-logos /app/var/preflight-rehearsals \
    && chown -R node:node /app/var/sponsor-logos /app/var/preflight-rehearsals \
    && chmod 0700 /app/var/preflight-rehearsals

USER node

CMD ["node", "dist/apps/funding-api/src/main.js"]
