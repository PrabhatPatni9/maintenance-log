import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useLang, useT } from '../i18n';
import { RequireAuth } from '../lib/guards';
import { useAuth } from '../lib/auth-context';
import { db } from '../lib/db';
import type { CachedMachine, CachedTaxonomyItem } from '../lib/db';
import { getAllTaxonomy, matchTranscript } from '../lib/match';
import { useCapture } from '../lib/useCapture';
import { getSttMode } from '../lib/config';
import { ensureDraftLog, saveSegment, sourceFor, finalizeAndQueue } from '../lib/draft-log';
import { uuidv7 } from '@shared/id';
import { CaptureRing, CAPTURE_INNER_MS } from '../components/CaptureRing';
import { PillList } from '../components/PillList';

type Phase = 'capture' | 'segment-review' | 'log-review';

function RecordInner() {
  const t = useT();
  const { lang } = useLang();
  const { user } = useAuth();
  const { machineId } = useParams({ from: '/record/$machineId' });
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>('capture');
  const [machine, setMachine] = useState<CachedMachine | null>(null);
  const [taxonomy, setTaxonomy] = useState<CachedTaxonomyItem[]>([]);
  const [transcript, setTranscript] = useState('');
  const [typedNote, setTypedNote] = useState('');
  const [items, setItems] = useState<Record<string, 'auto' | 'manual'>>({});
  const [lastProducedText, setLastProducedText] = useState(true);

  const logIdRef = useRef(uuidv7());
  const seqRef = useRef(0);
  const segmentTextsRef = useRef<string[]>([]);

  const capture = useCapture(lang, () => void handleStop());

  useEffect(() => {
    void db.machines.get(machineId).then((m) => m && setMachine(m));
    void getAllTaxonomy().then(setTaxonomy);
    void capture.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId]);

  async function handleStop() {
    const result = await capture.stop();
    const sttMode = await getSttMode();
    const source = sourceFor(result, sttMode === 'local_only');

    await ensureDraftLog(logIdRef.current, machineId, user!.phone, lang);
    await saveSegment(logIdRef.current, seqRef.current, result, source);
    seqRef.current += 1;
    segmentTextsRef.current.push(result.transcript);

    setLastProducedText(result.producedText);
    setTranscript(result.transcript);

    if (result.transcript) {
      const matches = await matchTranscript(result.transcript);
      setItems((prev) => {
        const next = { ...prev };
        for (const m of matches) if (!(m.code in next)) next[m.code] = 'auto';
        return next;
      });
    }
    setPhase('segment-review');
  }

  async function handleAddMore() {
    setPhase('capture');
    await capture.start();
  }

  async function handleSegmentDone() {
    // If Web Speech never produced anything, the typed note is standing in
    // for the transcript (CLAUDE.md section 6) — it needs the same matcher
    // pass a real transcript gets, or pills the operator clearly typed
    // (e.g. "oil change kela") would silently never appear.
    const joined = segmentTextsRef.current.filter(Boolean).join(' ').trim();
    const combined = joined || typedNote.trim();
    setTranscript(combined);

    if (combined) {
      const matches = await matchTranscript(combined);
      setItems((prev) => {
        const next = { ...prev };
        for (const m of matches) if (!(m.code in next)) next[m.code] = 'auto';
        return next;
      });
    }
    setPhase('log-review');
  }

  async function handleApprove() {
    await finalizeAndQueue(logIdRef.current, transcript, typedNote, items);
    void navigate({ to: '/' });
  }

  function toggle(code: string) {
    setItems((prev) => {
      const next = { ...prev };
      delete next[code];
      return next;
    });
  }
  function add(code: string) {
    setItems((prev) => ({ ...prev, [code]: 'manual' }));
  }

  if (phase === 'capture') {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--base)' }}>
        <div style={{ padding: 20, textAlign: 'center' }}>
          <span className="meta">
            {machine ? `${t('review.machineLabel')} ${machine.machineNo} · ${machine.shedName}` : ''}
          </span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          {capture.permissionDenied ? (
            <p style={{ color: 'var(--fault)', padding: 24, textAlign: 'center' }}>{t('capture.permissionNeeded')}</p>
          ) : (
            <>
              <div style={{ position: 'relative', width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CaptureRing elapsedMs={capture.elapsedMs} />
                <div
                  style={{
                    position: 'absolute',
                    width: 96,
                    height: 96,
                    borderRadius: '50%',
                    background: 'var(--amber)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                  }}
                >
                  REC
                </div>
              </div>
              <p className="machine-number" style={{ fontSize: 28 }}>
                {capture.elapsedMs >= CAPTURE_INNER_MS
                  ? t('capture.wrappingUp')
                  : `0:${String(Math.max(0, 45 - Math.floor(capture.elapsedMs / 1000))).padStart(2, '0')}`}
              </p>
              <p style={{ maxWidth: 320, textAlign: 'center', minHeight: 72 }}>
                <span style={{ color: 'var(--steel)' }}>{capture.interimText}</span>
                <span> {capture.finalText}</span>
              </p>
            </>
          )}
        </div>
        <div style={{ padding: 20 }}>
          <button className="btn btn-block" style={{ minHeight: 56 }} onClick={() => void handleStop()}>
            {t('capture.stopButton')}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'segment-review') {
    return (
      <div className="screen">
        {!lastProducedText && <p className="meta">{t('capture.savedOffline')}</p>}
        <h2 style={{ fontSize: 15, color: 'var(--steel)', margin: '16px 0 8px' }}>{t('segment.transcriptLabel')}</h2>
        <textarea
          className="panel"
          style={{ width: '100%', minHeight: 100, padding: 12, fontSize: 17 }}
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
        />
        {!lastProducedText && (
          <div style={{ marginTop: 12 }}>
            <label className="meta">{t('capture.typedNoteLabel')}</label>
            <textarea
              className="panel"
              style={{ width: '100%', minHeight: 60, padding: 12, fontSize: 17, marginTop: 4 }}
              placeholder={t('capture.typedNotePlaceholder')}
              value={typedNote}
              onChange={(e) => setTypedNote(e.target.value)}
            />
          </div>
        )}

        <h2 style={{ fontSize: 15, color: 'var(--steel)', margin: '20px 0 8px' }}>{t('review.itemsLabel')}</h2>
        <PillList all={taxonomy} selected={Object.entries(items).map(([code, origin]) => ({ code, origin }))} onToggle={toggle} onAdd={add} />

        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
          <button className="btn btn-block" onClick={() => void handleAddMore()}>
            {t('segment.addMore')}
          </button>
          <button className="btn btn-primary btn-block" onClick={() => void handleSegmentDone()}>
            {t('segment.doneButton')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <h1 className="screen-title" style={{ marginBottom: 4 }}>
        {t('review.title')}
      </h1>
      <p className="meta" style={{ marginBottom: 20 }}>
        {machine ? `${machine.machineNo} · ${machine.shedName}` : ''} · {new Date().toLocaleDateString()}
      </p>

      <h2 style={{ fontSize: 15, color: 'var(--steel)', marginBottom: 8 }}>{t('segment.transcriptLabel')}</h2>
      <textarea
        className="panel"
        style={{ width: '100%', minHeight: 100, padding: 12, fontSize: 17, marginBottom: 20 }}
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
      />

      <h2 style={{ fontSize: 15, color: 'var(--steel)', marginBottom: 8 }}>{t('review.itemsLabel')}</h2>
      <PillList all={taxonomy} selected={Object.entries(items).map(([code, origin]) => ({ code, origin }))} onToggle={toggle} onAdd={add} />

      <button className="btn btn-amber btn-block" style={{ marginTop: 32, minHeight: 64, fontSize: 20 }} onClick={() => void handleApprove()}>
        {t('review.approveButton')}
      </button>
    </div>
  );
}

export function Record() {
  return (
    <RequireAuth>
      <RecordInner />
    </RequireAuth>
  );
}
