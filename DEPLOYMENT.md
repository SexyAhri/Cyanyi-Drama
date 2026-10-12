# Production deployment

GitHub Actions builds and publishes `ghcr.io/sexyahri/cyanyi-drama:latest` whenever code is pushed to `main`. The workflow uses GitHub-hosted runners; no Actions Runner is installed on the server. The production Compose project has its own PostgreSQL and Redis containers and named data volumes, so it does not take over the server's existing containers. Only the app is exposed, on `127.0.0.1:3456`.

## Publish the image

Wait for the **Build and publish production image** workflow to finish successfully. On the first publish, open the `cyanyi-drama` package under the GitHub account's Packages, then set **Package settings → Change visibility → Public** so the server can pull without registry credentials.

## Pull and run on the server

Keep `/opt/cyanyi-drama/.env.production` on the server with `DOMAIN=image.cyanyi.com`, a unique hexadecimal `POSTGRES_PASSWORD`, and a unique `APP_SECRET`. Then run:

```bash
cd /opt/cyanyi-drama
bash scripts/deploy-production.sh
```

The script updates the Compose files from `main`, pulls the published image, applies Prisma migrations, and starts the app and worker. Run the same command after a later image build to update the server.

The app listens on host loopback port `3456`. Once it is healthy, configure the existing Nginx HTTPS site for `image.cyanyi.com` to proxy to `127.0.0.1:3456` using [`deployment/nginx-location.conf`](deployment/nginx-location.conf). This replaces the current service at that hostname. Renew the origin TLS certificate before using Cloudflare Full (strict) mode; the certificate previously observed on the server was expired.

Useful commands:

```bash
docker compose --env-file .env.production -f compose.production.yml ps
docker compose --env-file .env.production -f compose.production.yml logs -f app worker
```

Back up the Compose project's `postgres_data` volume regularly. It contains the application's records and settings.
