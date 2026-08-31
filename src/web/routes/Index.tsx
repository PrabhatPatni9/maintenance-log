import { useT } from '../i18n';
import { getStoredLang } from '../i18n';
import { useAuth } from '../lib/auth-context';
import { LanguagePicker } from './LanguagePicker';
import { Login } from './Login';
import { Home } from './Home';

/** '/' serves whichever of the three states applies: language never chosen,
 * chosen but not logged in, or ready for the home screen. Keeps first launch
 * to a single screen instead of a redirect chain. */
export function Index() {
  const { user, loading } = useAuth();
  const t = useT();

  if (getStoredLang() === null) return <LanguagePicker />;
  if (loading) return <p className="meta" style={{ padding: 20 }}>{t('common.loading')}</p>;
  if (!user) return <Login />;
  return <Home />;
}
