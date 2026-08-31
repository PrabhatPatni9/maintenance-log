import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useT } from '../i18n';
import { RequireAuth } from '../lib/guards';
import { db } from '../lib/db';
import type { CachedMachine } from '../lib/db';
import { refreshMachines } from '../lib/machines-cache';
import { startQrScan, type QrScanner } from '../lib/qr';

function MachinePickerInner() {
  const t = useT();
  const navigate = useNavigate();
  const [machines, setMachines] = useState<CachedMachine[]>([]);
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);

  useEffect(() => {
    // Show whatever is cached immediately — this must work offline — then
    // refresh from the server and re-read once that lands.
    void db.machines.toArray().then(setMachines);
    void refreshMachines()
      .then(() => db.machines.toArray())
      .then(setMachines)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!scanning || !videoRef.current) return;
    let cancelled = false;
    startQrScan(videoRef.current, (payload) => {
      if (cancelled) return;
      cancelled = true;
      scannerRef.current?.stop();
      const known = machines.find((m) => m.id === payload);
      if (known) {
        void navigate({ to: '/record/$machineId', params: { machineId: known.id } });
      } else {
        setScanError(true);
        setScanning(false);
      }
    })
      .then((s) => (scannerRef.current = s))
      .catch(() => setScanning(false));

    return () => {
      cancelled = true;
      scannerRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? machines.filter((m) => m.machineNo.toLowerCase().includes(q)) : machines;
    const bySheds = new Map<string, CachedMachine[]>();
    for (const m of filtered) {
      const list = bySheds.get(m.shedName) ?? [];
      list.push(m);
      bySheds.set(m.shedName, list);
    }
    return [...bySheds.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [machines, query]);

  return (
    <div style={{ padding: 20, maxWidth: 480, margin: '0 auto' }}>
      <h1 className="screen-title" style={{ marginBottom: 16 }}>
        {t('machine.pickerTitle')}
      </h1>

      {scanning ? (
        <div>
          <video ref={videoRef} style={{ width: '100%', background: '#000' }} muted playsInline />
          <p className="meta" style={{ marginTop: 8 }}>
            {t('machine.scanQrTitle')}
          </p>
          <button className="btn btn-block" style={{ marginTop: 12 }} onClick={() => setScanning(false)}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <button
          className="btn btn-primary btn-block"
          style={{ marginBottom: 16 }}
          onClick={() => {
            setScanError(false);
            setScanning(true);
          }}
        >
          {t('machine.scanQr')}
        </button>
      )}
      {scanError && <p style={{ color: 'var(--fault)', marginBottom: 12 }}>{t('machine.qrNotFound')}</p>}

      <input
        className="btn btn-block"
        style={{ textAlign: 'left', marginBottom: 20 }}
        placeholder={t('machine.searchPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {grouped.length === 0 && <p className="meta">{t('machine.noMachines')}</p>}

      {grouped.map(([shedName, list]) => (
        <div key={shedName} style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, color: 'var(--steel)', marginBottom: 8 }}>{shedName}</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {list.map((m) => (
              <li key={m.id}>
                <button
                  className="btn"
                  style={{ minWidth: 64 }}
                  onClick={() => void navigate({ to: '/record/$machineId', params: { machineId: m.id } })}
                >
                  {m.machineNo}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
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
