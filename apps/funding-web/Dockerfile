FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare yarn@4.9.4 --activate

COPY package.json yarn.lock .yarnrc.yml tsconfig.json tsconfig.build.json angular.json ./
COPY apps ./apps
COPY packages ./packages

RUN yarn install --immutable
RUN yarn workspace @openg7/funding-web build

FROM nginx:1.27-alpine AS runner

COPY apps/funding-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/apps/funding-web/browser /usr/share/nginx/html

EXPOSE 80
