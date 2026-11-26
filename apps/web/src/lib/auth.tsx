import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, CurrentUser, refreshSession, setToken } from './api';

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  completeLogin: (accessToken: string, user: CurrentUser) => void;
  logout: () => Promise<void>;
  setUser: (user: CurrentUser | null) => void;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>(null as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    refreshSession().then((u) => {
      if (mounted) {
        setUser(u);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const completeLogin = useCallback((accessToken: string, nextUser: CurrentUser) => {
    setToken(accessToken);
    setUser(nextUser);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // 忽略登出接口异常，本地状态仍需清理
    }
    setToken(null);
    setUser(null);
  }, []);

  const reload = useCallback(async () => {
    try {
      const me = await api.get('/auth/me');
      setUser(me);
    } catch {
      // 保持当前状态
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, completeLogin, logout, setUser, reload }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
