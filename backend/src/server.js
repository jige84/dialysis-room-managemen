/**
 * 血液透析室管理系统 — 后端 HTTP 服务入口（Express）
 * 主要作用：启动 API 服务，串联安全中间件、认证授权与各业务路由。
 * 主要功能：Helmet/CORS/访问限速；挂载认证、患者、透析、处方、医嘱等 REST；注册定时任务；统一错误处理与日志。
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { testConnection } = require('./config/database');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const initScheduledTasks = require('./jobs/scheduledTasks');

// 路由
const authRouter          = require('./routes/auth');
const usersRouter         = require('./routes/users');
const patientsRouter      = require('./routes/patients');
const dialysisRouter      = require('./routes/dialysis');
const prescriptionsRouter = require('./routes/prescriptions');
const ordersRouter        = require('./routes/orders');
const labsRouter          = require('./routes/labs');
const alertsRouter        = require('./routes/alerts');
const reportsRouter       = require('./routes/reports');
const vascularRouter      = require('./routes/vascular');
const infectionRouter     = require('./routes/infection');
const scheduleRouter      = require('./routes/schedule');
const devicesRouter       = require('./routes/devices');
const cqiRouter           = require('./routes/cqi');
const aiRouter            = require('./routes/ai');
const knowledgeRouter     = require('./routes/knowledge');
const medicalSitesRouter  = require('./routes/medicalSites');
const guidelinesRouter    = require('./routes/guidelines');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

function parseCorsOrigins(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const configuredCorsOrigins = parseCorsOrigins(
  process.env.CORS_ORIGINS || process.env.APP_ORIGIN || '',
);

// ── 安全响应头（OWASP / nodebestpractices §6.6）────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"], // Ant Design 需要内联样式
      imgSrc:     ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      fontSrc:    ["'self'", 'data:'],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));

// ── CORS ────────────────────────────────────────────────────
app.use(cors({
  origin: isProduction
    ? (origin, callback) => {
        if (!origin) return callback(null, true);
        if (configuredCorsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('CORS origin not allowed'));
      }
    : true,
  credentials: true,
}));

// ── 速率限制（OWASP / nodebestpractices §6.2）───────────────

// 登录接口防暴力破解：15分钟内最多10次失败请求
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, data: null, message: '登录尝试过多，请15分钟后重试' },
});
app.use('/api/auth/login', loginLimiter);

// 全局限速：每分钟最多300次请求
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, data: null, message: '请求过于频繁，请稍后重试' },
});
app.use('/api/', globalLimiter);

// ── 患者敏感数据禁止缓存（OWASP）────────────────────────────
app.use('/api/patients', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

// ── 透析记录/准备数据含医嘱与处方摘要，禁止中间层/浏览器用 304 返回陈旧体 ──
app.use('/api/dialysis', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// ── 请求解析 ─────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) }
}));

// ── 静态文件（生产模式下服务前端构建产物）────────────────────
if (isProduction) {
  const staticPath = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(staticPath));
}

// ── 健康检查 ─────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ── API路由 ──────────────────────────────────────────────────
app.use('/api/auth',         authRouter);
app.use('/api/users',        usersRouter);
app.use('/api/patients',     patientsRouter);
app.use('/api/dialysis',     dialysisRouter);
app.use('/api/prescriptions',prescriptionsRouter);
app.use('/api/orders',       ordersRouter);
app.use('/api/labs',         labsRouter);
app.use('/api/vascular',     vascularRouter);
app.use('/api/infection',    infectionRouter);
app.use('/api/alerts',       alertsRouter);
app.use('/api/reports',      reportsRouter);
app.use('/api/schedule',     scheduleRouter);
app.use('/api/devices',      devicesRouter);
app.use('/api/cqi',          cqiRouter);
app.use('/api/ai',           aiRouter);
app.use('/api/knowledge',    knowledgeRouter);
app.use('/api/medical-sites', medicalSitesRouter);
app.use('/api/guidelines',   guidelinesRouter);

// ── SPA回退（生产模式）───────────────────────────────────────
if (isProduction) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
  });
}

// ── 全局错误处理 ─────────────────────────────────────────────
app.use(errorHandler);

// ── 启动服务 ─────────────────────────────────────────────────
async function startServer() {
  console.log('\n🏥 涉县善谷医院血液透析室管理系统');
  console.log('═══════════════════════════════════');

  const dbOk = await testConnection();
  if (!dbOk && isProduction) {
    console.error('❌ 数据库连接失败，生产环境不允许启动');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`✅ 服务已启动：http://localhost:${PORT}`);
    console.log(`📋 环境：${process.env.NODE_ENV || 'development'}`);
    console.log(`🔑 JWT过期时间：${process.env.JWT_EXPIRES_IN || '8h'}`);
    if (isProduction) {
      if (configuredCorsOrigins.length === 0) {
        console.warn('⚠️  生产环境未配置 CORS_ORIGINS，将只允许无 Origin 请求通过');
      } else {
        console.log(`🌐 CORS 白名单：${configuredCorsOrigins.join(', ')}`);
      }
    }
    if (!dbOk) {
      console.warn('⚠️  数据库暂未连接，请检查PostgreSQL配置');
    }
    if (dbOk) initScheduledTasks();
    console.log('═══════════════════════════════════\n');
  });
}

startServer().catch(err => {
  logger.error('服务启动失败：', err);
  process.exit(1);
});

module.exports = app;
