import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useT } from '../i18n';
import { RequireAuth } from '../lib/guards';
import { db } from '../lib/db';
import type { CachedMachine, CachedShed } from '../lib/db';
import { refreshMachines } from '../lib/machines-cache';
import { startQrScan, type QrScanner } from '../lib/qr';

/**
 * Two steps: pick the shed (skipped entirely if the operator only has one —
 * most operators do), then pick the machine from that shed's pre-loaded
 * list. No QR scan required; it's there as a small fallback link for the
 * rare admin who wants it, not the primary path (per the product owner:
 * operators just pick shed, then machine).
 */
function MachinePickerInner() {
  const t = useT();
  const navigate = useNavigate();
  const [sheds, setSheds] = useState<CachedShed[]>([]);
  const [machines, setMachines] = useState<CachedMachine[]>([]);
  const [selectedShedId, setSelectedShedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);

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
    // Only one shed to see? Skip the shed-picking step entirely.
    if (s.length === 1) setSelectedShedId(s[0]!.id);
  }

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

  const machinesInShed = useMemo(() => {
    if (!selectedShedId) return [];
    const q = query.trim().toLowerCase();
    return machines
      .filter((m) => m.shedId === selectedShedId)
      .filter((m) => !q || m.machineNo.toLowerCase().includes(q));
  }, [machines, selectedShedId, query]);

  const selectedShed = sheds.find((s) => s.id === selectedShedId);

  if (scanning) {
    return (
      <div style={{ padding: 20, maxWidth: 480, margin: '0 auto' }}>
        <video ref={videoRef} style={{ width: '100%', background: '#000' }} muted playsInline />
        <p className="meta" style={{ marginTop: 8 }}>
          {t('machine.scanQrTitle')}
        </p>
        <button className="btn btn-block" style={{ marginTop: 12 }} onClick={() => setScanning(false)}>
          {t('common.cancel')}
        </button>
      </div>
    );
  }

  // Step 1: shed picker — only when there's a real choice to make.
  if (!selectedShedId) {
    return (
      <div style={{ padding: 20, maxWidth: 480, margin: '0 auto' }}>
        <h1 className="screen-title" style={{ marginBottom: 16 }}>
          {t('machine.pickShedTitle')}
        </h1>
        {sheds.length === 0 && <p className="meta">{t('machine.noSheds')}</p>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sheds.map((s) => (
            <li key={s.id}>
              <button
                className="btn btn-block"
                style={{ minHeight: 64, fontSize: 20, fontWeight: 600 }}
                onClick={() => setSelectedShedId(s.id)}
              >
                {s.code} — {s.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Step 2: machine picker within the chosen shed.
  return (
    <div style={{ padding: 20, maxWidth: 480, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 className="screen-title">
          {selectedShed ? `${selectedShed.code} — ${selectedShed.name}` : t('machine.pickerTitle')}
        </h1>
        {sheds.length > 1 && (
          <button className="btn" style={{ minHeight: 40 }} onClick={() => setSelectedShedId(null)}>
            {t('common.back')}
          </button>
        )}
      </div>

      <input
        className="btn btn-block"
        style={{ textAlign: 'left', marginBottom: 20 }}
        placeholder={t('machine.searchPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      {machinesInShed.length === 0 && <p className="meta">{t('machine.noMachines')}</p>}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {machinesInShed.map((m) => (
          <li key={m.id}>
            <button
              className="btn"
              style={{ minWidth: 72, minHeight: 56, fontSize: 18 }}
              onClick={() => void navigate({ to: '/record/$machineId', params: { machineId: m.id } })}
            >
              {m.machineNo}
            </button>
          </li>
        ))}
      </ul>

      {scanError && <p style={{ color: 'var(--fault)', marginTop: 16 }}>{t('machine.qrNotFound')}</p>}
      <button
        className="meta"
        style={{ background: 'none', border: 'none', marginTop: 24, textDecoration: 'underline', padding: 0 }}
        onClick={() => {
          setScanError(false);
          setScanning(true);
        }}
      >
        {t('machine.scanQr')}
      </button>
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
