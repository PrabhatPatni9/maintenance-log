import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import type { Shed } from '@shared/types';

interface HistoryRow {
  log_id: string;
  client_created_at: number;
  transcript: string | null;
  shed_code: string;
  machine_no: string;
  operator_name: string;
  item_code: string | null;
  label_en: string | null;
  qty: number | null;
  unit: string | null;
}

export function History() {
  const t = useT();
  const [sheds, setSheds] = useState<Shed[]>([]);
  const [shedId, setShedId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<HistoryRow | null>(null);
  const [editText, setEditText] = useState('');
  const [editReason, setEditReason] = useState('');

  useEffect(() => {
    void api.get<{ sheds: Shed[] }>('/sheds').then((r) => setSheds(r.sheds));
  }, []);

  function query(): string {
    const params = new URLSearchParams();
    if (shedId) params.set('shedId', shedId);
    if (dateFrom) params.set('dateFrom', String(new Date(dateFrom).getTime()));
    if (dateTo) params.set('dateTo', String(new Date(dateTo).getTime()));
    params.set('page', String(page));
    return params.toString();
  }

  function search() {
    void api.get<{ rows: HistoryRow[] }>(`/admin/history?${query()}`).then((r) => setRows(r.rows));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(search, [page]);

  function exportCsv() {
    const params = new URLSearchParams();
    if (shedId) params.set('shedId', shedId);
    if (dateFrom) params.set('dateFrom', String(new Date(dateFrom).getTime()));
    if (dateTo) params.set('dateTo', String(new Date(dateTo).getTime()));
    window.open(`/api/admin/history/export.csv?${params.toString()}`, '_blank');
  }

  async function saveEdit() {
    if (!editing || !editReason.trim()) return;
    await api.patch(`/admin/history/logs/${editing.log_id}`, {
      field: 'transcript',
      valueAfter: editText,
      reason: editReason,
    });
    setEditing(null);
    setEditReason('');
    search();
  }

  return (
    <div>
      <h1 className="screen-title" style={{ marginBottom: 20 }}>
        {t('admin.history.title')}
      </h1>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <select className="btn" value={shedId} onChange={(e) => setShedId(e.target.value)}>
          <option value="">{t('admin.history.filterShed')}</option>
          {sheds.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code}
            </option>
          ))}
        </select>
        <input className="btn" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input className="btn" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <button
          className="btn btn-primary"
          onClick={() => {
            setPage(0);
            search();
          }}
        >
          {t('common.search')}
        </button>
        <button className="btn" onClick={exportCsv}>
          {t('admin.history.exportCsv')}
        </button>
      </div>

      {rows.length === 0 && <p className="meta">{t('admin.history.noResults')}</p>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.log_id}-${r.item_code}-${i}`} style={{ borderBottom: '1px solid var(--line)' }}>
                <td style={{ padding: 8 }}>{new Date(r.client_created_at).toLocaleDateString()}</td>
                <td style={{ padding: 8 }}>
                  {r.shed_code}
                  {r.machine_no}
                </td>
                <td style={{ padding: 8 }}>{r.operator_name}</td>
                <td style={{ padding: 8 }}>{r.label_en ?? ''}</td>
                <td style={{ padding: 8, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.transcript}
                </td>
                <td style={{ padding: 8 }}>
                  <button
                    className="btn"
                    style={{ minHeight: 36, padding: '0 10px' }}
                    onClick={() => {
                      setEditing(r);
                      setEditText(r.transcript ?? '');
                    }}
                  >
                    {t('common.edit')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
          {t('common.back')}
        </button>
        <button className="btn" onClick={() => setPage((p) => p + 1)}>
          {t('common.next')}
        </button>
      </div>

      {editing && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div className="panel" style={{ padding: 20, maxWidth: 480, width: '100%' }}>
            <h2 style={{ marginBottom: 12 }}>{t('admin.history.editLog')}</h2>
            <textarea className="panel" style={{ width: '100%', minHeight: 100, padding: 12, marginBottom: 12 }} value={editText} onChange={(e) => setEditText(e.target.value)} />
            <input
              className="btn btn-block"
              style={{ textAlign: 'left', marginBottom: 12 }}
              placeholder={t('logDetail.editReason')}
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
            />
            {!editReason.trim() && <p className="meta" style={{ marginBottom: 12 }}>{t('admin.history.editReasonRequired')}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-block" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary btn-block" disabled={!editReason.trim()} onClick={() => void saveEdit()}>
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
