FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare yarn@4.9.4 --activate

COPY package.json yarn.lock .yarnrc.yml tsconfig.json tsconfig.build.json ./
COPY apps ./apps
COPY packages ./packages

RUN yarn install --immutable
RUN yarn workspace @openg7/production-launch-agent build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare yarn@4.9.4 --activate

COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/funding-api/package.json ./apps/funding-api/package.json
COPY apps/funding-web/package.json ./apps/funding-web/package.json
COPY apps/production-launch-agent/package.json ./apps/production-launch-agent/package.json
COPY packages/funding-core/package.json ./packages/funding-core/package.json
COPY packages/funding-i18n/package.json ./packages/funding-i18n/package.json
COPY packages/funding-models/package.json ./packages/funding-models/package.json
COPY packages/funding-ui/package.json ./packages/funding-ui/package.json
COPY --from=builder /app/dist/apps/production-launch-agent ./dist/apps/production-launch-agent
COPY apps/production-launch-agent/checklists ./apps/production-launch-agent/checklists
COPY apps/production-launch-agent/database/schema.sql ./apps/production-launch-agent/database/schema.sql

RUN yarn workspaces focus @openg7/production-launch-agent --production

ENV PLA_DATABASE_PATH=/data/production-launch-agent.sqlite
ENV PLA_REPORT_DIR=/logs/reports
RUN mkdir -p /data /logs/reports && chown -R node:node /data /logs

USER node

CMD ["node", "dist/apps/production-launch-agent/src/index.js"]
