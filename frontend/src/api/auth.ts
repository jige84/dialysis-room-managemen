import request, { type ApiResponse } from './request';

export interface LoginParams {
  username: string;
  password: string;
}

export interface UserInfo {
  id: string;
  username: string;
  real_name: string;
  role: 'admin' | 'doctor' | 'nurse' | 'head_nurse' | 'qc';
}

export interface LoginResult {
  token: string;
  user: UserInfo;
}

export const authApi = {
  login: (params: LoginParams) =>
    request.post<ApiResponse<LoginResult>>('/auth/login', params),

  logout: () =>
    request.post<ApiResponse<null>>('/auth/logout'),

  changePassword: (old_password: string, new_password: string) =>
    request.post<ApiResponse<null>>('/auth/change-password', { old_password, new_password }),

  me: () =>
    request.get<ApiResponse<UserInfo>>('/auth/me'),
};
