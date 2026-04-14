# 涉县善谷医院血液透析室管理系统

基于 React 19 + Node.js + PostgreSQL 的透析室全流程数字化管理平台。

---

## 快速启动（开发环境）

### 前置条件
- Node.js 20+ 已安装
- PostgreSQL 16 已安装并运行
- Redis 7（可选，用于 JWT 黑名单/缓存，不可用时系统仍可运行）

### 数据库初始化

```bash
# 创建数据库
psql -U postgres -c "CREATE DATABASE hemodialysis_db;"

# 进入后端目录
cd backend

# 复制配置文件并填写实际密码
cp .env.example .env

# 运行数据库迁移（创建26张数据表）
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

| 账号 | 密码 | 角色 |
|------|------|------|
| renjige | Shangu@2026 | 系统管理员（科主任） |
| yangchen | Shangu@2026 | 护士长 |

---

## 功能实现状态

### ✅ P0 核心功能（已完成）
- **用户认证**：JWT 登录/登出，bcrypt 密码哈希，账号锁定
- **角色权限**：RBAC 中间件（admin / head_nurse / nurse / doctor / qc）
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

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript 5 + Ant Design 6 + Recharts + Zustand |
| 后端 | Node.js 20+ + Express 4 + node-cron |
| 数据库 | PostgreSQL 16（由迁移脚本持续演进） |
| 缓存 | Redis 7（JWT 黑名单，可选） |
| 安全 | JWT + bcrypt + AES-256-GCM |
| 构建 | Vite 8 |
| 部署 | PM2 + Nginx |

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
