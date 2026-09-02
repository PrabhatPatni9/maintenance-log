import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import type { Lang } from '@shared/types';
import { useLang, useT } from '../i18n';
import { useAuth } from '../lib/auth-context';
import { RequireAuth } from '../lib/guards';
import { api, ApiError } from '../lib/api';
import { deriveKeyB64, generateSaltB64 } from '../lib/crypto';

const LANGS: { lang: Lang; key: string }[] = [
  { lang: 'hi', key: 'lang.hindi' },
  { lang: 'mr', key: 'lang.marathi' },
  { lang: 'en', key: 'lang.english' },
];

/** A factory-floor phone gets typed on with a thumb, half-looking at the
 * screen — being able to check what was actually typed matters more here
 * than it does on a desktop login form. */
function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label className="field-label">{label}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="btn btn-small"
          style={{ flex: 'none' }}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? '🙈' : '👁'}
        </button>
      </div>
    </div>
  );
}

function SettingsInner() {
  const t = useT();
  const { lang, setLang } = useLang();
  const { user, logout, updateName } = useAuth();
  const navigate = useNavigate();

  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(user?.name ?? '');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState('');

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setNameBusy(true);
    setNameError('');
    try {
      await updateName(name.trim());
      setEditingName(false);
    } catch {
      setNameError(t('settings.saveError'));
    } finally {
      setNameBusy(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    setPwSuccess(false);
    if (newPassword !== confirmPassword) {
      setPwError(t('settings.passwordMismatch'));
      return;
    }
    if (newPassword.length < 4) {
      setPwError(t('settings.passwordTooShort'));
      return;
    }
    setPwBusy(true);
    try {
      const { salt } = await api.post<{ salt: string }>('/auth/salt', { phone: user!.phone });
      const oldDerivedKey = await deriveKeyB64(oldPassword, salt);
      const newSalt = generateSaltB64();
      const newDerivedKey = await deriveKeyB64(newPassword, newSalt);
      await api.post('/me/password', { oldDerivedKey, newSalt, newDerivedKey });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwSuccess(true);
    } catch (err) {
      setPwError(
        err instanceof ApiError && err.status === 401 ? t('settings.currentPasswordWrong') : t('settings.saveError'),
      );
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className="screen">
      <h1 className="screen-title" style={{ marginBottom: 20 }}>
        {t('settings.title')}
      </h1>

      {/* Identity: name is editable, phone is not — phone is the login ID */}
      <div className="panel" style={{ padding: 16, marginBottom: 20 }}>
        {!editingName ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 17 }}>{user?.name}</div>
              <div className="meta">{user?.phone}</div>
            </div>
            <button className="btn btn-small" onClick={() => { setName(user?.name ?? ''); setEditingName(true); }}>
              {t('settings.editName')}
            </button>
          </div>
        ) : (
          <form onSubmit={saveName}>
            <label className="field-label">{t('admin.users.nameLabel')}</label>
            <input className="input" style={{ marginBottom: 12 }} value={name} onChange={(e) => setName(e.target.value)} required />
            {nameError && <p style={{ color: 'var(--fault)', marginBottom: 12 }}>{nameError}</p>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-block" onClick={() => setEditingName(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary btn-block" type="submit" disabled={nameBusy}>
                {t('common.save')}
              </button>
            </div>
          </form>
        )}
      </div>

      <h2 style={{ fontSize: 15, color: 'var(--steel)', marginBottom: 8 }}>{t('settings.languageLabel')}</h2>
      <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
        {LANGS.map((l) => (
          <button
            key={l.lang}
            className="btn"
            style={{ background: lang === l.lang ? 'var(--ink)' : undefined, color: lang === l.lang ? 'var(--panel)' : undefined }}
            onClick={() => setLang(l.lang)}
          >
            {t(l.key)}
          </button>
        ))}
      </div>

      <h2 style={{ fontSize: 15, color: 'var(--steel)', marginBottom: 8 }}>{t('settings.changePassword')}</h2>
      <form onSubmit={changePassword} className="panel stacked-form" style={{ marginBottom: 20 }}>
        <PasswordField
          label={t('settings.currentPasswordLabel')}
          value={oldPassword}
          onChange={setOldPassword}
          autoComplete="current-password"
        />
        <PasswordField
          label={t('settings.newPasswordLabel')}
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
        />
        <PasswordField
          label={t('settings.confirmPasswordLabel')}
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
        />
        {pwError && <p style={{ color: 'var(--fault)', margin: 0 }}>{pwError}</p>}
        {pwSuccess && <p style={{ color: 'var(--ink)', margin: 0 }}>{t('settings.passwordChanged')}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={pwBusy}>
          {t('settings.changePasswordButton')}
        </button>
      </form>

      {/* The only way into the admin panel, and it is only rendered for an
          admin. An operator never sees that there is one — the server
          enforces it too, so a guessed URL gets them nothing. */}
      {(user?.role === 'admin' || user?.role === 'super_admin') && (
        <Link to="/admin/sheds" className="btn btn-primary btn-block admin-entry">
          {t('settings.adminPanel')}
        </Link>
      )}

      <button
        className="btn btn-block"
        style={{ marginTop: 12 }}
        onClick={() => {
          void logout().then(() => void navigate({ to: '/login' }));
        }}
      >
        {t('auth.logoutButton')}
      </button>
    </div>
  );
}

export function Settings() {
  return (
    <RequireAuth>
      <SettingsInner />
    </RequireAuth>
  );
}
