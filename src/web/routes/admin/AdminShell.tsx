import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useT } from '../../i18n';
import { RequireAdmin } from '../../lib/guards';

const TABS: { to: string; key: string }[] = [
  { to: '/admin/sheds', key: 'admin.shedsTab' },
  { to: '/admin/machines', key: 'admin.machinesTab' },
  { to: '/admin/users', key: 'admin.usersTab' },
  { to: '/admin/taxonomy', key: 'admin.taxonomyTab' },
  { to: '/admin/history', key: 'admin.historyTab' },
  { to: '/admin/qr', key: 'admin.qr.sheetTitle' },
];

function AdminShellInner() {
  const t = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <nav style={{ display: 'flex', gap: 4, overflowX: 'auto', borderBottom: '1px solid var(--line)', padding: '0 12px' }}>
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            style={{
              padding: '14px 12px',
              whiteSpace: 'nowrap',
              textDecoration: 'none',
              color: pathname.startsWith(tab.to) ? 'var(--ink)' : 'var(--steel)',
              borderBottom: pathname.startsWith(tab.to) ? '2px solid var(--amber)' : '2px solid transparent',
              fontWeight: 500,
            }}
          >
            {t(tab.key)}
          </Link>
        ))}
      </nav>
      <div style={{ padding: 20 }}>
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
