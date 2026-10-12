FROM node:22-bookworm-slim

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV COREPACK_HOME=/opt/corepack

RUN corepack enable \
    && corepack prepare pnpm@11.7.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm exec prisma generate \
    && APP_SECRET=build-only-placeholder pnpm build \
    && chown -R node:node /app

ENV NODE_ENV=production

USER node

EXPOSE 3000

CMD ["pnpm", "start"]
