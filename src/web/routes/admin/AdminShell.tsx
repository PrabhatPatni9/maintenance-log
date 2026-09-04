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
];

function AdminShellInner() {
  const t = useT();
  const { user } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isSuperAdmin = user?.role === 'super_admin';

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', width: '100%' }}>
      <nav className="admin-nav">
        {TABS.filter((tab) => !tab.superAdminOnly || isSuperAdmin).map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className={`admin-nav-item${pathname.startsWith(tab.to) ? ' is-active' : ''}`}
          >
            {t(tab.key)}
          </Link>
        ))}
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
