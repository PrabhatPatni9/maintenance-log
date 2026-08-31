import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from './auth-context';
import { useT } from '../i18n';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) void navigate({ to: '/login' });
  }, [loading, user, navigate]);

  const t = useT();
  if (loading) return <p className="meta">{t('common.loading')}</p>;
  if (!user) return null;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) void navigate({ to: '/' });
  }, [loading, user, navigate]);

  const t = useT();
  if (loading) return <p className="meta">{t('common.loading')}</p>;
  if (!user || user.role !== 'admin') return null;
  return <>{children}</>;
}
