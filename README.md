# 涉县善谷医院血液透析室管理系统

基于 React 19 + Node.js + PostgreSQL 的透析室全流程数字化管理平台。

---

## 快速启动（开发环境）

### 前置条件

- Node.js 20+ 已安装
- PostgreSQL 16 已安装并运行
- Redis 7（生产建议必配，用于 JWT 黑名单/缓存；不可用时会降级）

### 数据库初始化

```bash
# 创建数据库
psql -U postgres -c "CREATE DATABASE hemodialysis_db;"

# 进入后端目录
cd backend

# 复制配置文件并填写实际密码
cp .env.example .env

# 运行数据库迁移（按 scripts 与 migrations 持续演进数据库对象）
node src/utils/runMigrations.js

# 初始化管理员账号
node src/utils/initAdminUser.js
```

### 启动服务

```bash
# 后端（开发模式）
cd backend
npm install
npm run dev
# ➜ 默认监听 http://localhost:3080

# 前端（新终端）
cd frontend
npm install
npm run dev
# ➜ 监听 http://localhost:5173
```

### 初始登录账号


| 账号       | 密码          | 角色         |
| -------- | ----------- | ---------- |
| renjige  | Shangu@2026 | 系统管理员（科主任） |
| yangchen | Shangu@2026 | 护士长        |


---

## 最新发布状态（2026-04-16）

- 发布分支：`master`
- 状态：**已完成上线前闭环，当前判定可上线**
- 已完成事项：
  - 关键门禁通过：后端 `auth-chain` / `rbac-matrix` / `smoke-readiness`，前端 `lint` / `build`
  - 历史敏感文件清理完成（患者数据目录与部署 zip 已从 Git 历史移除）
  - 安全修复已落地（JWT 算法固定、审计日志敏感字段脱敏、Redis 降级 fallback、种子密码改环境变量等）
- 审计留档：
  - `docs/qa/release-hardening/generated/history-cleanup-and-release-closure-2026-04-16.md`

## 生产环境部署

### 前置条件

- **服务器要求**：Ubuntu 20.04+ / CentOS 8+ / Windows Server 2019+
- **Node.js**：20.0+ LTS
- **PostgreSQL**：16+
- **Redis**：7+（生产必配，用于 JWT 黑名单与缓存）
- **Nginx**：1.20+（反向代理）
- **PM2**：5.0+（进程管理）
- **SSL证书**：生产环境必须配置HTTPS

### 生产环境配置

#### 1. 数据库和Redis设置

```bash
# 创建生产数据库
sudo -u postgres psql
CREATE DATABASE hemodialysis_db;
CREATE USER hd_app WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE hemodialysis_db TO hd_app;
\q

# Redis安装（Ubuntu/Debian）
sudo apt update && sudo apt install redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server

# 设置Redis密码（生产必配）
sudo nano /etc/redis/redis.conf
# 添加：requirepass your_redis_password
sudo systemctl restart redis-server
```

#### 2. 应用部署

```bash
# 创建部署目录
sudo mkdir -p /opt/hemodialysis
sudo chown -R $USER:$USER /opt/hemodialysis
cd /opt/hemodialysis

# 克隆代码（或上传文件）
git clone <repository-url> .
# 或上传dist文件到此目录

# 后端部署
cd backend
npm ci --production  # 生产环境安装依赖

# 配置环境变量
cp .env.example .env
nano .env  # 编辑生产配置
```

#### 3. 生产环境变量配置

```bash
# .env 生产配置示例
NODE_ENV=production
PORT=3080

# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_NAME=hemodialysis_db
DB_USER=hd_app
DB_PASSWORD=your_secure_db_password
DB_POOL_MAX=20

# Redis配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# JWT配置（生产环境使用强密钥）
JWT_SECRET=your_64_byte_hex_jwt_secret_here
JWT_EXPIRES_IN=8h

# 数据加密密钥
ENCRYPT_KEY=your_32_byte_hex_encrypt_key_here

# 文件上传配置
UPLOAD_PATH=/opt/hemodialysis/uploads
MAX_FILE_SIZE=10485760

# 日志配置
LOG_LEVEL=info
LOG_FILE=/opt/hemodialysis/logs/app.log
```

#### 4. 数据库迁移

