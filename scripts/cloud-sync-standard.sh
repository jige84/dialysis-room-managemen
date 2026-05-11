#!/usr/bin/env bash
# 与 docs/云端更新标准流程.md 对齐：从 www 仓库同步到 /opt/hemodialysis 并重启服务
set -euo pipefail

echo "=== git pull ==="
cd /www/wwwroot/xuetoushiguanli
if [[ -n $(git status --porcelain 2>/dev/null) ]]; then
  git stash push -u -m "auto-before-deploy-$(date +%Y%m%d-%H%M%S)" || true
fi
git pull origin master

echo "=== rsync backend ==="
rsync -a /www/wwwroot/xuetoushiguanli/backend/src/ /opt/hemodialysis/backend/src/
rsync -a /www/wwwroot/xuetoushiguanli/backend/migrations/ /opt/hemodialysis/backend/migrations/
cp /www/wwwroot/xuetoushiguanli/backend/package.json /opt/hemodialysis/backend/package.json
cp /www/wwwroot/xuetoushiguanli/backend/package-lock.json /opt/hemodialysis/backend/package-lock.json

echo "=== backend deps + pm2 ==="
cd /opt/hemodialysis/backend
npm install --production
pm2 restart hd-backend

echo "=== frontend build ==="
cd /www/wwwroot/xuetoushiguanli/frontend
npm install
npx tsc -b
npx vite build --emptyOutDir=false

echo "=== rsync frontend dist ==="
mkdir -p /opt/hemodialysis/frontend/dist
rsync -a --delete --exclude='.user.ini' \
  /www/wwwroot/xuetoushiguanli/frontend/dist/ \
  /opt/hemodialysis/frontend/dist/

echo "=== nginx + health ==="
nginx -t
systemctl reload nginx
curl -sS -m 10 http://localhost:3080/health || true
echo ""
echo "DONE"
