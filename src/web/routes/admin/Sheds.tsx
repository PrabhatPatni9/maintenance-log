import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { useAuth } from '../../lib/auth-context';
import { api } from '../../lib/api';
import type { Machine, Shed } from '@shared/types';

export function Sheds() {
  const t = useT();
  const { user } = useAuth();
  // Only the owner tier creates, switches off, or removes a shed. A plain
  // admin still needs to see this list — it is how they know what they are
  // working with — just without the controls that act on the shed itself
  // (they still manage the machines inside it, from the Machines tab).
  const isSuperAdmin = user?.role === 'super_admin';
  const [sheds, setSheds] = useState<Shed[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  function refresh() {
    void api.get<{ sheds: Shed[] }>('/sheds').then((r) => setSheds(r.sheds));
    void api.get<{ machines: Machine[] }>('/machines').then((r) => setMachines(r.machines));
  }
  useEffect(refresh, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/sheds', { code, name });
      setCode('');
      setName('');
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(shed: Shed) {
    await api.patch(`/sheds/${shed.id}`, { active: !shed.active });
    refresh();
  }

  async function hardDelete(shed: Shed) {
    if (!window.confirm(t('admin.sheds.deleteConfirm', { name: shed.name }))) return;
    await api.del<{ deleted: { machines: number; logs: number } }>(`/sheds/${shed.id}`);
    refresh();
  }

  return (
    <div>
      <h1 className="screen-title" style={{ marginBottom: 6 }}>
        {t('admin.sheds.title')}
      </h1>
      <p className="meta" style={{ marginBottom: 20 }}>
        {isSuperAdmin ? t('admin.sheds.hint') : t('admin.sheds.readOnlyHint')}
      </p>

      {isSuperAdmin && (
        <form onSubmit={add} className="panel form-row" style={{ padding: 16, marginBottom: 24 }}>
          <div style={{ width: 110 }}>
            <label className="field-label">{t('admin.sheds.codeLabel')}</label>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={4} />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label className="field-label">{t('admin.sheds.nameLabel')}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {t('admin.sheds.addShed')}
          </button>
        </form>
      )}

      <ul className="stack-list">
        {sheds.map((s) => {
          const inShed = machines.filter((m) => m.shedId === s.id);
          const activeCount = inShed.filter((m) => m.active).length;
          return (
            <li key={s.id} className={`panel record-row${s.active ? '' : ' is-off'}`}>
              <div className="shed-badge">{s.code}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 17 }}>{s.name}</div>
                <div className="meta">
                  {inShed.length} {inShed.length === 1 ? 'machine' : 'machines'}
                  {inShed.length > 0 && ` · ${activeCount} on`}
                  {!s.active && ` · ${t('common.inactive')}`}
                </div>
              </div>
              {isSuperAdmin && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-small" onClick={() => void toggleActive(s)}>
                    {t(s.active ? 'common.deactivate' : 'common.activate')}
                  </button>
                  <button className="btn btn-small btn-danger" onClick={() => void hardDelete(s)}>
                    {t('admin.sheds.deleteShed')}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {sheds.length === 0 && <p className="meta">{t('admin.sheds.empty')}</p>}
    </div>
  );
}
