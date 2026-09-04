import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import { deriveKeyB64, generateSaltB64 } from '../../lib/crypto';
import { useAuth } from '../../lib/auth-context';
import { RequireAdmin } from '../../lib/guards';
import { PasswordField } from '../../components/PasswordField';
import type { Role, User, Lang, Shed } from '@shared/types';

const ROLE_KEY: Record<Role, string> = {
  super_admin: 'admin.users.roleSuperAdmin',
  admin: 'admin.users.roleAdmin',
  operator: 'admin.users.roleOperator',
};
const UTILITY_KEY = 'admin.users.roleUtilityOperator';

/** Every tier but the owner is shed-scoped; super_admin sees every shed
 * with no grant needed, so there is nothing to check boxes for. */
function isShedScoped(role: Role): boolean {
  return role === 'operator' || role === 'admin';
}

/** "Operator", "Utility operator", or "Operator + Utility operator" — an
 * operator-tier account's two jobs are independent flags, not a single pick
 * (migration 0006), so the row needs to say which one(s) apply. Admin and
 * super_admin always do both, nothing to summarize beyond the tier name. */
function jobSummary(t: (k: string) => string, u: User): string {
  if (u.role !== 'operator') return t(ROLE_KEY[u.role]);
  if (u.isOperator && u.isUtility) return `${t('admin.users.roleOperator')} + ${t(UTILITY_KEY)}`;
  if (u.isUtility) return t(UTILITY_KEY);
  return t('admin.users.roleOperator');
}

