/**
 * 认证状态管理（Zustand）
 */
import { create } from 'zustand';
import { type UserInfo } from '../api/auth';

interface AuthState {
  token: string | null;
  user: UserInfo | null;
  isAuthenticated: boolean;
  login: (token: string, user: UserInfo) => void;
  logout: () => void;
  hasRole: (roles: string | string[]) => boolean;
}

const storedToken = localStorage.getItem('hd_token');
const storedUser = localStorage.getItem('hd_user');

export const useAuthStore = create<AuthState>((set, get) => ({
  token: storedToken,
  user: storedUser ? JSON.parse(storedUser) : null,
  isAuthenticated: !!storedToken,

  login: (token, user) => {
    localStorage.setItem('hd_token', token);
    localStorage.setItem('hd_user', JSON.stringify(user));
    set({ token, user, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem('hd_token');
    localStorage.removeItem('hd_user');
    set({ token: null, user: null, isAuthenticated: false });
  },

  hasRole: (roles) => {
    const user = get().user;
    if (!user) return false;
    if (user.role === 'admin') return true;
    const roleArr = Array.isArray(roles) ? roles : [roles];
    return roleArr.includes(user.role);
  },
}));
