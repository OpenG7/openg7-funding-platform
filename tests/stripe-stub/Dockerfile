FROM node:22-bookworm-slim

WORKDIR /app

COPY tests/stripe-stub/server.mjs ./server.mjs
COPY tests/stripe-stub/social.mjs ./social.mjs
COPY tests/stripe-stub/smtp-gate.mjs ./smtp-gate.mjs

EXPOSE 4242

CMD ["node", "server.mjs"]
