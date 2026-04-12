/**
 * 透析准备数据聚合（处方 + 当日医嘱）
 * 主要作用：在打开某次透析录入前，一次性返回当前有效处方与当日应执行医嘱。
 * 主要功能：数据库联查；过滤频次与日期；供透析路由减少前端多次请求。
 */
const { pool } = require('../config/database');
const { formatDate } = require('../utils/dateUtils');

/** 与库内枚举、前端下拉一致；去首尾空白/大小写，避免 switch 落空导致透析用药不同步 */
function normalizeOrderFrequency(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, '_');
  return s;
}

function normalizeOrderType(raw) {
  if (raw == null || raw === '') return '';
  return String(raw).trim().toLowerCase();
}

/**
 * 「每透析日」医嘱：护士正在透析录入即视为本次透析，不应因排班表某日未录入而隐藏（仍保留其他频次的排班日对齐）。
 */
function isEverySessionDialysisOrder(order) {
  return (
    normalizeOrderType(order.order_type) === 'dialysis_drug' &&
    normalizeOrderFrequency(order.frequency) === 'every_session'
  );
}

/**
 * 透析录入「今日医嘱执行确认」仅同步「透析用药」：与长期医嘱页约定一致，
 * qd/bid/tid 且用法为口服/随餐/睡前者应在「间期用药」维护，不在床旁栏同步。
 * 注射/透析专用途径 + qd 等仍保留（如床旁注射类医嘱）。
 */
function isHomeOralStyleRoute(routeRaw) {
  const route = routeRaw != null ? String(routeRaw).trim() : '';
  if (!route) return false;
  return /^口服(\s|$)/.test(route) || route.includes('随餐') || route.includes('睡前');
}

/**
 * @param {object} order long_term_orders 行
 * @returns {boolean} 是否应进入透析 prepare 的 ordersToday（在 order_type 已限定为 dialysis_drug 时调用）
 */
function shouldIncludeDialysisDrugForBedside(order) {
  if (normalizeOrderType(order.order_type) !== 'dialysis_drug') return true;
  const freq = normalizeOrderFrequency(order.frequency);
  if (!['qd', 'bid', 'tid'].includes(freq)) return true;
  if (!isHomeOralStyleRoute(order.route)) return true;
  return false;
}

/**
 * 组合子药若父医嘱未进入列表，则子药也不应单独出现在床旁确认区。
 * @param {Array<object>} rows 已构建的 ordersToday 行（含 id / parent_order_id）
 */
function dropOrphanComboChildren(rows) {
  const idSet = new Set(rows.map((r) => String(r.id)));
  return rows.filter((r) => {
    const pid = r.parent_order_id;
    if (pid == null || pid === '') return true;
    return idSet.has(String(pid));
  });
}

