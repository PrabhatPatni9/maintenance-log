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

/** Shed-scoped supervisor tier or above — everything under /admin except
 * Users and the Dashboard, which are RequireSuperAdmin instead. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const allowed = user?.role === 'admin' || user?.role === 'super_admin';

  useEffect(() => {
    if (!loading && !allowed) void navigate({ to: '/' });
  }, [loading, allowed, navigate]);

  const t = useT();
  if (loading) return <p className="meta">{t('common.loading')}</p>;
  if (!allowed) return null;
  return <>{children}</>;
}

/** Everyone except a utility-only operator (isUtility but not isOperator) —
 * mirrors the server-side check in logs.ts's POST /. Bouncing them to Home
 * rather than a dead end if they land here directly. */
export function RequireMaintenanceAccess({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const allowed = Boolean(user?.isOperator);

  useEffect(() => {
    if (!loading && !allowed) void navigate({ to: '/' });
  }, [loading, allowed, navigate]);

  const t = useT();
  if (loading) return <p className="meta">{t('common.loading')}</p>;
  if (!allowed) return null;
  return <>{children}</>;
}

/** Everyone except a pure maintenance operator (isOperator but not
 * isUtility) — mirrors the server-side check in meter-readings.ts's POST /.
 * Bouncing them to Home rather than a dead end if they land here directly. */
export function RequireUtilityAccess({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const allowed = Boolean(user?.isUtility);

  useEffect(() => {
    if (!loading && !allowed) void navigate({ to: '/' });
  }, [loading, allowed, navigate]);

  const t = useT();
  if (loading) return <p className="meta">{t('common.loading')}</p>;
  if (!allowed) return null;
  return <>{children}</>;
}

/** Owner tier only — account management and the cross-shed dashboard. */
export function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const allowed = user?.role === 'super_admin';

  useEffect(() => {
    if (!loading && !allowed) void navigate({ to: '/' });
  }, [loading, allowed, navigate]);

  const t = useT();
  if (loading) return <p className="meta">{t('common.loading')}</p>;
  if (!allowed) return null;
  return <>{children}</>;
}