```bash
# 运行数据库迁移
cd /opt/hemodialysis/backend
node src/utils/runMigrations.js

# 初始化管理员用户
node src/utils/initAdminUser.js
```

#### 5. 前端构建和部署

```bash
cd /opt/hemodialysis/frontend
npm ci
npm run build

# 构建产物在 dist/ 目录
# 复制到Nginx服务目录
sudo cp -r dist/* /var/www/hemodialysis/
```

#### 6. PM2进程管理

```bash
# 全局安装PM2
sudo npm install -g pm2

# 启动后端服务
cd /opt/hemodialysis/backend
pm2 start ecosystem.config.js --env production

# 保存PM2配置
pm2 save
pm2 startup

# 查看状态
pm2 status
pm2 logs hd-backend
```

#### 7. Nginx反向代理配置

```nginx
# /etc/nginx/sites-available/hemodialysis
server {
    listen 80;
    server_name your-domain.com;
    
    # 重定向到HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    # SSL配置
    ssl_certificate /path/to/ssl/cert.pem;
    ssl_certificate_key /path/to/ssl/private.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    
    # 前端静态文件
    root /var/www/hemodialysis;
    index index.html;
    
    # API代理到后端
    location /api/ {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # 前端路由处理
    location / {
        try_files $uri $uri/ /index.html;
        
        # 缓存设置
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
    
    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    
    # 日志
    access_log /var/log/nginx/hemodialysis_access.log;
    error_log /var/log/nginx/hemodialysis_error.log;
}
```

#### 8. 防火墙和安全配置

```bash
# UFW防火墙（Ubuntu）
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

# SELinux（CentOS/RHEL）
sudo setsebool -P httpd_can_network_connect 1
```

### 监控和维护

#### 日志管理

```bash
# PM2日志轮转
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7

# Nginx日志轮转
sudo nano /etc/logrotate.d/nginx
# 添加配置...
```

#### 备份策略

```bash
# 数据库备份脚本
#!/bin/bash
BACKUP_DIR="/opt/hemodialysis/backups"
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -U hd_app -h localhost hemodialysis_db > $BACKUP_DIR/db_backup_$DATE.sql

# 文件备份
tar -czf $BACKUP_DIR/uploads_backup_$DATE.tar.gz /opt/hemodialysis/uploads/

# 保留7天备份
find $BACKUP_DIR -name "*.sql" -mtime +7 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete
```

#### 健康检查

```bash
# PM2监控
pm2 monit

# 应用健康检查端点
curl http://localhost:3080/health

# 数据库连接检查
psql -U hd_app -d hemodialysis_db -c "SELECT 1;"
```

### 升级部署流程

1. **备份数据**
  ```bash
   # 停止服务
   pm2 stop hd-backend

   # 备份数据库和文件
   ./backup.sh
  ```
2. **更新代码**
  ```bash
   cd /opt/hemodialysis
   git pull origin master

   # 或上传新版本文件
  ```
3. **更新依赖和构建**
  ```bash
   cd backend && npm ci --production
   cd ../frontend && npm ci && npm run build
  ```
4. **运行迁移**
  ```bash
   cd backend
   node src/utils/runMigrations.js
  ```
5. **重启服务**
  ```bash
   pm2 restart hd-backend
   sudo systemctl reload nginx
  ```
6. **验证部署**
  ```bash
   # 检查服务状态
   pm2 status
   curl -k https://your-domain.com/health
  ```

### 故障排除

#### 常见问题

- **数据库连接失败**：检查PostgreSQL服务状态和连接参数
- **Redis连接失败**：系统会自动降级，但建议配置Redis以提升性能
- **文件上传失败**：检查上传目录权限和磁盘空间
- **内存不足**：调整PM2的max_memory_restart参数

#### 性能优化

- 数据库连接池大小根据服务器配置调整
- 启用Redis缓存以提升响应速度
- 配置Nginx的gzip压缩
- 定期清理日志和临时文件

---

## 功能实现状态

### ✅ P0 核心功能（已完成）

- **用户认证**：JWT 登录/登出，bcrypt 密码哈希，账号锁定
- **角色权限**：RBAC 中间件（admin / head_nurse / nurse / doctor / quality；兼容历史 qc 账号）
- **患者档案**：CRUD、状态管理、隔离区分区、手机/身份证 AES-256 加密
- **透析记录录入**：Kt/V 自动计算（Daugirdas II）、UF 量/UF% 计算
- **首页仪表盘**：今日透析统计、患者总数、通路类型分布
- **审计日志**：所有写操作自动记录（写入人、IP、新值）

