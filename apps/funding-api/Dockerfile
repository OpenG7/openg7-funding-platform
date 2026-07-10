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

EXPOSE 3333

USER node

CMD ["node", "dist/apps/funding-api/src/main.js"]
