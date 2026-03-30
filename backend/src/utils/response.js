/**
 * HTTP JSON 响应统一封装
 * 主要作用：全 API 使用一致的 { code, data, message } 结构，便于前端拦截器处理。
 * 主要功能：success/created/paginated；error 系列与 401/403/404 快捷方法。
 */

const success = (res, data = null, message = '操作成功', statusCode = 200) => {
  return res.status(statusCode).json({ code: statusCode, data, message });
};

const created = (res, data = null, message = '创建成功') => {
  return res.status(201).json({ code: 201, data, message });
};

const paginated = (res, list, total, page, pageSize) => {
  return res.json({
    code: 200,
    data: { list, total, page: parseInt(page), pageSize: parseInt(pageSize) },
    message: '查询成功'
  });
};

const error = (res, message = '操作失败', statusCode = 400, data = null) => {
  return res.status(statusCode).json({ code: statusCode, data, message });
};

const unauthorized = (res, message = '未登录或Token已过期') => {
  return res.status(401).json({ code: 401, data: null, message });
};

const forbidden = (res, message = '权限不足') => {
  return res.status(403).json({ code: 403, data: null, message });
};

const notFound = (res, message = '记录不存在') => {
  return res.status(404).json({ code: 404, data: null, message });
};

const serverError = (res, message = '服务器内部错误') => {
  return res.status(500).json({ code: 500, data: null, message });
};

module.exports = { success, created, paginated, error, unauthorized, forbidden, notFound, serverError };
