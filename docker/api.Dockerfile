FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci

COPY packages ./packages
COPY apps/api ./apps/api
COPY scripts ./scripts

RUN npm run build:shared \
  && cd apps/api \
  && npx prisma generate --schema prisma/schema.sqlite.prisma \
  && npm run build

COPY docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
RUN chmod +x /usr/local/bin/api-entrypoint.sh

WORKDIR /app/apps/api

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL=file:/data/dev.db \
    UPLOAD_DIR=/data/uploads

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/api-entrypoint.sh"]
