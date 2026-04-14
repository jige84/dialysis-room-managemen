/**
 * 质控报表路由参数校验
 */

function validateYearMonthParams(params) {
  const year = parseInt(params?.year, 10);
  const month = parseInt(params?.month, 10);
  if (!year || month < 1 || month > 12) {
    return { ok: false, message: 'year、month 参数无效' };
  }
  return { ok: true, value: { year, month } };
}

function validateTrendYearsQuery(query) {
  const yearsRaw = query?.years;
  if (yearsRaw === undefined) {
    return { ok: true, value: { years: 2 } };
  }
  const years = parseInt(String(yearsRaw), 10);
  if (!Number.isFinite(years) || years < 1 || years > 10) {
    return { ok: false, message: 'years 参数无效（1-10）' };
  }
  return { ok: true, value: { years } };
}

module.exports = {
  validateYearMonthParams,
  validateTrendYearsQuery,
};

