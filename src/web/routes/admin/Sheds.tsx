import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import type { Shed } from '@shared/types';

export function Sheds() {
  const t = useT();
  const [sheds, setSheds] = useState<Shed[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  function refresh() {
    void api.get<{ sheds: Shed[] }>('/sheds').then((r) => setSheds(r.sheds));
  }
  useEffect(refresh, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    await api.post('/sheds', { code, name });
    setCode('');
    setName('');
    refresh();
  }

  async function toggleActive(shed: Shed) {
    await api.patch(`/sheds/${shed.id}`, { active: !shed.active });
    refresh();
  }

  return (
    <div>
      <h1 className="screen-title" style={{ marginBottom: 20 }}>
        {t('admin.sheds.title')}
      </h1>

      <form onSubmit={add} style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        <input className="input" placeholder={t('admin.sheds.codeLabel')} value={code} onChange={(e) => setCode(e.target.value)} required style={{ width: 100, textAlign: 'left' }} />
        <input className="input" placeholder={t('admin.sheds.nameLabel')} value={name} onChange={(e) => setName(e.target.value)} required style={{ flex: 1, minWidth: 160, textAlign: 'left' }} />
        <button className="btn btn-primary" type="submit">
          {t('admin.sheds.addShed')}
        </button>
      </form>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {sheds.map((s) => (
          <li key={s.id} className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, marginBottom: 8 }}>
            <span>
              <strong>{s.code}</strong> — {s.name}
            </span>
            <button className="btn" onClick={() => void toggleActive(s)}>
              {t(s.active ? 'common.deactivate' : 'common.activate')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