function ShedCheckboxes({
  sheds,
  selected,
  onChange,
}: {
  sheds: Shed[];
  selected: Set<string>;
  onChange(next: Set<string>): void;
}) {
  const t = useT();
  return (
    <div>
      <label className="field-label">{t('admin.users.shedAccessLabel')}</label>
      {/* Full-width, stacked rows rather than wrapped inline checkboxes — a
          native checkbox is a small, fiddly target on a phone; the whole row
          being tappable is what actually works with a thumb. */}
      <div className="shed-check-list">
        {sheds.map((s) => {
          const checked = selected.has(s.id);
          return (
            <label key={s.id} className={`shed-check-row${checked ? ' is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(s.id);
                  else next.delete(s.id);
                  onChange(next);
                }}
              />
              <span className="shed-badge" style={{ minWidth: 32, height: 32, fontSize: 14 }}>
                {s.code}
              </span>
              <span>{s.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function UserRow({
  u,
  sheds,
  isSuperAdmin,
  onChanged,
}: {
  u: User;
  sheds: Shed[];
  isSuperAdmin: boolean;
  onChanged(): void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetDone, setResetDone] = useState(false);

  const [editingRole, setEditingRole] = useState(false);
  const [roleTier, setRoleTier] = useState<Role>(u.role);
  const [roleIsOperator, setRoleIsOperator] = useState(u.isOperator);
  const [roleIsUtility, setRoleIsUtility] = useState(u.isUtility);
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleError, setRoleError] = useState('');

  function openRoleEdit() {
    setEditingRole(true);
    setRoleTier(u.role);
    setRoleIsOperator(u.isOperator);
    setRoleIsUtility(u.isUtility);
    setRoleError('');
  }

  /** Tier (operator/admin/super_admin) only changes when a super_admin is
   * editing and actually picked a different one — a shed-scoped admin's
   * panel never shows the tier select at all, so `roleTier` just echoes
   * `u.role` for them and this correctly sends no `role` field. Job flags
   * only mean anything at the operator tier. */
  async function saveRole() {
    if (roleTier === 'operator' && !roleIsOperator && !roleIsUtility) {
      setRoleError(t('admin.users.pickAtLeastOneJob'));
      return;
    }
    setRoleBusy(true);
    setRoleError('');
    try {
      const body: { role?: Role; isOperator?: boolean; isUtility?: boolean } = {};
      if (isSuperAdmin && roleTier !== u.role) body.role = roleTier;
      if (roleTier === 'operator') {
        body.isOperator = roleIsOperator;
        body.isUtility = roleIsUtility;
      }
      await api.patch(`/admin/users/${u.phone}`, body);
      setEditingRole(false);
      onChanged();
    } catch (err) {
      setRoleError(err instanceof ApiError ? err.message : t('admin.users.saveError'));
    } finally {
      setRoleBusy(false);
    }
  }

  async function startEdit() {
    setEditing(true);
    if (!loaded) {
      const { shedIds } = await api.get<{ shedIds: string[] }>(`/admin/users/${u.phone}/sheds`);
      setSelected(new Set(shedIds));
      setLoaded(true);
    }
  }

  async function save() {
    await api.patch(`/admin/users/${u.phone}`, { shedIds: [...selected] });
    setEditing(false);
    onChanged();
  }

  async function toggleActive() {
    await api.patch(`/admin/users/${u.phone}`, { active: !u.active });
    onChanged();
  }

  function openReset() {
    setResetting(true);
    setNewPassword('');
    setConfirmPassword('');
    setResetError('');
    setResetDone(false);
  }

  /** The forgotten-password path: an admin sets a fresh password on the
   * operator's behalf, no old one needed — that is the whole point. Same
   * client-side derivation as every other password path in the app; the
   * server only ever sees the derived key. */
  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetError('');
    if (newPassword !== confirmPassword) {
      setResetError(t('settings.passwordMismatch'));
      return;
    }
    if (newPassword.length < 4) {
      setResetError(t('settings.passwordTooShort'));
      return;
    }
    setResetBusy(true);
    try {
      const salt = generateSaltB64();
      const derivedKey = await deriveKeyB64(newPassword, salt);
      await api.post(`/admin/users/${u.phone}/reset-password`, { salt, derivedKey });
      setResetDone(true);
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setResetError(t('admin.users.saveError'));
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <li className={`panel user-row${u.active ? '' : ' is-off'}`}>
      <div className="user-row-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="meta">
            {u.phone} · {jobSummary(t, u)}
            {!u.active && ` · ${t('common.inactive')}`}
          </div>
        </div>
      </div>
      <div className="user-row-actions">
        <button className="btn btn-small" onClick={openRoleEdit}>
          {t('admin.users.editRole')}
        </button>
        {isShedScoped(u.role) && (
          <button className="btn btn-small" onClick={() => void startEdit()}>
            {t('admin.users.editShedAccess')}
          </button>
        )}
        <button className="btn btn-small" onClick={openReset}>
          {t('admin.users.resetPassword')}
        </button>
        <button className="btn btn-small" onClick={() => void toggleActive()}>
          {t(u.active ? 'common.deactivate' : 'common.activate')}
        </button>
      </div>

      {editingRole && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
          {isSuperAdmin && (
            <div style={{ marginBottom: 12 }}>
              <label className="field-label">{t('admin.users.roleLabel')}</label>
              <select className="input" value={roleTier} onChange={(e) => setRoleTier(e.target.value as Role)}>
                <option value="operator">{t('admin.users.roleOperator')}</option>
                <option value="admin">{t('admin.users.roleAdmin')}</option>
                <option value="super_admin">{t('admin.users.roleSuperAdmin')}</option>
              </select>
            </div>
          )}
          {roleTier === 'operator' && (
            <div className="shed-check-list">
              <label className={`shed-check-row${roleIsOperator ? ' is-checked' : ''}`}>
                <input type="checkbox" checked={roleIsOperator} onChange={(e) => setRoleIsOperator(e.target.checked)} />
                <span>{t('admin.users.roleOperator')}</span>
              </label>
              <label className={`shed-check-row${roleIsUtility ? ' is-checked' : ''}`}>
                <input type="checkbox" checked={roleIsUtility} onChange={(e) => setRoleIsUtility(e.target.checked)} />
                <span>{t(UTILITY_KEY)}</span>
              </label>
            </div>
          )}
          {roleError && <p style={{ color: 'var(--fault)', margin: '8px 0 0' }}>{roleError}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-block" onClick={() => setEditingRole(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary btn-block" onClick={() => void saveRole()} disabled={roleBusy}>
              {t('common.save')}
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
          <ShedCheckboxes sheds={sheds} selected={selected} onChange={setSelected} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-block" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary btn-block" onClick={() => void save()}>
              {t('common.save')}
            </button>
          </div>
        </div>
      )}

      {resetting && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
          <form onSubmit={resetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
            {resetError && <p style={{ color: 'var(--fault)', margin: 0 }}>{resetError}</p>}
            {resetDone && <p style={{ color: 'var(--ink)', margin: 0 }}>{t('settings.passwordChanged')}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-block" onClick={() => setResetting(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary btn-block" type="submit" disabled={resetBusy}>
                {t('admin.users.resetPassword')}
              </button>
            </div>
          </form>
        </div>
      )}
    </li>
  );
}

function UsersInner() {
  const t = useT();
  const { user: me } = useAuth();
  const isSuperAdmin = me?.role === 'super_admin';
  const [users, setUsers] = useState<User[]>([]);
  const [sheds, setSheds] = useState<Shed[]>([]);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  // A shed-scoped admin can only ever add an operator-tier account — never
  // another admin or the owner tier, so their picker has nothing to pick.
  // The owner tier's picker offers all three.
  const [role, setRole] = useState<Role>('operator');
  const [isOperator, setIsOperator] = useState(true);
  const [isUtility, setIsUtility] = useState(false);
  const [lang, setLang] = useState<Lang>('hi');
  const [password, setPassword] = useState('');
  const [shedIds, setShedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState('');

  function refresh() {
    void api.get<{ users: User[] }>('/admin/users').then((r) => setUsers(r.users));
    // Already shed-scoped server side for a plain admin (GET /api/sheds), so
    // the shed checkboxes below only ever offer what this admin actually
    // holds — "distribute" a slice of their own access, nothing more.
    void api.get<{ sheds: Shed[] }>('/sheds').then((r) => setSheds(r.sheds));
  }
  useEffect(refresh, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (role === 'operator' && !isOperator && !isUtility) {
      setAddError(t('admin.users.pickAtLeastOneJob'));
      return;
    }
    setBusy(true);
    setAddError('');
    try {
      const salt = generateSaltB64();
      const derivedKey = await deriveKeyB64(password, salt);
      await api.post('/admin/users', {
        phone,
        name,
        role,
        isOperator,
        isUtility,
        lang,
        salt,
        derivedKey,
        shedIds: [...shedIds],
      });
      setPhone('');
      setName('');
      setPassword('');
      setShedIds(new Set());
      setIsOperator(true);
      setIsUtility(false);
      refresh();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : t('admin.users.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="screen-title" style={{ marginBottom: 6 }}>
        {t('admin.users.title')}
      </h1>
      <p className="meta" style={{ marginBottom: 20 }}>
        {isSuperAdmin ? t('admin.users.hintOwner') : t('admin.users.hintAdmin')}
      </p>

      {/* One field per row: on a 360px phone, side-by-side fixed-width
          fields just push each other off the edge of the screen. */}
      <form onSubmit={add} className="panel stacked-form">
        <div className="field-pair">
          <div>
            <label className="field-label">{t('admin.users.phoneLabel')}</label>
            <input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </div>
          <div>
            <label className="field-label">{t('admin.users.nameLabel')}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        </div>

        <div className="field-pair">
          <div>
            <label className="field-label">{t('admin.users.roleLabel')}</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="operator">{t('admin.users.roleOperator')}</option>
              {isSuperAdmin && <option value="admin">{t('admin.users.roleAdmin')}</option>}
              {isSuperAdmin && <option value="super_admin">{t('admin.users.roleSuperAdmin')}</option>}
            </select>
          </div>
          <div>
            <label className="field-label">{t('settings.languageLabel')}</label>
            <select className="input" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              <option value="hi">{t('lang.hindi')}</option>
              <option value="mr">{t('lang.marathi')}</option>
              <option value="en">{t('lang.english')}</option>
            </select>
          </div>
        </div>

        {role === 'operator' && (
          <div>
            <label className="field-label">{t('admin.users.jobsLabel')}</label>
            <div className="shed-check-list">
              <label className={`shed-check-row${isOperator ? ' is-checked' : ''}`}>
                <input type="checkbox" checked={isOperator} onChange={(e) => setIsOperator(e.target.checked)} />
                <span>{t('admin.users.roleOperator')}</span>
              </label>
              <label className={`shed-check-row${isUtility ? ' is-checked' : ''}`}>
                <input type="checkbox" checked={isUtility} onChange={(e) => setIsUtility(e.target.checked)} />
                <span>{t(UTILITY_KEY)}</span>
              </label>
            </div>
          </div>
        )}

        <div>
          <label className="field-label">{t('admin.users.initialPasswordLabel')}</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {isShedScoped(role) && <ShedCheckboxes sheds={sheds} selected={shedIds} onChange={setShedIds} />}

        {addError && <p style={{ color: 'var(--fault)', margin: 0 }}>{addError}</p>}

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {t('admin.users.addUser')}
        </button>
      </form>

      <ul className="stack-list" style={{ marginTop: 20 }}>
        {users.map((u) => (
          <UserRow key={u.phone} u={u} sheds={sheds} isSuperAdmin={isSuperAdmin} onChanged={refresh} />
        ))}
      </ul>
      {users.length === 0 && <p className="meta" style={{ marginTop: 12 }}>{t('admin.users.empty')}</p>}
    </div>
  );
}

export function Users() {
  return (
    <RequireAdmin>
      <UsersInner />
    </RequireAdmin>
  );
}
