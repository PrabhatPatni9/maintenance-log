import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, redirect, useRouterState } from '@tanstack/react-router';
import { useAuth } from './lib/auth-context';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { InstallPrompt } from './components/InstallPrompt';
import { Index } from './routes/Index';
import { LanguagePicker } from './routes/LanguagePicker';
import { Login } from './routes/Login';
import { MachinePicker } from './routes/MachinePicker';
import { MachineHistory } from './routes/MachineHistory';
import { MeterPicker } from './routes/MeterPicker';
import { MeterEntry } from './routes/MeterEntry';
import { Record } from './routes/Record';
import { LogDetail } from './routes/LogDetail';
import { History as OperatorHistory } from './routes/History';
import { Settings } from './routes/Settings';

// Admin screens are never opened by an operator on the shed floor — keep all
// of it out of the bundle everyone else has to download over patchy 4G
// (CLAUDE.md "Success is measured by one thing").
const AdminShell = lazyRouteComponent(() => import('./routes/admin/AdminShell'), 'AdminShell');
const Sheds = lazyRouteComponent(() => import('./routes/admin/Sheds'), 'Sheds');
const Machines = lazyRouteComponent(() => import('./routes/admin/Machines'), 'Machines');
const Meters = lazyRouteComponent(() => import('./routes/admin/Meters'), 'Meters');
const Users = lazyRouteComponent(() => import('./routes/admin/Users'), 'Users');
const Taxonomy = lazyRouteComponent(() => import('./routes/admin/Taxonomy'), 'Taxonomy');
const History = lazyRouteComponent(() => import('./routes/admin/History'), 'History');
const Dashboard = lazyRouteComponent(() => import('./routes/admin/Dashboard'), 'Dashboard');

// Only the top-level destinations get the bottom nav. Every other screen
// already owns the bottom of the viewport for its own action — the capture
// screen's Stop button, a machine's persistent "Record a new log" footer —
// and stacking a second bar under those would just fight them for the same
// sliver of a short phone.
const BOTTOM_NAV_PATHS = new Set(['/', '/history', '/settings', '/machine', '/meter']);

function RootLayout() {
  const { user } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const chrome = Boolean(user) && pathname !== '/language';
  const showBottomNav = chrome && !pathname.startsWith('/admin') && BOTTOM_NAV_PATHS.has(pathname);

  // A column shell rather than a plain fragment, so a screen that needs to
  // pin something to the bottom of the viewport (the capture screen's Stop
  // button) can measure against what is actually left below the header.
  return (
    <div className="app-shell">
      {chrome && <Header />}
      <main className="app-main">
        <Outlet />
      </main>
      {chrome && <InstallPrompt />}
      {showBottomNav && <BottomNav />}
    </div>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Index });
const languageRoute = createRoute({ getParentRoute: () => rootRoute, path: '/language', component: LanguagePicker });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: Login });
const machineRoute = createRoute({ getParentRoute: () => rootRoute, path: '/machine', component: MachinePicker });
const machineHistoryRoute = createRoute({ getParentRoute: () => rootRoute, path: '/machine/$machineId', component: MachineHistory });
const meterRoute = createRoute({ getParentRoute: () => rootRoute, path: '/meter', component: MeterPicker });
const meterEntryRoute = createRoute({ getParentRoute: () => rootRoute, path: '/meter/$meterId', component: MeterEntry });
const recordRoute = createRoute({ getParentRoute: () => rootRoute, path: '/record/$machineId', component: Record });
const logDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/logs/$logId', component: LogDetail });
const historyRoute = createRoute({ getParentRoute: () => rootRoute, path: '/history', component: OperatorHistory });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: Settings });

const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: '/admin', component: AdminShell });
const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/admin/sheds' });
  },
});
const adminShedsRoute = createRoute({ getParentRoute: () => adminRoute, path: '/sheds', component: Sheds });
const adminMachinesRoute = createRoute({ getParentRoute: () => adminRoute, path: '/machines', component: Machines });
const adminMetersRoute = createRoute({ getParentRoute: () => adminRoute, path: '/meters', component: Meters });
const adminUsersRoute = createRoute({ getParentRoute: () => adminRoute, path: '/users', component: Users });
const adminTaxonomyRoute = createRoute({ getParentRoute: () => adminRoute, path: '/taxonomy', component: Taxonomy });
const adminHistoryRoute = createRoute({ getParentRoute: () => adminRoute, path: '/history', component: History });
const adminDashboardRoute = createRoute({ getParentRoute: () => adminRoute, path: '/dashboard', component: Dashboard });

const routeTree = rootRoute.addChildren([
  indexRoute,
  languageRoute,
  loginRoute,
  machineRoute,
  machineHistoryRoute,
  meterRoute,
  meterEntryRoute,
  recordRoute,
  logDetailRoute,
  historyRoute,
  settingsRoute,
  adminRoute.addChildren([
    adminIndexRoute,
    adminShedsRoute,
    adminMachinesRoute,
    adminMetersRoute,
    adminUsersRoute,
    adminTaxonomyRoute,
    adminHistoryRoute,
    adminDashboardRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
