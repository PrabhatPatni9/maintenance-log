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
      <p className="meta" style={{ marginBottom: 6 }}>
        {t('admin.users.shedAccessLabel')}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {sheds.map((s) => (
          <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              checked={selected.has(s.id)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(s.id);
                else next.delete(s.id);
                onChange(next);
              }}
            />
            {s.code} — {s.name}
          </label>
        ))}
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
    <li className="panel" style={{ padding: 12, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>
          {u.name} · {u.phone} · {t(u.role === 'admin' ? 'admin.users.roleAdmin' : 'admin.users.roleOperator')}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {u.role === 'operator' && (
            <button className="btn" style={{ minHeight: 36, padding: '0 10px' }} onClick={() => void startEdit()}>
              {t('admin.users.editShedAccess')}
            </button>
          )}
          <button className="btn" style={{ minHeight: 36, padding: '0 10px' }} onClick={() => void toggleActive()}>
            {t(u.active ? 'common.deactivate' : 'common.activate')}
          </button>
        </div>
      </div>

      {editing && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
          <ShedCheckboxes sheds={sheds} selected={selected} onChange={setSelected} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" onClick={() => void save()}>
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

  function refresh() {
    void api.get<{ users: User[] }>('/admin/users').then((r) => setUsers(r.users));
    void api.get<{ sheds: Shed[] }>('/sheds').then((r) => setSheds(r.sheds));
  }
  useEffect(refresh, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const salt = generateSaltB64();
    const derivedKey = await deriveKeyB64(password, salt);
    await api.post('/admin/users', { phone, name, role, lang, salt, derivedKey, shedIds: [...shedIds] });
    setPhone('');
    setName('');
    setPassword('');
    setShedIds(new Set());
    refresh();
  }

  return (
    <div>
      <h1 className="screen-title" style={{ marginBottom: 20 }}>
        {t('admin.users.title')}
      </h1>

      <form onSubmit={add} className="panel" style={{ padding: 16, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="input" placeholder={t('admin.users.phoneLabel')} value={phone} onChange={(e) => setPhone(e.target.value)} required style={{ width: 140, textAlign: 'left' }} />
          <input className="input" placeholder={t('admin.users.nameLabel')} value={name} onChange={(e) => setName(e.target.value)} required style={{ width: 160, textAlign: 'left' }} />
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="operator">{t('admin.users.roleOperator')}</option>
            <option value="admin">{t('admin.users.roleAdmin')}</option>
          </select>
          <select className="input" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="hi">{t('lang.hindi')}</option>
            <option value="mr">{t('lang.marathi')}</option>
            <option value="en">{t('lang.english')}</option>
          </select>
          <input
            className="btn"
            type="password"
            placeholder={t('admin.users.initialPasswordLabel')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: 160, textAlign: 'left' }}
          />
        </div>

        {role === 'operator' && <ShedCheckboxes sheds={sheds} selected={shedIds} onChange={setShedIds} />}

        <button className="btn btn-primary" type="submit" style={{ alignSelf: 'flex-start' }}>
          {t('admin.users.addUser')}
        </button>
      </form>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {users.map((u) => (
          <UserRow key={u.phone} u={u} sheds={sheds} onChanged={refresh} />
        ))}
      </ul>
    </div>
  );
}
