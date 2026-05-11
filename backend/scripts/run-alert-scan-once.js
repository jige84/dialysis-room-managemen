'use strict';
/**
 * 手动执行一次预警引擎（与 POST /api/alerts/run-checks 等价的数据库效果）。
 * 用法（在 backend 目录）：node scripts/run-alert-scan-once.js
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const AlertEngine = require('../src/services/AlertEngine');

AlertEngine.runAll()
  .then((r) => {
    console.log('runAll OK:', r);
    process.exit(0);
  })
  .catch((e) => {
    console.error('runAll FAIL:', e);
    process.exit(1);
  });
