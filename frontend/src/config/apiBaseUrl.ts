/**
 * 解析前端 API 基路径。
 * 生产环境应与页面同源（如 `/api`），由 Node 或 Nginx 反代到后端。
 * 若构建时误写入 `http://localhost:...`，从其他机器访问时会连到用户本机导致连接被拒绝。
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
