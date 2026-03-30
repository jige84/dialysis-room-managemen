/**
 * Axios 单例与全局拦截器
 * 主要作用：统一后端请求基地址、超时与鉴权头，封装业务层使用的 request 实例。
 * 主要功能：请求头注入 JWT；401 清理 token 并跳转登录；网络/业务错误 message 提示。
 */
import axios, { type AxiosResponse } from 'axios';
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
    return response;
  },
  (error) => {
    const status = error.response?.status;
    const msg = error.response?.data?.message || '网络错误，请稍后重试';

    if (status === 401) {
      localStorage.removeItem('hd_token');
      localStorage.removeItem('hd_user');
      window.location.href = '/login';
    } else if (status === 403) {
      message.error('权限不足，无法执行此操作');
    } else if (status >= 500) {
      message.error('服务器错误，请联系管理员');
    } else {
      message.error(msg);
    }

    return Promise.reject(error);
  }
);

export default request;
