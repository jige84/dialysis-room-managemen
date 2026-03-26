/**
 * 护士透析录入时间限制中间件
 * 来源：medical-domain-rules §8 + security-rbac-rules §3
 * 责任护士只能录入当班日期，历史记录修改须联系管理员
 */
const restrictNurseEditTime = (req, res, next) => {
  if (req.user.role !== 'nurse') return next();

  const rawDate = req.body.session_date || req.body.dialysisDate || req.body.date;
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
