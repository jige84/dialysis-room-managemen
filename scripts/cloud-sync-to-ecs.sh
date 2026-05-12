#!/usr/bin/env bash
# 从本机将仓库同步到 ECS（不经由 GitHub push）。
# 依赖：ssh、scp、tar；可选 sshpass（DEBIAN_FRONTEND=noninteractive 非交互密码，不推荐）
#
# 用法：
#   export ECS_SYNC_HOST=47.114.111.216
#   export ECS_SYNC_USER=root
#   export ECS_SYNC_REMOTE_PATH=/opt/hemodialysis   # 可选
#   ./scripts/cloud-sync-to-ecs.sh
#
# 或 source 本地配置（勿提交含密码的文件）：
#   cp scripts/cloud-sync-to-ecs.local.example.env scripts/cloud-sync-to-ecs.local.env
#   # 编辑后
#   set -a; source scripts/cloud-sync-to-ecs.local.env; set +a
#   ./scripts/cloud-sync-to-ecs.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${ECS_SYNC_HOST:-}"
USER="${ECS_SYNC_USER:-root}"
RPATH="${ECS_SYNC_REMOTE_PATH:-/opt/hemodialysis}"
LOCAL_ENV="$ROOT/scripts/cloud-sync-to-ecs.local.env"
if [[ -f "$LOCAL_ENV" ]]; then
  # shellcheck source=/dev/null
  set -a && source "$LOCAL_ENV" && set +a
fi
if [[ -z "$HOST" ]]; then
  echo "请设置 ECS_SYNC_HOST 或配置 scripts/cloud-sync-to-ecs.local.env" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/backend" "$STAGE/frontend"
rsync -a --delete \
  --exclude node_modules --exclude logs --exclude uploads --exclude .git \
  "$ROOT/backend/src/" "$STAGE/backend/src/"
rsync -a --delete \
  "$ROOT/backend/migrations/" "$STAGE/backend/migrations/"
for f in package.json package-lock.json ecosystem.config.js; do
  [[ -f "$ROOT/backend/$f" ]] && cp "$ROOT/backend/$f" "$STAGE/backend/"
done
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude .git \
  "$ROOT/frontend/src/" "$STAGE/frontend/src/"
[[ -d "$ROOT/frontend/public" ]] && rsync -a --delete "$ROOT/frontend/public/" "$STAGE/frontend/public/"
for f in package.json package-lock.json index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json; do
  [[ -f "$ROOT/frontend/$f" ]] && cp "$ROOT/frontend/$f" "$STAGE/frontend/" || true
done

TAR_LOCAL="$(mktemp /tmp/hemo-ecs-sync.XXXXXX.tar.gz)"
tar -czf "$TAR_LOCAL" -C "$STAGE" backend frontend
REMOTE_TAR="/tmp/hemo-ecs-sync-$(date +%Y%m%d%H%M%S).tar.gz"

scp -o StrictHostKeyChecking=accept-new "$TAR_LOCAL" "${USER}@${HOST}:${REMOTE_TAR}"
rm -f "$TAR_LOCAL"

ssh -o StrictHostKeyChecking=accept-new "${USER}@${HOST}" bash -s <<EOF
set -e
cd "$RPATH"
tar -xzf "$REMOTE_TAR"
rm -f "$REMOTE_TAR"
cd "$RPATH/backend"
npm install --omit=dev
npm run migrate
cd "$RPATH/frontend"
npm install
npm run build
cd "$RPATH/backend"
pm2 reload ecosystem.config.js --env production || pm2 restart hd-backend
nginx -t && systemctl reload nginx
curl -sS -m 10 -o /dev/null -w "health:%{http_code}\\n" http://127.0.0.1:3080/api/health || true
echo DONE
EOF

echo "=== 同步完成: http://${HOST}/ ==="
