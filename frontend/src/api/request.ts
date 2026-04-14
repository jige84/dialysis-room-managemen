/**
 * Axios 单例与全局拦截器
 * 主要作用：统一后端请求基地址、超时与鉴权头，封装业务层使用的 request 实例。
 * 主要功能：请求头注入 JWT；401 清理 token 并跳转登录；网络/业务错误 message 提示。
 */
import axios, { AxiosHeaders, type AxiosResponse } from 'axios';
import { message } from 'antd';
import { getApiBaseUrl } from '../config/apiBaseUrl';

export interface ApiResponse<T = unknown> {
  code: number;
  data: T;
  message: string;
}

export interface PagedData<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

const request = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// 请求拦截器：注入JWT Token
request.interceptors.request.use((config) => {
  const token = localStorage.getItem('hd_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // FormData 必须由浏览器设置 multipart boundary；默认的 application/json 会导致服务端收不到文件
  if (config.data instanceof FormData) {
    const headers = AxiosHeaders.from(config.headers);
    headers.delete('Content-Type');
    config.headers = headers;
  }
  return config;
});

// 响应拦截器：统一错误处理
request.interceptors.response.use(
  (response: AxiosResponse<ApiResponse>) => {
    const { data } = response;
    if (data.code === 401) {
      localStorage.removeItem('hd_token');
      localStorage.removeItem('hd_user');
      window.location.href = '/login';
      return Promise.reject(new Error('登录已过期'));
    }
    // HTTP 2xx 但 body 内业务码为失败（避免误判为成功）
    if (typeof data.code === 'number' && data.code >= 400) {
      const serverMsg = data.message || '请求失败';
      message.error(serverMsg);
      const wrapped = new Error(serverMsg) as Error & { status?: number };
      wrapped.status = response.status;
      return Promise.reject(wrapped);
    }
    return response;
  },
  (error) => {
    const isTimeout =
      error.code === 'ECONNABORTED' ||
      (typeof error.message === 'string' && /timeout/i.test(error.message));
    if (isTimeout && error.response === undefined) {
      const timeoutMsg = '请求超时，请稍后重试或缩小数据范围';
      message.error(timeoutMsg);
      const wrapped = new Error(timeoutMsg) as Error & { status?: number };
      wrapped.status = undefined;
      return Promise.reject(wrapped);
    }

    const status = error.response?.status;
    const data = error.response?.data as ApiResponse | undefined;
    const serverMsg = data?.message || '网络错误，请稍后重试';

    if (status === 401) {
      localStorage.removeItem('hd_token');
      localStorage.removeItem('hd_user');
      window.location.href = '/login';
    } else if (status === 403) {
      message.error('权限不足，无法执行此操作');
    } else if (status === 502) {
      const onLocalDevHost =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      if (onLocalDevHost) {
        message.error('后端服务不可达，请确认 backend 已启动（默认 http://localhost:3080）');
      } else {
        message.error('网关错误，请稍后重试');
      }
    } else if (status === 503) {
      // 常见于 AI 未配置或服务不可用，避免与「服务器内部故障」混淆
      message.warning(serverMsg);
    } else if (status !== undefined && status >= 500) {
      message.error('服务器错误，请联系管理员');
    } else {
      message.error(serverMsg);
    }

    // 让业务层拿到后端 message，而非 axios 默认的 "Request failed with status code XXX"
    const wrapped = new Error(serverMsg) as Error & { status?: number };
    wrapped.status = status;
    return Promise.reject(wrapped);
  }
);

export default request;
