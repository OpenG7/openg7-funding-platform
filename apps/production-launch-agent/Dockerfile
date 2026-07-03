FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare yarn@4.9.4 --activate

COPY package.json yarn.lock .yarnrc.yml tsconfig.json tsconfig.build.json ./
COPY apps/production-launch-agent ./apps/production-launch-agent

RUN yarn install --immutable
RUN yarn workspace @openg7/production-launch-agent build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare yarn@4.9.4 --activate

COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/production-launch-agent/package.json ./apps/production-launch-agent/package.json
COPY --from=builder /app/dist/apps/production-launch-agent ./dist/apps/production-launch-agent
COPY apps/production-launch-agent/checklists ./apps/production-launch-agent/checklists
COPY apps/production-launch-agent/database/schema.sql ./apps/production-launch-agent/database/schema.sql

RUN yarn workspaces focus @openg7/production-launch-agent --production

USER node

CMD ["node", "dist/apps/production-launch-agent/src/index.js"]
