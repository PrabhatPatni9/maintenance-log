import { useEffect, useRef } from 'react';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useT } from '../../i18n';
import { useAuth } from '../../lib/auth-context';
import { RequireAdmin } from '../../lib/guards';

const TABS: { to: string; key: string; superAdminOnly?: boolean }[] = [
  { to: '/admin/dashboard', key: 'admin.dashboardTab' },
  { to: '/admin/sheds', key: 'admin.shedsTab' },
  { to: '/admin/machines', key: 'admin.machinesTab' },
  { to: '/admin/meters', key: 'admin.metersTab' },
  { to: '/admin/users', key: 'admin.usersTab' },
  { to: '/admin/taxonomy', key: 'admin.taxonomyTab' },
  { to: '/admin/history', key: 'admin.historyTab' },
  { to: '/admin/webhooks', key: 'admin.webhooksTab', superAdminOnly: true },
];

function AdminShellInner() {
  const t = useT();
  const { user } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isSuperAdmin = user?.role === 'super_admin';
  const activeRef = useRef<HTMLAnchorElement>(null);

  // The nav has more tabs than fit on a phone width and scrolls
  // horizontally — with no auto-scroll, landing on a tab past the fold (e.g.
  // Users) shows a strip with no visible active tab and no hint that
  // there's more to the right. Bring the active one into view every time it
  // changes.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [pathname]);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', width: '100%' }}>
      <nav className="admin-nav">
        {TABS.filter((tab) => !tab.superAdminOnly || isSuperAdmin).map((tab) => {
          const isActive = pathname.startsWith(tab.to);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              ref={isActive ? activeRef : undefined}
              className={`admin-nav-item${isActive ? ' is-active' : ''}`}
            >
              {t(tab.key)}
            </Link>
          );
        })}
      </nav>
      {/* Every admin form below wraps or stacks instead of forcing a fixed
          width, but this is the backstop: nothing in here should ever be
          able to force the phone viewport itself to scroll sideways. */}
      <div className="admin-body">
        <Outlet />
      </div>
    </div>
  );
}

export function AdminShell() {
  return (
    <RequireAdmin>
      <AdminShellInner />
    </RequireAdmin>
  );
}
