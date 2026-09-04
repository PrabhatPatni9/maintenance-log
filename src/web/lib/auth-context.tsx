import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Lang, Role } from '@shared/types';
import { api, ApiError } from './api';
import { deriveKeyB64 } from './crypto';
import { useLang } from '../i18n';

export interface CurrentUser {
  phone: string;
  name: string;
  role: Role;
  isOperator: boolean;
  isUtility: boolean;
  lang: Lang;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login(phone: string, password: string): Promise<void>;
  logout(): Promise<void>;
  updateName(name: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const { setLang } = useLang();

  useEffect(() => {
    api
      .get<{ user: CurrentUser }>('/me')
      .then((r) => {
        setUser(r.user);
        setLang(r.user.lang);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    // Only ever runs once on boot; setLang identity is stable from LangProvider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    const { salt } = await api.post<{ salt: string }>('/auth/salt', { phone });
    const derivedKey = await deriveKeyB64(password, salt);
    try {
      const { user: u } = await api.post<{ user: CurrentUser }>('/auth/login', { phone, derivedKey });
      setUser(u);
      setLang(u.lang);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) throw new Error('invalid credentials');
      throw err;
    }
  }, [setLang]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  const updateName = useCallback(async (name: string) => {
    const { user: u } = await api.patch<{ user: CurrentUser }>('/me', { name });
    setUser(u);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, updateName }),
    [user, loading, login, logout, updateName],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
