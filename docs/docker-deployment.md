# Docker deployment

This setup runs the Angular frontend behind Nginx and proxies `/api` to the Node funding API.

## Local production smoke test

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:8080`.

## Production notes

- Put real Stripe values in `.env`.
- Point your domain to the server.
- Put a TLS reverse proxy in front of port `8080`, or change the compose port to `80:80` and terminate TLS with Nginx, Caddy, Traefik, or an OVH/load-balancer layer.
- Configure Stripe webhooks to `https://your-domain.example/api/stripe/webhook`.
- Set `FUNDING_ALLOWED_ORIGINS` to your production domains.