### ✅ P1 功能（已完成）

#### 医生处方端

- **透析处方管理**：查看/开立/归档，干体重专项更新
- **长期医嘱**：开立、修改（停旧开新）、停嘱、护士执行确认
- **医嘱自动预填**：`OrderAutoFill.js` 根据处方和医嘱自动预填透析录入单

#### 检验结果管理

- 批量录入各项化验指标（血红蛋白、血钾、PTH 等12项）
- 自动比对目标范围，标注异常/危急值
- 危急值确认工作流
- 最新指标卡片总览

#### 预警中心

- `AlertEngine.js` 自动扫描5类预警：
  - 感染筛查（HBV/HCV/HIV/TP）到期提醒
  - 连续2次 Kt/V < 1.2 提醒
  - 化验项目复查到期（各项目不同周期）
  - CVC 高风险评分提醒（≥6分）
  - 扣眼穿刺周监测提醒
- 每日凌晨6点自动运行（`node-cron`）
- Header 铃铛实时显示待处理数量

#### 质控报表（5项核心指标）

- 自动汇总：护患比、体外循环凝血率、漏血率、内瘘穿刺损伤率、CRBSI/千导管日
- 流程审批：草稿 → 护士长提交 → 科主任确认
- Excel 导出（ExcelJS）
- 历史趋势折线图

#### 血管通路管理

- AVF/AVG/NCC/TCC 统一管理
- CVC 感染风险评分（8项因素）
- 溶栓记录
- 超声随访数据录入
- 全科 CVC 患者风险总览

#### 感染监控

- 感染筛查录入（HBV/HCV/HIV/TP），阳性自动更新隔离区
- 筛查到期患者列表
- 月度导管日记录（CRBSI 计算基础数据）

### ✅ P2 增值功能（已完成）

#### 排班管理

- 三班次（AM/PM/EV）× 每周透析日设置
- 固定机号分配
- 今日/本周排班总览

#### 设备耗材管理

- 透析机状态管理（正常/维护/故障）
- 维护记录
- 水质检测记录（细菌计数、内毒素）
- 耗材库存管理（入库/出库/盘点，最低库存预警）

#### CQI 持续质量改进

- CQI 项目管理（计划→实施→总结）
- 不良事件/缺陷上报（支持匿名）
- 季度 CQI 会议自动提醒

#### 定时任务

- 每日6点：预警扫描
- 每月1号8点：质控报表草稿自动生成
- 每周一9点：季度 CQI 提醒（1/4/7/10月）

---

## 技术栈


| 层级  | 技术                                                          |
| --- | ----------------------------------------------------------- |
| 前端  | React 19 + TypeScript 5 + Ant Design 6 + Recharts + Zustand |
| 后端  | Node.js 20+ + Express 4 + node-cron                         |
| 数据库 | PostgreSQL 16（由迁移脚本持续演进）                                    |
| 缓存  | Redis 7（JWT 黑名单；生产建议必配）                                     |
| 安全  | JWT + bcrypt + AES-256-GCM                                  |
| 构建  | Vite 8                                                      |
| 部署  | PM2 + Nginx                                                 |


---

## 项目结构

```
xuetoushiguanli/
├── backend/
│   ├── migrations/          # SQL 迁移脚本（当前约 58 个）
│   ├── seeds/               # 初始数据
│   └── src/
│       ├── config/          # 数据库/Redis连接
│       ├── jobs/            # 定时任务（scheduledTasks.js）
│       ├── middleware/       # auth/rbac/audit/errorHandler
│       ├── routes/          # 业务路由模块（当前约 20+）
│       ├── services/        # KtvCalculator/CVCRiskScoring/AlertEngine/ReportGenerator
│       └── utils/           # encrypt/logger/dateUtils/response
├── frontend/
│   └── src/
│       ├── api/             # Axios API客户端（7个模块）
│       ├── components/      # AppLayout（含预警铃铛）
│       ├── pages/           # 功能页面（当前约 20+）
│       └── stores/          # authStore（Zustand）
└── README.md
```

