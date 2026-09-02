import { Link, useRouterState } from '@tanstack/react-router';
import { useT } from '../i18n';

const TABS = [
  { to: '/', glyph: '⌂', key: 'nav.home' },
  { to: '/history', glyph: '☰', key: 'nav.history' },
  { to: '/settings', glyph: '⚙', key: 'nav.settings' },
] as const;

/**
 * The operator's own way around the app, always in the same place. Only
 * three destinations — recording itself is reached from Home, not a tab of
 * its own, so this never competes with the one thing an operator does most.
 * Hidden on screens that already own the bottom of the viewport for their
 * own action (the capture screen's Stop button, a machine's persistent
 * "Record a new log" footer) — see RootLayout's showBottomNav.
 */
export function BottomNav() {
  const t = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => {
        const active = tab.to === '/' ? pathname === '/' : pathname.startsWith(tab.to);
        return (
          <Link key={tab.to} to={tab.to} className={`bottom-nav-item${active ? ' is-active' : ''}`}>
            <span className="bottom-nav-glyph" aria-hidden="true">
              {tab.glyph}
            </span>
            <span>{t(tab.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
