/**
 * 长期医嘱自动带入服务
 * 透析录入页面打开时，自动加载当前处方和应执行的医嘱
 */
const { pool } = require('../config/database');

class OrderAutoFill {
  /**
   * 为某次透析准备数据（自动带入处方+医嘱）
   * @param {string} patientId 患者ID
   * @param {string} sessionDate 透析日期（YYYY-MM-DD）
   * @returns {{ prescription, ordersToday }}
   */
  async prepareForDialysis(patientId, sessionDate) {
    const date = sessionDate || new Date().toISOString().slice(0, 10);

    // 获取当前有效处方
    const { rows: rxRows } = await pool.query(
      `SELECT * FROM prescriptions WHERE patient_id = $1 AND is_current = true LIMIT 1`,
      [patientId]
    );
    const prescription = rxRows[0] || null;

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
      const shouldExecute = await this.shouldExecuteToday(order, date, patientId);
      if (shouldExecute) {
        // 检查是否已执行过（同一天）
        const { rows: execRows } = await pool.query(
          `SELECT id FROM order_executions
           WHERE long_term_order_id = $1 AND execution_date = $2`,
          [order.id, date]
        );
        ordersToday.push({
          ...order,
          alreadyExecuted: execRows.length > 0,
          executionId: execRows[0]?.id || null,
        });
      }
    }

    return { prescription, ordersToday };
  }

  /**
   * 判断某医嘱今日是否应执行
   * @param {object} order 医嘱对象
   * @param {string} date YYYY-MM-DD
   * @param {string} patientId 患者ID
   */
  async shouldExecuteToday(order, date, patientId) {
    const { frequency, frequency_detail } = order;
    const dayOfWeek = new Date(date).getDay(); // 0=周日, 1-6=周一至周六

    switch (frequency) {
      case 'every_session':
        return true;  // 每次透析都执行

      case 'qd':
        return true;  // 每日执行

      case 'tiw': {
        // 每周3次（通常周一/三/五 或 周二/四/六）
        const tiw135 = [1, 3, 5];
        const tiw246 = [2, 4, 6];
        if (frequency_detail === '246') return tiw246.includes(dayOfWeek);
        return tiw135.includes(dayOfWeek);
      }

      case 'biw': {
        // 每周2次
        const biw = frequency_detail ? frequency_detail.split(',').map(Number) : [1, 4];
        return biw.includes(dayOfWeek);
      }

      case 'qw': {
        // 每周1次
        const qwDay = parseInt(frequency_detail) || 1;
        return dayOfWeek === qwDay;
      }

      case 'q2w': {
        // 每两周1次，通过计算从开始日期的周次判断
        const startDate = new Date(order.valid_from);
        const target = new Date(date);
        const weeksDiff = Math.floor((target - startDate) / (7 * 86400000));
        const targetDay = parseInt(frequency_detail) || 1;
        return weeksDiff % 2 === 0 && dayOfWeek === targetDay;
      }

      case 'qm': {
        // 每月1次
        const qmDate = parseInt(frequency_detail) || 1;
        return new Date(date).getDate() === qmDate;
      }

      case 'bid':
        return true;  // 每日两次（当透析日时执行透析相关剂量）

      case 'custom':
        // 自定义频次，需要人工判断，默认显示但标记为"需确认"
        return true;

      default:
        return false;
    }
  }
}

module.exports = new OrderAutoFill();
