import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { deriveKeyB64, generateSaltB64 } from '../../lib/crypto';
import type { Role, User, Lang } from '@shared/types';

export function Users() {
  const t = useT();
  const [users, setUsers] = useState<User[]>([]);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('operator');
  const [lang, setLang] = useState<Lang>('hi');
  const [password, setPassword] = useState('');

  function refresh() {
    void api.get<{ users: User[] }>('/admin/users').then((r) => setUsers(r.users));
  }
  useEffect(refresh, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const salt = generateSaltB64();
    const derivedKey = await deriveKeyB64(password, salt);
    await api.post('/admin/users', { phone, name, role, lang, salt, derivedKey });
    setPhone('');
    setName('');
    setPassword('');
    refresh();
  }

  async function toggleActive(u: User) {
    await api.patch(`/admin/users/${u.phone}`, { active: !u.active });
    refresh();
  }

  return (
    <div>
      <h1 className="screen-title" style={{ marginBottom: 20 }}>
        {t('admin.users.title')}
      </h1>

      <form onSubmit={add} className="panel" style={{ padding: 16, marginBottom: 24, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input className="btn" placeholder={t('admin.users.phoneLabel')} value={phone} onChange={(e) => setPhone(e.target.value)} required style={{ width: 140, textAlign: 'left' }} />
        <input className="btn" placeholder={t('admin.users.nameLabel')} value={name} onChange={(e) => setName(e.target.value)} required style={{ width: 160, textAlign: 'left' }} />
        <select className="btn" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="operator">{t('admin.users.roleOperator')}</option>
          <option value="admin">{t('admin.users.roleAdmin')}</option>
        </select>
        <select className="btn" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
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
        <button className="btn btn-primary" type="submit">
          {t('admin.users.addUser')}
        </button>
      </form>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {users.map((u) => (
          <li key={u.phone} className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, marginBottom: 8 }}>
            <span>
              {u.name} · {u.phone} · {t(u.role === 'admin' ? 'admin.users.roleAdmin' : 'admin.users.roleOperator')}
            </span>
            <button className="btn" onClick={() => void toggleActive(u)}>
              {t(u.active ? 'common.deactivate' : 'common.activate')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
