/**
 * 感染监控管理路由
 * - 感染筛查（HBV/HCV/HIV/TP，每半年一次）
 * - 感染监测月报（CRBSI计算基础数据）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const auth = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { success, created, error, notFound } = require('../utils/response');

// ── 感染筛查 ──────────────────────────────────────────────

// GET /api/infection/screenings/:patientId - 某患者筛查历史
router.get('/screenings/:patientId', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT is2.*, u.real_name as entered_by_name
       FROM infection_screenings is2
       LEFT JOIN users u ON is2.entered_by = u.id
       WHERE is2.patient_id = $1
       ORDER BY is2.screen_date DESC`,
      [req.params.patientId]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/infection/screenings/:patientId/latest - 最新各项筛查结果
router.get('/screenings/:patientId/latest', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (screen_type)
         id, screen_type, screen_date, result, notes
       FROM infection_screenings
       WHERE patient_id = $1
       ORDER BY screen_type, screen_date DESC`,
      [req.params.patientId]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// GET /api/infection/screenings/overdue - 全科到期筛查患者列表
router.get('/screenings/overdue', auth, rbac(['admin','head_nurse']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `WITH latest AS (
         SELECT DISTINCT ON (is2.patient_id, is2.screen_type)
           p.id as patient_id, p.name, is2.screen_type, is2.screen_date,
           is2.result,
           EXTRACT(DAY FROM NOW() - is2.screen_date) as days_since
         FROM patients p
         LEFT JOIN infection_screenings is2 ON is2.patient_id = p.id
         WHERE p.status = 'active'
         ORDER BY is2.patient_id, is2.screen_type, is2.screen_date DESC
       )
       SELECT * FROM latest WHERE days_since > 166 OR screen_date IS NULL
       ORDER BY days_since DESC NULLS FIRST`
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/infection/screenings/:patientId - 录入筛查结果（支持批量）
router.post('/screenings/:patientId', auth, async (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    if (items.length === 0) return error(res, '请提供筛查数据');

    const results = [];
    for (const item of items) {
      const { screen_type, result, screen_date, notes } = item;
      if (!screen_type || !result) continue;

      const { rows } = await pool.query(
        `INSERT INTO infection_screenings
           (patient_id, screen_type, result, screen_date, notes, entered_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.params.patientId, screen_type, result,
         screen_date || new Date().toISOString().slice(0, 10),
         notes, req.user.id]
      );
      results.push(rows[0]);

      // 如果HBV/HCV阳性，自动更新患者隔离区
      if ((screen_type === 'hbsag' || screen_type === 'hcv') && result === 'positive') {
        const zone = screen_type === 'hbsag' ? 'hbv' : 'hcv';
        await pool.query(
          `UPDATE patients SET isolation_zone = $1 WHERE id = $2 AND isolation_zone = 'normal'`,
          [zone, req.params.patientId]
        );
      }
    }

    return created(res, results, `${results.length}条筛查结果已录入`);
  } catch (err) { next(err); }
});

// ── 感染监测月报（CVC/CRBSI数据） ─────────────────────────

// GET /api/infection/monitoring/:year/:month - 获取月度监测报告
router.get('/monitoring/:year/:month', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT im.*, va.location, va.access_type, p.name as patient_name
       FROM infection_monitoring im
       JOIN vascular_accesses va ON im.access_id = va.id
       JOIN patients p ON im.patient_id = p.id
       WHERE im.monitor_year = $1 AND im.monitor_month = $2
       ORDER BY im.catheter_days DESC`,
      [parseInt(req.params.year), parseInt(req.params.month)]
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/infection/monitoring - 录入或更新月度导管天数
router.post('/monitoring', auth, rbac(['admin','head_nurse','nurse']), async (req, res, next) => {
  try {
    const {
      patient_id, access_id, monitor_year, monitor_month,
      catheter_days, infection_status, notes,
    } = req.body;

    if (!patient_id || !access_id || !monitor_year || !monitor_month) {
      return error(res, '患者、通路ID和月份为必填项');
    }

    const { rows } = await pool.query(
      `INSERT INTO infection_monitoring
         (patient_id, access_id, monitor_year, monitor_month,
          catheter_days, infection_status, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (patient_id, access_id, monitor_year, monitor_month)
       DO UPDATE SET catheter_days = $5, infection_status = $6,
                     notes = $7, updated_at = NOW()
       RETURNING *`,
      [patient_id, access_id, monitor_year, monitor_month,
       catheter_days || 0, infection_status || 'none', notes, req.user.id]
    );
    return created(res, rows[0], '感染监测数据已保存');
  } catch (err) { next(err); }
});

// POST /api/infection/monitoring/batch - 批量导入月度导管日数据
router.post('/monitoring/batch', auth, rbac(['admin','head_nurse']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { year, month, records } = req.body;
    if (!records || !Array.isArray(records)) return error(res, 'records 字段为数组');

    let count = 0;
    for (const r of records) {
      await client.query(
        `INSERT INTO infection_monitoring
           (patient_id, access_id, monitor_year, monitor_month,
            catheter_days, infection_status, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (patient_id, access_id, monitor_year, monitor_month)
         DO UPDATE SET catheter_days = $5, updated_at = NOW()`,
        [r.patient_id, r.access_id, year, month,
         r.catheter_days || 0, r.infection_status || 'none', req.user.id]
      );
      count++;
    }
    await client.query('COMMIT');
    return success(res, { count }, `已录入 ${count} 条导管日记录`);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// GET /api/infection/buttonhole-monitoring - 扣眼穿刺周监测记录
router.get('/buttonhole-monitoring', auth, async (req, res, next) => {
  try {
    const { patient_id, start_date, end_date } = req.query;
    const conditions = ['va.is_buttonhole = true'];
    const params = [];
    let idx = 1;

    if (patient_id) { conditions.push(`im.patient_id = $${idx++}`); params.push(patient_id); }
    if (start_date) { conditions.push(`im.monitor_date >= $${idx++}`); params.push(start_date); }
    if (end_date)   { conditions.push(`im.monitor_date <= $${idx++}`); params.push(end_date); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT im.*, p.name as patient_name, va.location
       FROM infection_monitoring im
       JOIN patients p ON im.patient_id = p.id
       JOIN vascular_accesses va ON im.access_id = va.id
       ${where}
       ORDER BY im.monitor_date DESC
       LIMIT 200`,
      params
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

module.exports = router;
