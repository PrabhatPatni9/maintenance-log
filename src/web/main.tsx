import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { LangProvider } from './i18n';
import { AuthProvider, useAuth } from './lib/auth-context';
import { router } from './router';
import { startSyncEngine } from './lib/queue';
import { refreshTaxonomy } from './lib/match';
import { refreshSttMode } from './lib/config';
import './styles/global.css';

function Bootstrap() {
  const { user } = useAuth();

  useEffect(() => {
    startSyncEngine();
  }, []);

  // These endpoints require a session. Refreshing them on mount alone meant
  // that on a fresh device the taxonomy fetch fired before login, came back
  // 401, got swallowed, and never ran again — leaving the matcher with an
  // empty vocabulary for the whole session, so nothing an operator said or
  // typed could ever select a pill. Key it to the logged-in user instead.
  useEffect(() => {
    if (!user) return;
    void refreshTaxonomy().catch(() => {});
    void refreshSttMode();
  }, [user?.phone]); // eslint-disable-line react-hooks/exhaustive-deps

  return <RouterProvider router={router} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <AuthProvider>
        <Bootstrap />
      </AuthProvider>
    </LangProvider>
  </StrictMode>,
);
