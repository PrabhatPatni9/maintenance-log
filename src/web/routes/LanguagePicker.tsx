import { useNavigate } from '@tanstack/react-router';
import type { Lang } from '@shared/types';
import { useLang, useT } from '../i18n';

const OPTIONS: { lang: Lang; key: string }[] = [
  { lang: 'hi', key: 'lang.hindi' },
  { lang: 'mr', key: 'lang.marathi' },
  { lang: 'en', key: 'lang.english' },
];

export function LanguagePicker() {
  const { setLang } = useLang();
  const t = useT();
  const navigate = useNavigate();

  function choose(lang: Lang) {
    setLang(lang);
    void navigate({ to: '/login' });
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 32,
        padding: 24,
        background: 'var(--base)',
      }}
    >
      <img src="/icons/icon-128.png" alt="" width={72} height={72} />
      <div style={{ textAlign: 'center' }}>
        <h1 className="screen-title">{t('lang.title')}</h1>
        <p className="meta" style={{ marginTop: 4 }}>
          {t('lang.subtitle')}
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 360 }}>
        {OPTIONS.map((o) => (
          <button
            key={o.lang}
            className="btn btn-block"
            style={{ minHeight: 72, fontSize: 22, fontWeight: 600 }}
            onClick={() => choose(o.lang)}
          >
            {t(o.key)}
          </button>
        ))}
      </div>
    </div>
  );
}
