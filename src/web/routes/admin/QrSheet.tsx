import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import type { Machine, Shed } from '@shared/types';

interface Sticker {
  machineNo: string;
  shedCode: string;
  dataUrl: string;
}

/** A4 sticker sheet: printed via the browser's own print dialog rather than
 * a generated PDF file, so there is no PDF library dependency — just a page
 * styled for @media print (AGENTS.md: no new dependency without saying why). */
export function QrSheet() {
  const t = useT();
  const [sheds, setSheds] = useState<Shed[]>([]);
  const [shedId, setShedId] = useState('');
  const [stickers, setStickers] = useState<Sticker[]>([]);

  useEffect(() => {
    void api.get<{ sheds: Shed[] }>('/sheds').then((r) => setSheds(r.sheds));
  }, []);

  async function generate() {
    const { machines } = await api.get<{ machines: Machine[] }>(`/machines?shedId=${shedId}`);
    const shed = sheds.find((s) => s.id === shedId);
    const built = await Promise.all(
      machines
        .filter((m) => m.active)
        .map(async (m) => ({
          machineNo: m.machineNo,
          shedCode: shed?.code ?? '',
          dataUrl: await QRCode.toDataURL(m.id, { margin: 1, width: 200 }),
        })),
    );
    setStickers(built);
  }

  return (
    <div>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .sticker-sheet { display: grid !important; grid-template-columns: repeat(3, 1fr); gap: 12mm; padding: 10mm; }
        }
      `}</style>

      <div className="no-print">
        <h1 className="screen-title" style={{ marginBottom: 20 }}>
          {t('admin.qr.sheetTitle')}
        </h1>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <select className="btn" value={shedId} onChange={(e) => setShedId(e.target.value)}>
            <option value="">{t('admin.history.filterShed')}</option>
            {sheds.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={() => void generate()} disabled={!shedId}>
            {t('admin.qr.generateSheet')}
          </button>
          {stickers.length > 0 && (
            <button className="btn" onClick={() => window.print()}>
              Print
            </button>
          )}
        </div>
        {stickers.length > 0 && <p className="meta">{t('admin.qr.printHint')}</p>}
      </div>

      {stickers.length > 0 && (
        <div className="sticker-sheet" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {stickers.map((s) => (
            <div key={s.machineNo} style={{ textAlign: 'center', border: '1px solid var(--line)', padding: 12 }}>
              <div className="machine-number" style={{ fontSize: 28, marginBottom: 8 }}>
                {s.shedCode}
                {s.machineNo}
              </div>
              <img src={s.dataUrl} alt="" style={{ width: '100%', maxWidth: 160 }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
