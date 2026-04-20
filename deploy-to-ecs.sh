#!/bin/bash
# 血液透析系统自动部署脚本
# 用于部署到阿里云 ECS

set -e  # 遇到错误立即退出

echo "=========================================="
echo "  血液透析系统 - 自动部署脚本"
echo "=========================================="

# 配置变量
APP_DIR="/opt/hemodialysis"
BACKUP_DIR="/opt/backups"
LOG_FILE="/var/log/hemodialysis-deploy.log"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# 检查是否为root用户
if [ "$EUID" -ne 0 ]; then
    error "请使用 root 用户运行此脚本"
fi

# 创建必要的目录
mkdir -p $APP_DIR $BACKUP_DIR

# 1. 系统更新和依赖安装
echo ""
log "步骤 1/8: 更新系统并安装依赖..."
apt-get update -qq
apt-get install -y -qq curl wget git nginx postgresql postgresql-contrib redis-server

# 2. 安装 Node.js 20
echo ""
log "步骤 2/8: 安装 Node.js 20..."
if ! command -v node &> /dev/null || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" != "20" ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
fi
node -v
npm -v

# 3. 安装 PM2
echo ""
log "步骤 3/8: 安装 PM2 进程管理器..."
npm install -g pm2

# 4. 数据库配置
echo ""
log "步骤 4/8: 配置 PostgreSQL..."
systemctl start postgresql
systemctl enable postgresql

# 创建数据库和用户（如果不存在）
sudo -u postgres psql << EOF
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_user WHERE usename = 'hd_app') THEN
        CREATE USER hd_app WITH PASSWORD '840611';
    END IF;
END
\$\$;

SELECT 'CREATE DATABASE hemodialysis_db OWNER hd_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'hemodialysis_db')\gexec

GRANT ALL PRIVILEGES ON DATABASE hemodialysis_db TO hd_app;
EOF

log "数据库配置完成"

# 5. 配置 Redis
echo ""
log "步骤 5/8: 配置 Redis..."
systemctl start redis-server
systemctl enable redis-server
log "Redis 已启动"

# 6. 备份现有部署（如果存在）
echo ""
if [ -d "$APP_DIR/backend" ]; then
    log "步骤 6/8: 备份现有部署..."
    BACKUP_NAME="backup-$(date +%Y%m%d-%H%M%S).tar.gz"
    tar -czf $BACKUP_DIR/$BACKUP_NAME -C $APP_DIR .
    log "备份已创建: $BACKUP_DIR/$BACKUP_NAME"
else
    log "步骤 6/8: 首次部署，跳过备份..."
fi

# 7. 部署后端
echo ""
log "步骤 7/8: 部署后端服务..."

# 克隆或更新代码（这里假设代码在 /opt/hemodialysis）
if [ ! -d "$APP_DIR/backend" ]; then
    log "请确保代码已上传到 $APP_DIR"
    mkdir -p $APP_DIR/backend
fi

cd $APP_DIR/backend

# 安装依赖
log "安装后端依赖..."
npm install --production

# 运行数据库迁移
log "执行数据库迁移..."
npm run migrate 2>/dev/null || warn "迁移命令未配置，请手动执行"

# 创建 PM2 配置文件
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'hemodialysis-backend',
    script: './src/server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3080
    },
    error_file: '/var/log/hemodialysis-err.log',
    out_file: '/var/log/hemodialysis-out.log',
    log_file: '/var/log/hemodialysis-combined.log',
    time: true,
    max_memory_restart: '1G',
    restart_delay: 3000,
    max_restarts: 5,
    min_uptime: '10s'
  }]
};
EOF

# 使用 PM2 启动/重启服务
pm2 delete hemodialysis-backend 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root

log "后端服务已启动"

# 8. 配置 Nginx
echo ""
log "步骤 8/8: 配置 Nginx 反向代理..."

cat > /etc/nginx/sites-available/hemodialysis << 'EOF'
server {
    listen 80;
    server_name _;  # 接受所有域名

    client_max_body_size 50M;

    # 前端静态文件
    location / {
        root /opt/hemodialysis/frontend/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 代理
    location /api/ {
        proxy_pass http://localhost:3080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # 上传文件访问
    location /uploads/ {
        alias /opt/hemodialysis/backend/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# 启用站点
ln -sf /etc/nginx/sites-available/hemodialysis /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# 测试并重载 Nginx
nginx -t && systemctl reload nginx

log "Nginx 配置完成"

# 部署完成
echo ""
echo "=========================================="
echo -e "${GREEN}  部署完成！${NC}"
echo "=========================================="
echo ""
echo "服务状态:"
echo "  - 后端 API: http://47.114.111.216/api"
echo "  - 前端页面: http://47.114.111.216"
echo "  - PM2 状态: pm2 status"
echo ""
echo "常用命令:"
echo "  查看日志: pm2 logs hemodialysis-backend"
echo "  重启服务: pm2 restart hemodialysis-backend"
echo "  查看状态: pm2 status"
echo "  系统监控: pm2 monit"
echo ""
echo "备份位置: $BACKUP_DIR"
echo "日志位置: /var/log/hemodialysis-*.log"
echo "=========================================="
