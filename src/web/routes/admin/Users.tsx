import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { deriveKeyB64, generateSaltB64 } from '../../lib/crypto';
import type { Role, User, Lang, Shed } from '@shared/types';

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

function UserRow({ u, sheds, onChanged }: { u: User; sheds: Shed[]; onChanged(): void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

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

  return (
    <li className={`panel user-row${u.active ? '' : ' is-off'}`}>
      <div className="user-row-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="meta">
            {u.phone} · {t(u.role === 'admin' ? 'admin.users.roleAdmin' : 'admin.users.roleOperator')}
            {!u.active && ` · ${t('common.inactive')}`}
          </div>
        </div>
      </div>
      <div className="user-row-actions">
        {u.role === 'operator' && (
          <button className="btn btn-small" onClick={() => void startEdit()}>
            {t('admin.users.editShedAccess')}
          </button>
        )}
        <button className="btn btn-small" onClick={() => void toggleActive()}>
          {t(u.active ? 'common.deactivate' : 'common.activate')}
        </button>
      </div>

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
    </li>
  );
}

export function Users() {
  const t = useT();
  const [users, setUsers] = useState<User[]>([]);
  const [sheds, setSheds] = useState<Shed[]>([]);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('operator');
  const [lang, setLang] = useState<Lang>('hi');
  const [password, setPassword] = useState('');
  const [shedIds, setShedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  function refresh() {
    void api.get<{ users: User[] }>('/admin/users').then((r) => setUsers(r.users));
    void api.get<{ sheds: Shed[] }>('/sheds').then((r) => setSheds(r.sheds));
  }
  useEffect(refresh, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const salt = generateSaltB64();
      const derivedKey = await deriveKeyB64(password, salt);
      await api.post('/admin/users', { phone, name, role, lang, salt, derivedKey, shedIds: [...shedIds] });
      setPhone('');
      setName('');
      setPassword('');
      setShedIds(new Set());
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="screen-title" style={{ marginBottom: 20 }}>
        {t('admin.users.title')}
      </h1>

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
              <option value="admin">{t('admin.users.roleAdmin')}</option>
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

        {role === 'operator' && <ShedCheckboxes sheds={sheds} selected={shedIds} onChange={setShedIds} />}

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {t('admin.users.addUser')}
        </button>
      </form>

      <ul className="stack-list" style={{ marginTop: 20 }}>
        {users.map((u) => (
          <UserRow key={u.phone} u={u} sheds={sheds} onChanged={refresh} />
        ))}
      </ul>
    </div>
  );
}
