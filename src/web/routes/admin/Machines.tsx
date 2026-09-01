import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import type { Machine, Shed } from '@shared/types';

function compareMachineNo(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

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

  const machinesByShed = sheds.map((s) => ({
    shed: s,
    machines: machines.filter((m) => m.shedId === s.id).sort((a, b) => compareMachineNo(a.machineNo, b.machineNo)),
  }));

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
          <select className="input" value={shedId} onChange={(e) => setShedId(e.target.value)} style={{ minWidth: 140, flex: 'none' }}>
            {sheds.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
          <input className="input" placeholder="1-56" value={range} onChange={(e) => setRange(e.target.value)} required style={{ width: 120, flex: 'none' }} />
          <input
            className="input"
            placeholder={t('admin.machines.loomTypeLabel')}
            value={loomType}
            onChange={(e) => setLoomType(e.target.value)}
            style={{ width: 160, flex: 'none' }}
          />
          <button className="btn btn-primary" type="submit">
            {t('admin.machines.bulkCreate')}
          </button>
          {status && <span className="meta">{status}</span>}
        </div>
      </form>

      {machinesByShed.map(({ shed, machines: shedMachines }) => (
        <div key={shed.id} style={{ marginBottom: 28 }}>
          <div className="group-head">
            <div className={`shed-badge${shed.active ? '' : ' is-off'}`}>{shed.code}</div>
            <span style={{ fontWeight: 600 }}>{shed.name}</span>
            <span className="meta">
              {shedMachines.length} · {shedMachines.filter((m) => m.active).length} on
            </span>
          </div>
          {shedMachines.length === 0 ? (
            <p className="meta">{t('machine.noMachines')}</p>
          ) : (
            /* Tap the number to toggle it. A grid of numbers is how the shed
               floor is actually laid out, and it beats a list of rows with a
               button on each when there are 56 of them. */
            <div className="machine-grid">
              {shedMachines.map((m) => (
                <button
                  key={m.id}
                  className={`machine-tile${m.active ? '' : ' is-off'}`}
                  onClick={() => void toggleActive(m)}
                  title={t(m.active ? 'common.deactivate' : 'common.activate')}
                >
                  {m.machineNo}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
