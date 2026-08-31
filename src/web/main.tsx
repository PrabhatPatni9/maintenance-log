import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { LangProvider } from './i18n';
import { AuthProvider } from './lib/auth-context';
import { router } from './router';
import { startSyncEngine } from './lib/queue';
import { refreshTaxonomy } from './lib/match';
import { refreshSttMode } from './lib/config';
import './styles/global.css';

function Bootstrap() {
  useEffect(() => {
    startSyncEngine();
    void refreshTaxonomy().catch(() => {});
    void refreshSttMode();
  }, []);
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
