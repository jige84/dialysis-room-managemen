#!/bin/bash
# 血液透析系统 - 自动更新脚本
# 用于更新已部署在 ECS 上的系统

set -e  # 遇到错误立即退出

echo "=========================================="
echo "  血液透析系统 - 自动更新脚本"
echo "=========================================="

# 配置变量
APP_DIR="/opt/hemodialysis"
BACKUP_DIR="/opt/backups"
LOG_FILE="/var/log/hemodialysis-update.log"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[INFO]${NC} $1" | tee -a $LOG_FILE
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a $LOG_FILE
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a $LOG_FILE
    exit 1
}

step() {
    echo -e "${BLUE}[STEP]${NC} $1" | tee -a $LOG_FILE
}

# 检查是否为root用户
if [ "$EUID" -ne 0 ]; then
    error "请使用 root 用户运行此脚本"
fi

# 检查应用目录是否存在
if [ ! -d "$APP_DIR" ]; then
    error "应用目录不存在: $APP_DIR，请先执行首次部署"
fi

cd $APP_DIR

# 获取更新方式
UPDATE_MODE="${1:-code}"  # 默认更新代码

step "更新模式: $UPDATE_MODE"

# ==================== 步骤 1: 备份当前版本 ====================
echo ""
step "步骤 1/7: 备份当前版本..."

BACKUP_NAME="backup-before-update-${TIMESTAMP}.tar.gz"
mkdir -p $BACKUP_DIR

tar -czf $BACKUP_DIR/$BACKUP_NAME \
    --exclude='node_modules' \
    --exclude='logs' \
    --exclude='uploads' \
    -C $(dirname $APP_DIR) \
    $(basename $APP_DIR)

log "备份已创建: $BACKUP_DIR/$BACKUP_NAME"

# 备份数据库
log "备份数据库..."
sudo -u postgres pg_dump -U hd_app hemodialysis_db > $BACKUP_DIR/db-backup-${TIMESTAMP}.sql 2>/dev/null || warn "数据库备份失败，继续更新"

# ==================== 步骤 2: 获取最新代码 ====================
echo ""
step "步骤 2/7: 获取最新代码..."

if [ -d ".git" ]; then
    # 使用 git 拉取最新代码
    log "检测到 git 仓库，拉取最新代码..."
    git fetch origin
    git pull origin main || git pull origin master || warn "git pull 失败，使用本地代码"
else
    log "未检测到 git 仓库，跳过代码更新"
    log "如需更新代码，请手动上传新代码到 $APP_DIR"
fi

# ==================== 步骤 3: 更新依赖 ====================
echo ""
step "步骤 3/7: 更新依赖..."

cd $APP_DIR/backend

# 检查 package.json 是否有变化
if [ -f "package.json" ]; then
    log "安装/更新后端依赖..."
    npm install --production
fi

cd $APP_DIR/frontend

# 检查是否需要重新构建前端
if [ -f "package.json" ]; then
    if [ -d "node_modules" ]; then
        log "更新前端依赖..."
        npm install
    fi
    
    # 如果存在 src 目录，需要重新构建
    if [ -d "src" ]; then
        log "构建前端..."
        npm run build
    fi
fi

# ==================== 步骤 4: 执行数据库迁移 ====================
echo ""
step "步骤 4/7: 执行数据库迁移..."

cd $APP_DIR/backend

# 检查是否有新的迁移文件。默认 code 模式只更新功能代码，不触碰现有数据。
if [ "$UPDATE_MODE" = "migrate" ] || [ "$UPDATE_MODE" = "full" ]; then
    if [ -d "migrations" ]; then
        MIGRATION_COUNT=$(ls -1 migrations/*.sql 2>/dev/null | wc -l)
        log "发现 $MIGRATION_COUNT 个迁移文件"

        # 执行迁移（如果有迁移脚本）
        if [ -f "package.json" ] && grep -q "migrate" package.json; then
            log "执行数据库迁移..."
            npm run migrate || warn "数据库迁移失败，请手动检查"
        else
            log "未配置迁移命令，跳过"
        fi
    fi
else
    log "跳过数据库迁移（当前模式: $UPDATE_MODE；如需迁移请使用 migrate 或 full 模式）"
fi

# ==================== 步骤 5: 更新配置 ====================
echo ""
step "步骤 5/7: 更新配置..."

# 检查 .env.example 是否有更新
if [ -f ".env.example" ] && [ -f ".env" ]; then
    log "检查环境变量配置..."
    
    # 找出 .env.example 中有但 .env 中没有的变量
    NEW_VARS=$(comm -23 <(grep -o '^[A-Z_]*=' .env.example | sort) <(grep -o '^[A-Z_]*=' .env | sort))
    
    if [ ! -z "$NEW_VARS" ]; then
        warn "发现新的环境变量配置:"
        echo "$NEW_VARS"
        warn "请手动更新 .env 文件添加这些变量"
    fi
fi

# ==================== 步骤 6: 重启服务 ====================
echo ""
step "步骤 6/7: 重启服务..."

cd $APP_DIR/backend

# 使用 PM2 重启
if command -v pm2 &> /dev/null; then
    log "使用 PM2 重启服务..."
    
    # 检查是否有 ecosystem 配置
    if [ -f "ecosystem.config.js" ]; then
        pm2 reload ecosystem.config.js --env production || pm2 restart ecosystem.config.js
    else
        pm2 restart hemodialysis-backend || pm2 start ./src/server.js --name hemodialysis-backend
    fi
    
    pm2 save
    log "服务已重启"
else
    warn "PM2 未安装，尝试直接重启..."
    # 这里可以添加其他重启方式
fi

# 重载 Nginx
if systemctl is-active --quiet nginx; then
    log "重载 Nginx 配置..."
    nginx -t && systemctl reload nginx
fi

# ==================== 步骤 7: 验证更新 ====================
echo ""
step "步骤 7/7: 验证更新..."

sleep 3

# 检查服务状态
if command -v pm2 &> /dev/null; then
    pm2 status | tee -a $LOG_FILE
fi

# 测试 API 响应
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3080/api/health 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
    log "API 健康检查通过 (HTTP 200)"
else
    warn "API 健康检查失败 (HTTP $HTTP_STATUS)"
fi

# 显示最新日志
log "最新日志:"
tail -n 20 /var/log/hemodialysis-out.log 2>/dev/null || warn "无法读取日志"

# ==================== 完成 ====================
echo ""
echo "=========================================="
echo -e "${GREEN}  更新完成！${NC}"
echo "=========================================="
echo ""
echo "更新摘要:"
echo "  - 备份文件: $BACKUP_DIR/$BACKUP_NAME"
echo "  - 数据库备份: $BACKUP_DIR/db-backup-${TIMESTAMP}.sql"
echo "  - 更新时间: $(date)"
echo ""
echo "如果更新后出现问题，可以回滚:"
echo "  1. 停止当前服务: pm2 stop all"
echo "  2. 恢复备份: tar -xzf $BACKUP_DIR/$BACKUP_NAME -C /opt"
echo "  3. 重启服务: pm2 restart all"
echo ""
echo "查看日志:"
echo "  pm2 logs"
echo "  tail -f /var/log/hemodialysis-*.log"
echo "=========================================="
