import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { dismiss, getDeferredPrompt, isIos, shouldShowInstallPrompt } from '../lib/install';

export function InstallPrompt() {
  const t = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    void shouldShowInstallPrompt().then(setVisible);
  }, []);

  if (!visible) return null;

  async function install() {
    const prompt = getDeferredPrompt();
    if (prompt) await prompt.prompt();
    setVisible(false);
  }

  function close() {
    dismiss();
    setVisible(false);
  }

  return (
    <div
      className="panel"
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 50,
        maxWidth: 420,
        margin: '0 auto',
      }}
    >
      <strong>{t('install.promptTitle')}</strong>
      {isIos() ? (
        <>
          <p className="meta">{t('install.iosTitle')}</p>
          <p>1. {t('install.iosStep1')}</p>
          <p>2. {t('install.iosStep2')}</p>
          <p>3. {t('install.iosStep3')}</p>
          <button className="btn" onClick={close}>
            {t('common.close')}
          </button>
        </>
      ) : (
        <>
          <p>{t('install.promptBody')}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={close}>
              {t('install.dismiss')}
            </button>
            <button className="btn btn-amber btn-block" onClick={() => void install()}>
              {t('install.installButton')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