class OrderAutoFill {
  /**
   * 患者是否已有任意排班记录（用于判断是否启用「仅排班透析日」规则）
   */
  async patientHasAnySchedule(patientId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM schedules WHERE patient_id = $1 LIMIT 1`,
      [patientId],
    );
    return rows.length > 0;
  }

  /**
   * 指定日期是否有有效上机排班（非取消）
   */
  async hasDialysisScheduleOnDate(patientId, sessionDate) {
    const { rows } = await pool.query(
      `SELECT 1 FROM schedules
       WHERE patient_id = $1
         AND scheduled_date = $2::date
         AND COALESCE(status, 'planned') <> 'cancelled'
       LIMIT 1`,
      [patientId, sessionDate],
    );
    return rows.length > 0;
  }

  /**
   * 为某次透析准备数据（自动带入处方+医嘱）
   * @param {string} patientId 患者ID
   * @param {string} sessionDate 透析日期（YYYY-MM-DD）
   * @returns {{ prescription, ordersToday }}
   */
  /**
   * @param {object} [options]
   * @param {string[]} [options.orderTypes] 仅纳入指定医嘱类型；不传则包含全部类型（如 today-tasks 全量）
   */
  async prepareForDialysis(patientId, sessionDate, options = {}) {
    const { orderTypes = null } = options;
    const date = sessionDate || formatDate(new Date());

    // 获取当前有效处方
    const { rows: rxRows } = await pool.query(
      `SELECT * FROM prescriptions WHERE patient_id = $1 AND is_current = true LIMIT 1`,
      [patientId]
    );
    const prescription = rxRows[0] || null;

    const { rows: patStationRows } = await pool.query(
      `SELECT machine_station FROM patients WHERE id = $1 LIMIT 1`,
      [patientId],
    );
    const machine_station =
      patStationRows[0]?.machine_station != null && String(patStationRows[0].machine_station).trim()
        ? String(patStationRows[0].machine_station).trim()
        : null;

    const usesSchedules = await this.patientHasAnySchedule(patientId);
    const onDialysisScheduleDate = usesSchedules
      ? await this.hasDialysisScheduleOnDate(patientId, date)
      : true;

    // 获取当前有效医嘱（含今日应执行的）
    const { rows: orders } = await pool.query(
      `SELECT lto.*, u.real_name as ordered_by_name
       FROM long_term_orders lto
       LEFT JOIN users u ON lto.ordered_by = u.id
       WHERE lto.patient_id = $1
         AND lto.status = 'active'
         AND lto.valid_from <= $2
         AND (lto.valid_until IS NULL OR lto.valid_until >= $2)
       ORDER BY lto.order_type, lto.created_at`,
      [patientId, date]
    );

    // 判断哪些医嘱今日应执行
    const ordersToday = [];
    for (const order of orders) {
      if (Array.isArray(orderTypes) && orderTypes.length > 0) {
        const ot = normalizeOrderType(order.order_type);
        const allowed = orderTypes.some((t) => normalizeOrderType(t) === ot);
        if (!allowed) continue;
      }
      if (!shouldIncludeDialysisDrugForBedside(order)) continue;
      const shouldExecute = await this.shouldExecuteToday(order, date, patientId, prescription);
      if (!shouldExecute) continue;
      const otNorm = normalizeOrderType(order.order_type);
      if (otNorm === 'dialysis_drug' && usesSchedules && !onDialysisScheduleDate) {
        if (!isEverySessionDialysisOrder(order)) continue;
      }
      // 检查是否已执行过（同一天）
      const { rows: execRows } = await pool.query(
        `SELECT id FROM order_executions
         WHERE long_term_order_id = $1 AND execution_date = $2`,
        [order.id, date],
      );
      ordersToday.push({
        ...order,
        alreadyExecuted: execRows.length > 0,
        executionId: execRows[0]?.id || null,
      });
    }

    let ordersTodayFiltered = dropOrphanComboChildren(ordersToday);

    /**
     * 若按频次筛选后为空，但库内仍有「当日有效期内」的透析用药：全部带出并标记 syncFallback，
     * 避免长期医嘱页有药、床旁确认区空白（常见于周几/频次与排班未对齐、或历史脏数据）。
     * 仍仅限 orderTypes 含 dialysis_drug 时的主查询结果。
     */
    if (ordersTodayFiltered.length === 0) {
      for (const order of orders) {
        if (Array.isArray(orderTypes) && orderTypes.length > 0) {
          const ot = normalizeOrderType(order.order_type);
          const allowed = orderTypes.some((t) => normalizeOrderType(t) === ot);
          if (!allowed) continue;
        }
        if (normalizeOrderType(order.order_type) !== 'dialysis_drug') continue;
        if (!shouldIncludeDialysisDrugForBedside(order)) continue;
        if (usesSchedules && !onDialysisScheduleDate && !isEverySessionDialysisOrder(order)) continue;
        const { rows: execRows } = await pool.query(
          `SELECT id FROM order_executions
           WHERE long_term_order_id = $1 AND execution_date = $2::date`,
          [order.id, date],
        );
        ordersTodayFiltered.push({
          ...order,
          alreadyExecuted: execRows.length > 0,
          executionId: execRows[0]?.id || null,
          syncFallback: true,
        });
      }
      ordersTodayFiltered = dropOrphanComboChildren(ordersTodayFiltered);
    }

    return {
      prescription,
      ordersToday: ordersTodayFiltered,
      orders_today: ordersTodayFiltered,
      machine_station,
    };
  }

  /**
   * 透析用药 qw 未指定周几时：按自然周内是否已有执行记录判断（与 date_trunc('week') 一致，周一起算）
   */
  async hasDialysisQwExecutionThisWeek(longTermOrderId, sessionDate) {
    const { rows } = await pool.query(
      `SELECT 1 FROM order_executions
       WHERE long_term_order_id = $1
         AND execution_date >= date_trunc('week', $2::timestamp)::date
         AND execution_date < (date_trunc('week', $2::timestamp)::date + interval '7 days')
         AND status IN ('executed', 'modified')
       LIMIT 1`,
      [longTermOrderId, sessionDate]
    );
    return rows.length > 0;
  }

  /**
   * 判断某医嘱在 sessionDate 是否应出现在透析确认列表
   * @param {object} order 医嘱对象
   * @param {string} date YYYY-MM-DD
   * @param {object|null} [prescription] 当前有效处方（用于 tiw 未填 detail 时按每周透析次数对齐）
   */
  async shouldExecuteToday(order, date, patientId, prescription = null) {
    const { frequency_detail } = order;
    const frequency = normalizeOrderFrequency(order.frequency);
    const dayOfWeek = new Date(`${date}T12:00:00`).getDay(); // 本地中午，避免 UTC 边界导致周几错位
    const perWeekRaw = prescription?.frequency_per_week;
    const perWeek = perWeekRaw != null && perWeekRaw !== '' ? Number(perWeekRaw) : NaN;

    switch (frequency) {
      case 'every_session':
        return true;  // 每次透析都执行（是否与「排班日」一致由 prepareForDialysis 外层筛选）

      case 'qd':
        return true;  // 每日执行

      case 'tiw': {
        // 每周3次（通常周一/三/五 或 周二/四/六）；未填 detail 时可按处方每周透析次数近似对齐
        const tiw135 = [1, 3, 5];
        const tiw246 = [2, 4, 6];
        const tiwMode = frequency_detail != null ? String(frequency_detail).trim() : '';
        if (tiwMode === '246') return tiw246.includes(dayOfWeek);
        if (tiwMode !== '') return tiw135.includes(dayOfWeek);
        if (Number.isFinite(perWeek) && perWeek === 2) {
          return [1, 4].includes(dayOfWeek);
        }
        if (Number.isFinite(perWeek) && perWeek === 1) {
          return dayOfWeek === 1;
        }
        return tiw135.includes(dayOfWeek);
      }

      case 'biw': {
        // 每周2次；支持中英文逗号，过滤非法数字避免 [NaN] 导致永不为真
        const raw = frequency_detail != null ? String(frequency_detail).trim() : '';
        const biw = raw
          ? raw.split(/[,，]/).map((p) => Number(String(p).trim())).filter((n) => n >= 0 && n <= 6)
          : [1, 4];
        return biw.includes(dayOfWeek);
      }

      case 'qw': {
        // 每周1次。若未填写 frequency_detail，旧逻辑默认仅周一出现，与临床「每周一次在透析日执行」不符。
        const detailRaw = frequency_detail != null ? String(frequency_detail).trim() : '';
        const qwDayParsed = detailRaw === '' ? NaN : parseInt(detailRaw, 10);
        const hasPinnedWeekday = Number.isFinite(qwDayParsed) && qwDayParsed >= 0 && qwDayParsed <= 6;
        if (hasPinnedWeekday) {
          return dayOfWeek === qwDayParsed;
        }
        if (order.order_type === 'dialysis_drug') {
          const doneThisWeek = await this.hasDialysisQwExecutionThisWeek(order.id, date);
          return !doneThisWeek;
        }
        const qwDay = 1;
        return dayOfWeek === qwDay;
      }

      case 'q2w': {
        // 每两周1次，通过计算从开始日期的周次判断
        const startDate = new Date(order.valid_from);
        const target = new Date(`${date}T12:00:00`);
        const weeksDiff = Math.floor((target - startDate) / (7 * 86400000));
        if (!Number.isFinite(weeksDiff)) return false;
        const targetDay = parseInt(String(frequency_detail ?? '').trim(), 10);
        const day = Number.isFinite(targetDay) && targetDay >= 0 && targetDay <= 6 ? targetDay : 1;
        return weeksDiff % 2 === 0 && dayOfWeek === day;
      }

      case 'qm': {
        // 每月1次
        const qmDate = parseInt(frequency_detail) || 1;
        return new Date(date).getDate() === qmDate;
      }

      case 'bid':
        return true;  // 每日两次（当透析日时执行透析相关剂量）

      case 'tid':
        return true;  // 每日三次（透析日于床旁确认一次）

      case 'custom':
        // 自定义频次，需要人工判断，默认显示但标记为"需确认"
        return true;

      default:
        // 未知/历史脏数据：透析用药仍出现在床旁确认列表，避免与长期医嘱页「有效」不一致
        return normalizeOrderType(order.order_type) === 'dialysis_drug';
    }
  }
}

module.exports = new OrderAutoFill();
