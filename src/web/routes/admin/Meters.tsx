import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { useAuth } from '../../lib/auth-context';
import { api, ApiError } from '../../lib/api';
import type { Machine, Meter, Shed } from '@shared/types';

/**
 * Meters are add/edit-able by any shed-scoped admin, not just the owner
 * tier — unlike machines. Delete is still owner-tier only, same reasoning
 * as everywhere else genuinely destructive (it removes every reading the
 * meter ever recorded).
 */
export function Meters() {
  const t = useT();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [sheds, setSheds] = useState<Shed[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [shedId, setShedId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [addError, setAddError] = useState('');
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<Meter | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const [assigning, setAssigning] = useState<Meter | null>(null);

  function refresh() {
    void api.get<{ sheds: Shed[] }>('/sheds').then((r) => {
      setSheds(r.sheds);
      if (!shedId && r.sheds[0]) setShedId(r.sheds[0].id);
    });
    void api.get<{ meters: Meter[] }>('/meters').then((r) => setMeters(r.meters));
    void api.get<{ machines: Machine[] }>('/machines').then((r) => setMachines(r.machines));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, []);

  async function addMeter(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setAddError('');
    try {
      await api.post('/meters', { shedId, code, name: name || undefined });
      setCode('');
      setName('');
      refresh();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : t('meters.saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(m: Meter) {
    await api.patch(`/meters/${m.id}`, { active: !m.active });
    refresh();
  }

  async function hardDelete(m: Meter) {
    if (!window.confirm(t('admin.meters.deleteConfirm', { code: m.code }))) return;
    await api.del(`/meters/${m.id}`);
    refresh();
  }

  function openEdit(m: Meter) {
    setEditing(m);
    setEditCode(m.code);
    setEditName(m.name ?? '');
    setEditError('');
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditBusy(true);
    setEditError('');
    try {
      await api.patch(`/meters/${editing.id}`, { code: editCode, name: editName || null });
      setEditing(null);
      refresh();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : t('meters.saveError'));
    } finally {
      setEditBusy(false);
    }
  }

  async function setMachineMeter(machineId: string, meterId: string | null) {
    await api.patch(`/machines/${machineId}`, { meterId });
    refresh();
  }

  const metersByShed = sheds.map((s) => ({ shed: s, meters: meters.filter((m) => m.shedId === s.id) }));

  return (
    <div>
      <h1 className="screen-title" style={{ marginBottom: 6 }}>
        {t('admin.meters.title')}
      </h1>
      <p className="meta" style={{ marginBottom: 20 }}>
        {t('admin.meters.hint')}
      </p>

      <form onSubmit={addMeter} className="panel stacked-form">
        <div>
          <label className="field-label">{t('admin.sheds.title')}</label>
          <select className="input" value={shedId} onChange={(e) => setShedId(e.target.value)}>
            {sheds.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field-pair">
          <div>
            <label className="field-label">{t('admin.meters.codeLabel')}</label>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={10} />
          </div>
          <div>
            <label className="field-label">{t('admin.meters.nameLabel')}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        {addError && <p style={{ color: 'var(--fault)', margin: 0 }}>{addError}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {t('admin.meters.addMeter')}
        </button>
      </form>

      {metersByShed.map(({ shed, meters: shedMeters }) => (
        <div key={shed.id} style={{ marginBottom: 28 }}>
          <div className="group-head">
            <div className="shed-badge">{shed.code}</div>
            <span style={{ fontWeight: 600 }}>{shed.name}</span>
          </div>
          {shedMeters.length === 0 ? (
            <p className="meta">{t('meters.noMeters')}</p>
          ) : (
            <ul className="stack-list">
              {shedMeters.map((m) => {
                const machineCount = machines.filter((mc) => mc.meterId === m.id).length;
                return (
                  <li key={m.id} className={`panel record-row${m.active ? '' : ' is-off'}`} style={{ flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>
                        {m.code} {m.name && `· ${m.name}`}
                      </div>
                      <div className="meta">
                        {machineCount} {t('admin.meters.machinesOnThis')}
                        {!m.active && ` · ${t('common.inactive')}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', width: '100%', justifyContent: 'flex-end' }}>
                      <button className="btn btn-small" onClick={() => setAssigning(assigning?.id === m.id ? null : m)}>
                        {t('admin.meters.assignMachines')}
                      </button>
                      <button className="btn btn-small" onClick={() => openEdit(m)}>
                        {t('admin.sheds.edit')}
                      </button>
                      <button className="btn btn-small" onClick={() => void toggleActive(m)}>
                        {t(m.active ? 'common.deactivate' : 'common.activate')}
                      </button>
                      {isSuperAdmin && (
                        <button className="btn btn-small btn-danger" onClick={() => void hardDelete(m)}>
                          {t('admin.sheds.deleteShed')}
                        </button>
                      )}
                    </div>

                    {assigning?.id === m.id && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)', width: '100%' }}>
                        <div className="shed-check-list">
                          {machines
                            .filter((mc) => mc.shedId === shed.id)
                            .map((mc) => {
                              const onThisMeter = mc.meterId === m.id;
                              const onOtherMeter = mc.meterId && mc.meterId !== m.id;
                              return (
                                <label key={mc.id} className={`shed-check-row${onThisMeter ? ' is-checked' : ''}`}>
                                  <input
                                    type="checkbox"
                                    checked={onThisMeter}
                                    onChange={() => void setMachineMeter(mc.id, onThisMeter ? null : m.id)}
                                  />
                                  <span>{mc.machineNo}</span>
                                  {onOtherMeter && (
                                    <span className="meta">
                                      {t('admin.meters.onAnotherMeter', {
                                        code: meters.find((x) => x.id === mc.meterId)?.code ?? '',
                                      })}
                                    </span>
                                  )}
                                </label>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="panel modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 16 }}>{t('admin.sheds.edit')}</h2>
            <form onSubmit={saveEdit}>
              <label className="field-label">{t('admin.meters.codeLabel')}</label>
              <input
                className="input"
                style={{ marginBottom: 12 }}
                value={editCode}
                onChange={(e) => setEditCode(e.target.value)}
                required
                maxLength={10}
              />
              <label className="field-label">{t('admin.meters.nameLabel')}</label>
              <input
                className="input"
                style={{ marginBottom: 20 }}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              {editError && <p style={{ color: 'var(--fault)', marginBottom: 12 }}>{editError}</p>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-block" type="button" onClick={() => setEditing(null)}>
                  {t('common.cancel')}
                </button>
                <button className="btn btn-primary btn-block" type="submit" disabled={editBusy}>
                  {t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
