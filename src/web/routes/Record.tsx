import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useLang, useT } from '../i18n';
import { RequireAuth, RequireMaintenanceAccess } from '../lib/guards';
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
import type { Lang } from '@shared/types';

type Phase = 'capture' | 'review';

const SPEECH_LANGS: { code: Lang; label: string }[] = [
  { code: 'hi', label: 'हिंदी' },
  { code: 'mr', label: 'मराठी' },
  { code: 'en', label: 'English' },
];

/** Remembered separately from the interface language: plenty of operators
 * read the app in one language and speak another, and speaking Hindi into an
 * en-IN session comes back as romanised Latin instead of Devanagari. */
function storedSpeechLang(fallback: Lang): Lang {
  try {
    const saved = localStorage.getItem('speechLang');
    if (saved === 'en' || saved === 'hi' || saved === 'mr') return saved;
  } catch {
    /* private mode or storage disabled — the app language is a fine default */
  }
  return fallback;
}

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
  const [confirmingApprove, setConfirmingApprove] = useState(false);

  const logIdRef = useRef(uuidv7());
  const seqRef = useRef(0);
  // Codes the operator deliberately removed. The matcher re-runs as they edit
  // the text, and without this it would keep putting back the pill they just
  // took off.
  const dismissedRef = useRef<Set<string>>(new Set());

  const [speechLang, setSpeechLang] = useState<Lang>(() => storedSpeechLang(lang));
  const capture = useCapture(speechLang, () => void handleStop());

  function chooseSpeechLang(next: Lang) {
    setSpeechLang(next);
    try {
      localStorage.setItem('speechLang', next);
    } catch {
      /* not being able to remember it is not worth failing the recording over */
    }
    capture.switchLang(next);
  }

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
    setConfirmingApprove(false);
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
    const secondsLeft = Math.max(0, 45 - Math.floor(capture.elapsedMs / 1000));
    return (
      <div className="capture-screen">
        <div className="capture-head">
          <span className="meta">
            {machine ? `${t('review.machineLabel')} ${machine.machineNo} · ${machine.shedName}` : ''}
          </span>
        </div>
        {/* Which language is being spoken, not which one the app is in. One
            tap, mid-recording safe: the words already recognised carry over. */}
        <div className="speech-lang-row">
          {SPEECH_LANGS.map((l) => (
            <button
              key={l.code}
              className={`speech-lang${speechLang === l.code ? ' is-active' : ''}`}
              onClick={() => chooseSpeechLang(l.code)}
              lang={l.code}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className="capture-body">
          {capture.permissionDenied ? (
            <p style={{ color: 'var(--fault)', padding: 24, textAlign: 'center' }}>{t('capture.permissionNeeded')}</p>
          ) : (
            <>
              {/* Countdown lives inside the ring rather than under it: the
                  ring is already the thing the eye goes to, and stacking a
                  second number below it wasted the vertical room the Stop
                  button needs on a short phone. */}
              <div className="capture-ring-wrap">
                <CaptureRing elapsedMs={capture.elapsedMs} />
                <div className={`capture-rec${secondsLeft <= 5 ? ' is-ending' : ''}`}>
                  <span className="capture-rec-dot" />
                  <span className="capture-rec-time">
                    {capture.elapsedMs >= CAPTURE_INNER_MS ? '0:00' : `0:${String(secondsLeft).padStart(2, '0')}`}
                  </span>
                </div>
              </div>
              <p className="capture-status">
                {capture.elapsedMs >= CAPTURE_INNER_MS ? t('capture.wrappingUp') : t('capture.recording')}
              </p>
              {/* The live transcript is the thing that makes an operator trust
                  this app on day one — settled words in ink, the word being
                  recognised right now in steel. Scrolls inside its own box so
                  a long note can never push Stop off the screen. */}
              <div className="capture-transcript">
                {liveText ? (
                  <p>
                    <span>{capture.finalText}</span>{' '}
                    <span style={{ color: 'var(--steel)' }}>{capture.interimText}</span>
                  </p>
                ) : (
                  <p className="meta">{t('capture.listening')}</p>
                )}
              </div>
            </>
          )}
        </div>
        <div className="capture-foot">
          <button className="btn btn-stop btn-block" onClick={() => void handleStop()}>
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
      {/* Web Speech producing nothing (patchy network reaching Google's
          cloud STT, or a device where speech input isn't configured) looks
          identical to an operator who simply hasn't typed anything yet — an
          empty box with the same generic placeholder either way. Nothing
          server-side ever backfills this transcript once the log is
          approved (finalizeAndQueue always sends approved:true, so the log
          never reaches pending_transcription — a real, separate gap), so
          silence here would mean an operator who trusted the voice capture
          walks away with a genuinely blank log. Spelling it out is the fix
          that actually matters: they need to know to type it themselves,
          right now. */}
      {!transcript.trim() && (
        <p className="meta" style={{ color: 'var(--fault)', marginBottom: 8 }}>
          {t('review.emptyTranscriptWarning')}
        </p>
      )}
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

      <button
        className="btn btn-amber btn-block"
        style={{ marginTop: 16, minHeight: 64, fontSize: 20 }}
        onClick={() => setConfirmingApprove(true)}
      >
        {t('review.approveButton')}
      </button>

      {/* Approve locks the log for good (CLAUDE.md: only an admin can touch
          an approved log afterward, and that always appends to an edit
          trail rather than just changing it back). One stray tap here is
          otherwise irreversible, so it gets the one confirmation dialog in
          the whole app. */}
      {confirmingApprove && (
        <div className="modal-backdrop" onClick={() => setConfirmingApprove(false)}>
          <div className="panel modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 8 }}>{t('review.confirmTitle')}</h2>
            <p style={{ marginBottom: 20 }}>
              {transcript.trim() ? t('review.confirmBody') : t('review.confirmBodyEmpty')}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-block" onClick={() => setConfirmingApprove(false)}>
                {t('review.confirmNo')}
              </button>
              <button className="btn btn-amber btn-block" onClick={() => void handleApprove()}>
                {t('review.confirmYes')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Record() {
  return (
    <RequireAuth>
      <RequireMaintenanceAccess>
        <RecordInner />
      </RequireMaintenanceAccess>
    </RequireAuth>
  );
}
