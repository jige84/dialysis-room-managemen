/**
 * 解析前端请求的 API 基路径（getApiBaseUrl）
 * 主要作用：开发走 Vite 代理的相对路径 /api，生产避免把 localhost 写死在构建产物中。
 * 主要功能：读取 VITE_API_BASE_URL；生产环境跨机访问时拦截误配的 localhost 绝对地址。
 */
export function getApiBaseUrl(): string {
  const fallback = '/api';
  const env = import.meta.env.VITE_API_BASE_URL;
  if (env === undefined || env === '') return fallback;
  if (env.startsWith('/')) return env;

  if (import.meta.env.PROD && typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isPageLocal = host === 'localhost' || host === '127.0.0.1';
    if (!isPageLocal) {
      try {
        const u = new URL(env);
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
          return fallback;
        }
      } catch {
        return fallback;
      }
    }
  }

  return env;
}
