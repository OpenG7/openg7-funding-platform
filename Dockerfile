FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare yarn@4.9.4 --activate

ARG ANGULAR_CONFIGURATION=production

COPY package.json yarn.lock .yarnrc.yml tsconfig.json tsconfig.build.json angular.json ./
COPY apps ./apps
COPY packages ./packages

RUN yarn install --immutable
RUN yarn workspace @openg7/funding-web build --configuration "${ANGULAR_CONFIGURATION}"
RUN find dist/apps/funding-web/browser -type f \( -name "*.js" -o -name "*.css" -o -name "*.html" -o -name "*.svg" -o -name "*.json" \) -exec gzip -9 -k {} \;

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner

COPY apps/funding-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/apps/funding-web/browser /usr/share/nginx/html

EXPOSE 8080
