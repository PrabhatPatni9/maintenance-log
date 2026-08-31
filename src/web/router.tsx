import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, redirect, useRouterState } from '@tanstack/react-router';
import { useAuth } from './lib/auth-context';
import { Header } from './components/Header';
import { InstallPrompt } from './components/InstallPrompt';
import { Index } from './routes/Index';
import { LanguagePicker } from './routes/LanguagePicker';
import { Login } from './routes/Login';
import { MachinePicker } from './routes/MachinePicker';
import { Record } from './routes/Record';
import { LogDetail } from './routes/LogDetail';
import { Settings } from './routes/Settings';

// Admin screens are never opened by an operator on the shed floor — keep all
// of it out of the bundle everyone else has to download over patchy 4G
// (CLAUDE.md "Success is measured by one thing").
const AdminShell = lazyRouteComponent(() => import('./routes/admin/AdminShell'), 'AdminShell');
const Sheds = lazyRouteComponent(() => import('./routes/admin/Sheds'), 'Sheds');
const Machines = lazyRouteComponent(() => import('./routes/admin/Machines'), 'Machines');
const Users = lazyRouteComponent(() => import('./routes/admin/Users'), 'Users');
const Taxonomy = lazyRouteComponent(() => import('./routes/admin/Taxonomy'), 'Taxonomy');
const History = lazyRouteComponent(() => import('./routes/admin/History'), 'History');

function RootLayout() {
  const { user } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const chrome = Boolean(user) && pathname !== '/language';

  return (
    <>
      {chrome && <Header />}
      <Outlet />
      {chrome && <InstallPrompt />}
    </>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Index });
const languageRoute = createRoute({ getParentRoute: () => rootRoute, path: '/language', component: LanguagePicker });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: Login });
const machineRoute = createRoute({ getParentRoute: () => rootRoute, path: '/machine', component: MachinePicker });
const recordRoute = createRoute({ getParentRoute: () => rootRoute, path: '/record/$machineId', component: Record });
const logDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/logs/$logId', component: LogDetail });
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
const adminUsersRoute = createRoute({ getParentRoute: () => adminRoute, path: '/users', component: Users });
const adminTaxonomyRoute = createRoute({ getParentRoute: () => adminRoute, path: '/taxonomy', component: Taxonomy });
const adminHistoryRoute = createRoute({ getParentRoute: () => adminRoute, path: '/history', component: History });

const routeTree = rootRoute.addChildren([
  indexRoute,
  languageRoute,
  loginRoute,
  machineRoute,
  recordRoute,
  logDetailRoute,
  settingsRoute,
  adminRoute.addChildren([
    adminIndexRoute,
    adminShedsRoute,
    adminMachinesRoute,
    adminUsersRoute,
    adminTaxonomyRoute,
    adminHistoryRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
