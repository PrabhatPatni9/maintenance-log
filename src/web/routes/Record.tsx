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

type Phase = 'capture' | 'review';

function RecordInner() {
  const t = useT();
  const { lang } = useLang();
  const { user } = useAuth();
  const { machineId } = useParams({ from: '/record/$machineId' });
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>('capture');
  const [machine, setMachine] = useState<CachedMachine | null>(null);
  const [taxonomy, setTaxonomy] = useState<CachedTaxonomyItem[]>([]);
  // One authoritative piece of text for the whole log. Whatever is in here is
  // what gets saved — spoken, typed, or spoken then corrected. There is no
  // second hidden field that silently wins over it.
  const [transcript, setTranscript] = useState('');
  const [items, setItems] = useState<Record<string, 'auto' | 'manual'>>({});

  const logIdRef = useRef(uuidv7());
  const seqRef = useRef(0);
  // Codes the operator deliberately removed. The matcher re-runs as they edit
  // the text, and without this it would keep putting back the pill they just
  // took off.
  const dismissedRef = useRef<Set<string>>(new Set());

  const capture = useCapture(lang, () => void handleStop());

  useEffect(() => {
    void db.machines.get(machineId).then((m) => m && setMachine(m));
    void getAllTaxonomy().then(setTaxonomy);
    void capture.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId]);

  // Re-match whenever the text settles, so typing or correcting a word selects
  // the right pills instead of only the original speech being considered.
  useEffect(() => {
    if (phase !== 'review') return;
    const text = transcript.trim();
    if (!text) return;
    const timer = setTimeout(() => {
      void matchTranscript(text).then((matches) => {
        setItems((prev) => {
          const next = { ...prev };
          for (const m of matches) {
            if (!(m.code in next) && !dismissedRef.current.has(m.code)) next[m.code] = 'auto';
          }
          return next;
        });
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [transcript, phase]);

  async function handleStop() {
    const result = await capture.stop();
    const sttMode = await getSttMode();
    const source = sourceFor(result, sttMode === 'local_only');

    await ensureDraftLog(logIdRef.current, machineId, user!.phone, lang);
    await saveSegment(logIdRef.current, seqRef.current, result, source);
    seqRef.current += 1;

    // Append, so "record more" adds to the note instead of replacing it.
    setTranscript((prev) => [prev.trim(), result.transcript.trim()].filter(Boolean).join(' '));
    setPhase('review');
  }

  async function handleRecordMore() {
    setPhase('capture');
    await capture.start();
  }

  async function handleApprove() {
    await finalizeAndQueue(logIdRef.current, transcript, '', items);
    void navigate({ to: '/' });
  }

  function toggle(code: string) {
    dismissedRef.current.add(code);
    setItems((prev) => {
      const next = { ...prev };
      delete next[code];
      return next;
    });
  }
  function add(code: string) {
    dismissedRef.current.delete(code);
    setItems((prev) => ({ ...prev, [code]: 'manual' }));
  }

  if (phase === 'capture') {
    const liveText = [capture.finalText, capture.interimText].filter(Boolean).join(' ');
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
              {/* The live transcript is the thing that makes an operator trust
                  this app on day one — settled words in ink, the word being
                  recognised right now in steel. */}
              <p style={{ maxWidth: 340, textAlign: 'center', minHeight: 96, fontSize: 18, padding: '0 16px' }}>
                <span>{capture.finalText}</span>{' '}
                <span style={{ color: 'var(--steel)' }}>{capture.interimText}</span>
                {!liveText && <span className="meta">{t('capture.listening')}</span>}
              </p>
            </>
          )}
        </div>
        <div style={{ padding: 20 }}>
          <button className="btn btn-primary btn-block" style={{ minHeight: 64, fontSize: 20 }} onClick={() => void handleStop()}>
            {t('capture.stopButton')}
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

      <h2 className="field-label">{t('segment.transcriptLabel')}</h2>
      <textarea
        className="input"
        style={{ minHeight: 120, padding: 12, marginBottom: 20, lineHeight: 1.5 }}
        placeholder={t('capture.typedNotePlaceholder')}
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
      />

      <h2 className="field-label">{t('review.itemsLabel')}</h2>
      <PillList all={taxonomy} selected={Object.entries(items).map(([code, origin]) => ({ code, origin }))} onToggle={toggle} onAdd={add} />

      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <button className="btn btn-block" onClick={() => void handleRecordMore()}>
          {t('segment.addMore')}
        </button>
      </div>

      <button className="btn btn-amber btn-block" style={{ marginTop: 16, minHeight: 64, fontSize: 20 }} onClick={() => void handleApprove()}>
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
