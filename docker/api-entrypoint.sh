#!/bin/sh
set -e

mkdir -p /data/uploads

cd /app/apps/api

echo "[entrypoint] 同步数据库结构..."
npx prisma db push --schema prisma/schema.sqlite.prisma --skip-generate

if [ "${SEED_DEMO:-false}" = "true" ]; then
  echo "[entrypoint] 写入演示数据（若数据库已有数据会自动跳过）..."
  npx ts-node prisma/seed.ts || echo "[entrypoint] 种子数据写入失败，继续启动"
fi

echo "[entrypoint] 启动 API..."
exec node dist/main.js
