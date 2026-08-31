import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import type { Machine, Shed } from '@shared/types';

export function Machines() {
  const t = useT();
  const [sheds, setSheds] = useState<Shed[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [shedId, setShedId] = useState('');
  const [range, setRange] = useState('');
  const [loomType, setLoomType] = useState('');
  const [status, setStatus] = useState('');

  function refresh() {
    void api.get<{ sheds: Shed[] }>('/sheds').then((r) => {
      setSheds(r.sheds);
      if (!shedId && r.sheds[0]) setShedId(r.sheds[0].id);
    });
    void api.get<{ machines: Machine[] }>('/machines').then((r) => setMachines(r.machines));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, []);

  async function bulkCreate(e: React.FormEvent) {
    e.preventDefault();
    const res = await api.post<{ created: number }>('/machines/bulk', { shedId, range, loomType: loomType || undefined });
    setStatus(`+${res.created}`);
    setRange('');
    refresh();
  }

  async function toggleActive(m: Machine) {
    await api.patch(`/machines/${m.id}`, { active: !m.active });
    refresh();
  }

  const shedById = new Map(sheds.map((s) => [s.id, s]));

  return (
    <div>
      <h1 className="screen-title" style={{ marginBottom: 20 }}>
        {t('admin.machines.title')}
      </h1>

      <form onSubmit={bulkCreate} className="panel" style={{ padding: 16, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>{t('admin.machines.bulkCreate')}</h2>
        <p className="meta" style={{ marginBottom: 12 }}>
          {t('admin.machines.bulkHint')}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="btn" value={shedId} onChange={(e) => setShedId(e.target.value)} style={{ minWidth: 140 }}>
            {sheds.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
          <input className="btn" placeholder="1-56" value={range} onChange={(e) => setRange(e.target.value)} required style={{ width: 120, textAlign: 'left' }} />
          <input
            className="btn"
            placeholder={t('admin.machines.loomTypeLabel')}
            value={loomType}
            onChange={(e) => setLoomType(e.target.value)}
            style={{ width: 160, textAlign: 'left' }}
          />
          <button className="btn btn-primary" type="submit">
            {t('admin.machines.bulkCreate')}
          </button>
          {status && <span className="meta">{status}</span>}
        </div>
      </form>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {machines.map((m) => (
          <li key={m.id} className="panel" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>
              {shedById.get(m.shedId)?.code ?? ''}
              {m.machineNo}
            </span>
            <button className="btn" style={{ minHeight: 32, padding: '0 8px' }} onClick={() => void toggleActive(m)}>
              {t(m.active ? 'common.deactivate' : 'common.activate')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
