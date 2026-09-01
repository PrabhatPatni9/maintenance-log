import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useT } from '../i18n';
import { RequireAuth } from '../lib/guards';
import { db } from '../lib/db';
import type { CachedMachine, CachedShed } from '../lib/db';
import { refreshMachines } from '../lib/machines-cache';

/** Numeric-aware compare so "2" sorts before "10". Machine numbers are
 * painted-on-the-loom digits (CLAUDE.md), so a plain numeric comparison
 * covers the real world; anything non-numeric just falls back to text. */
function compareMachineNo(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

/**
 * Two steps: pick the shed (skipped entirely if the operator only has one —
 * most operators do), then pick the machine from that shed's pre-loaded
 * list. Machines are pre-loaded by the admin; the operator just taps one.
 */
function MachinePickerInner() {
  const t = useT();
  const navigate = useNavigate();
  const [sheds, setSheds] = useState<CachedShed[]>([]);
  const [machines, setMachines] = useState<CachedMachine[]>([]);
  const [selectedShedId, setSelectedShedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void loadCached();
    void refreshMachines()
      .then(loadCached)
      .catch(() => {});
  }, []);

  async function loadCached() {
    const [s, m] = await Promise.all([db.sheds.toArray(), db.machines.toArray()]);
    setSheds(s);
    setMachines(m);

    // Home's shed cards jump straight in here with a shed already chosen.
    const preselected = sessionStorage.getItem('preselectedShedId');
    sessionStorage.removeItem('preselectedShedId');
    if (preselected && s.some((sh) => sh.id === preselected)) {
      setSelectedShedId(preselected);
      return;
    }
    // Only one shed to see? Skip the shed-picking step entirely.
    if (s.length === 1) setSelectedShedId(s[0]!.id);
  }

  const machinesInShed = useMemo(() => {
    if (!selectedShedId) return [];
    const q = query.trim().toLowerCase();
    return machines
      .filter((m) => m.shedId === selectedShedId)
      .filter((m) => !q || m.machineNo.toLowerCase().includes(q))
      .sort((a, b) => compareMachineNo(a.machineNo, b.machineNo));
  }, [machines, selectedShedId, query]);

  const selectedShed = sheds.find((s) => s.id === selectedShedId);

  // Step 1: shed picker — only when there's a real choice to make.
  if (!selectedShedId) {
    return (
      <div className="screen">
        <h1 className="screen-title" style={{ marginBottom: 20 }}>
          {t('machine.pickShedTitle')}
        </h1>
        {sheds.length === 0 && <p className="meta">{t('machine.noSheds')}</p>}
        <ul className="stack-list">
          {sheds.map((s) => (
            <li key={s.id}>
              <button
                className="btn btn-block shed-choice"
                onClick={() => setSelectedShedId(s.id)}
              >
                <span className="shed-choice-code">{s.code}</span>
                <span>{s.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Step 2: machine picker within the chosen shed.
  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="screen-title">
          {selectedShed ? `${selectedShed.code} — ${selectedShed.name}` : t('machine.pickerTitle')}
        </h1>
        {sheds.length > 1 && (
          <button className="btn btn-small" onClick={() => setSelectedShedId(null)}>
            {t('common.back')}
          </button>
        )}
      </div>

      <input
        className="input"
        style={{ marginBottom: 20 }}
        placeholder={t('machine.searchPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      {machinesInShed.length === 0 && <p className="meta">{t('machine.noMachines')}</p>}

      <div className="machine-grid">
        {machinesInShed.map((m) => (
          <button
            key={m.id}
            className="machine-tile"
            onClick={() => void navigate({ to: '/record/$machineId', params: { machineId: m.id } })}
          >
            {m.machineNo}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MachinePicker() {
  return (
    <RequireAuth>
      <MachinePickerInner />
    </RequireAuth>
  );
}
