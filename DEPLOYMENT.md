# Production deployment

The production Compose stack runs the Next.js app, its BullMQ worker, PostgreSQL, and Redis. PostgreSQL and Redis use named Docker volumes. The app binds to `127.0.0.1:3456` on the host and port `3000` in the container. The existing host Nginx remains responsible for HTTPS and proxies `image.cyanyi.com` to the app.

## Prepare the server

Use Ubuntu 24.04 with Docker Engine, the Docker Compose plugin, and the existing Nginx service. Create a dedicated deployment user with Docker access and a deployment directory at `/opt/cyanyi-drama`:

```bash
sudo adduser --disabled-password --gecos "" cyanyi-deploy
sudo usermod -aG docker cyanyi-deploy
sudo install -d -o cyanyi-deploy -g cyanyi-deploy /opt/cyanyi-drama /opt/actions-runner
```

```bash
sudo -iu cyanyi-deploy
git clone https://github.com/SexyAhri/Cyanyi-Drama.git /opt/cyanyi-drama
cd /opt/cyanyi-drama
cp env.production.example .env.production
chmod 600 .env.production
```

The repository is currently public, so the server can fetch it over HTTPS without a GitHub credential. If it is made private later, configure a read-only GitHub deploy key for `cyanyi-deploy` and switch the remote to SSH.

Set the production values in `.env.production`:

```bash
openssl rand -hex 32
```

`DOMAIN` is set to `image.cyanyi.com`. Set independent random values for `POSTGRES_PASSWORD` and `APP_SECRET`. The PostgreSQL password should be hexadecimal so it is safe in the connection URL. Keep `.env.production` on the server; Git ignores it.

The app uses the host port `3456` only on loopback. In the existing HTTPS Nginx server block for `image.cyanyi.com`, replace the current `location /` with the contents of [`deployment/nginx-location.conf`](deployment/nginx-location.conf). Keep the existing `listen` and certificate directives. Back up the current Nginx site configuration first, then run `nginx -t` and reload Nginx. This switches the hostname's application route away from its current service.

The origin certificate currently served by Nginx was observed to be expired. Renew or replace it before relying on Cloudflare **Full (strict)** mode. A Cloudflare Origin CA certificate or a renewed Let's Encrypt certificate can be installed in the existing Nginx TLS configuration. If Cloudflare proxying is enabled, keep its DNS record pointed at this server.

## Enable deploy-on-push

Install a GitHub Actions self-hosted runner in `/opt/actions-runner`, registered to this repository. In **Settings → Actions → Runners → New self-hosted runner**, follow GitHub's current Linux x64 instructions as `cyanyi-deploy` and configure the runner with the label `cyanyi-drama-prod`. GitHub provides a short-lived registration token and current download commands there; do not paste the token into chat. Run the runner as a service under `cyanyi-deploy`, not as root. That user needs read/write access to `/opt/cyanyi-drama`, permission to fetch the repository, and permission to run Docker Compose.

Keep the runner online as a service. Once the workflow is committed to `main`, every push to `main` runs `scripts/deploy-production.sh` locally on this server. GitHub does not need inbound SSH access to the server.

The first deployment can also be started manually from the server:

```bash
bash /opt/cyanyi-drama/scripts/deploy-production.sh
```

The script fetches `origin/main`, builds the app image, applies committed Prisma migrations, and starts the services. Do not use the development `docker-compose.yml` for production.

## Operations

```bash
docker compose --env-file .env.production -f compose.production.yml ps
docker compose --env-file .env.production -f compose.production.yml logs -f app worker
```

The database and Redis are not published on public host ports. Back up the `postgres_data` volume regularly; it contains account, project, workflow, settings, and media records.
