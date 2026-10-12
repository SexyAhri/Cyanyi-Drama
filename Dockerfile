FROM node:22-bookworm-slim

LABEL org.opencontainers.image.source="https://github.com/SexyAhri/Cyanyi-Drama"

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV COREPACK_HOME=/opt/corepack

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
    && corepack prepare pnpm@11.7.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm exec prisma generate \
    && DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build APP_SECRET=build-only-placeholder pnpm build \
    && chown -R node:node /app

ENV NODE_ENV=production

USER node

EXPOSE 3000

CMD ["pnpm", "start"]
