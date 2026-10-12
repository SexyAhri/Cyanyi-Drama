#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ ! -f .env.production ]]; then
  echo "Missing .env.production. Copy env.production.example and set production values." >&2
  exit 1
fi

git fetch --prune origin +refs/heads/main:refs/remotes/origin/main
git reset --hard origin/main

compose=(docker compose --env-file .env.production -f compose.production.yml)
"${compose[@]}" build app
"${compose[@]}" run --rm migrate
"${compose[@]}" up -d --remove-orphans

echo "Production deployment completed at $(git rev-parse --short HEAD)."
