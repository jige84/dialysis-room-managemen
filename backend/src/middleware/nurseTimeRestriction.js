/**
 * 护士透析录入时间限制中间件
 * 主要作用：限制责任护士仅能提交「当班日期」的透析相关数据，防止越权改历史。
 * 主要功能：对 nurse 角色校验 session_date / dialysisDate；早于今日零点则 403；其他角色直接放行。
 */
const restrictNurseEditTime = (req, res, next) => {
  if (req.user.role !== 'nurse') return next();

  const rawDate = req.body.session_date || req.body.dialysisDate || req.body.date
    || req.body.assessed_at || req.body.puncture_date;
  if (!rawDate) return next();

  const recordDate = new Date(rawDate);
  recordDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (recordDate < today) {
    const err = new Error('责任护士只能录入今日透析记录，修改历史记录请联系管理员');
    err.statusCode = 403;
    err.isOperational = true;
    return next(err);
  }

  next();
};

module.exports = restrictNurseEditTime;
