import { useCallback, useRef, useState } from 'react';
import type { Lang } from '@shared/types';
import { startRecognition, tryInstallLocal, isSupported, type SpeechHandle } from './speech';
import { getSttMode } from './config';
import { pingStart, pingWarning, pingEnd } from './sound';

/** The UI counts down from 45s; warn with five left. */
const WARN_AT_MS = 40_000;

/** Same reasoning as speech.ts's own restart delay: starting a new
 * recognition session immediately after stopping another can find the mic
 * still held by the one winding down. */
const LANG_SWITCH_DELAY_MS = 250;

/** In rough preference order — Opus at a low bitrate is what CLAUDE.md
 * section 6 asks for (small files, cheap R2 storage), but not every Android
 * build's MediaRecorder supports every container, so the first one the
 * browser actually accepts wins. */
const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

export function pickAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return AUDIO_MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

export interface SegmentResult {
  blob: Blob;
  durationMs: number;
  transcript: string;
  producedText: boolean;
  usedLocalInstall: boolean;
}

/**
 * Owns one recording. Recognition is the product here: the operator watches
 * their own words appear, and that live transcript is what gets saved. But
 * the audio itself is the non-negotiable (CLAUDE.md section 1: "Audio lands
 * in IndexedDB before anything is sent anywhere") — real bytes, not just a
 * live transcript, are what makes "no log is ever lost" true when Web
 * Speech has nothing to say.
 *
 * MediaRecorder and SpeechRecognition both start together, per CLAUDE.md
 * section 6. A getUserMedia stream feeding MediaRecorder and
 * SpeechRecognition's own internal mic capture are two independent
 * consumers of the same hardware; on some Android builds that contention can
 * mean recognition produces nothing while the two race for the device. That
 * is an acceptable, already-designed-for degradation — CLAUDE.md's own
 * fallback is "audio is already captured, offer the typed note box" — it is
 * NOT acceptable for the trade to go the other way and silently drop the
 * audio, which is what happened here before: a previous pass deleted
 * MediaRecorder entirely to "fix" the contention, which fixed nothing and
 * meant every segment saved an empty, zero-byte blob. No audio ever reached
 * R2, and the server-side Whisper fallback (CLAUDE.md section 11) had
 * nothing to transcribe. Restoring real capture is the actual fix; a
 * device where live transcript loses the mic race still gets its audio
 * saved, which is the one thing that must never fail.
 */
export function useCapture(lang: Lang, onHardStop: () => void) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [interimText, setInterimText] = useState('');
  const [finalText, setFinalText] = useState('');
  const [recording, setRecording] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const speechRef = useRef<SpeechHandle | null>(null);
  const startedAtRef = useRef(0);
  const rafRef = useRef<number>(0);
  const localInstallRef = useRef(false);
  const activeLangRef = useRef<Lang>(lang);
  const warnedRef = useRef(false);
  // Authoritative copy. State drives rendering, but stop() reads the ref so a
  // hard stop firing from a stale animation-frame closure still returns every
  // word that was recognised.
  const finalTextRef = useRef('');
  const onHardStopRef = useRef(onHardStop);
  onHardStopRef.current = onHardStop;
  // Bumped on every start/switch/stop. speech.ts already refuses to report
  // from a session after its own stop() is called, but a language switch
  // also has a delay before the *next* session launches (below) — this
  // stops a launch that was queued and then superseded (a second switch, or
  // Stop, arriving before the delay elapses) from writing state that no
  // longer belongs to the current recording.
  const epochRef = useRef(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recorderMimeRef = useRef<string>('audio/webm');

  const tick = useCallback(() => {
    const elapsed = performance.now() - startedAtRef.current;
    setElapsedMs(elapsed);
    if (elapsed >= WARN_AT_MS && !warnedRef.current) {
      warnedRef.current = true;
      pingWarning();
    }
    if (elapsed >= 50_000) {
      onHardStopRef.current();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const launchRecognition = useCallback((useLang: Lang, carryOver: string, epoch: number) => {
    activeLangRef.current = useLang;
    speechRef.current = startRecognition(
      useLang,
      {
        onInterim: (text) => {
          if (epochRef.current !== epoch) return;
          setInterimText(text);
        },
        onFinal: (text) => {
          if (epochRef.current !== epoch) return;
          finalTextRef.current = text;
          setFinalText(text);
        },
        onUnavailable: () => {
          /* silent fallthrough — the operator can still type it in review,
             and the real audio (see below) is already safe either way */
        },
        onPermissionDenied: () => {
          if (epochRef.current !== epoch) return;
          setPermissionDenied(true);
        },
      },
      carryOver,
    );

    // Bonus only, and never on the critical path: this promise does not
    // reliably settle on every build.
    void tryInstallLocal(useLang).then((ok) => {
      localInstallRef.current = ok;
    });
  }, []);

  /** Opens the mic once per segment and starts recording real audio into
   * memory. Failure here (denied, no mic, unsupported) is silent — Web
   * Speech may still work on its own internal capture, and if neither
   * works the operator falls through to typing, exactly as CLAUDE.md
   * already designs for. */
  const startAudioCapture = useCallback(async () => {
    chunksRef.current = [];
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // NotAllowedError, NotFoundError, or a mic already fully claimed by
      // something else — Web Speech's own request gets an independent shot
      // right after this, and if that also fails its onPermissionDenied
      // covers telling the operator.
      return;
    }
    streamRef.current = stream;

    const mimeType = pickAudioMimeType();
    recorderMimeRef.current = mimeType ?? 'audio/webm';
    try {
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 24_000 })
        : new MediaRecorder(stream);
      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = recorder;
      // 1s timeslices: dataavailable fires periodically instead of only at
      // stop(), so a crash or a tab kill mid-segment still leaves whatever
      // was captured so far sitting in chunksRef rather than nothing at all.
      recorder.start(1000);
    } catch {
      // Recorder construction can throw for an unsupported mimeType on some
      // builds even after isTypeSupported() said yes. Release the stream —
      // nothing is going to record on it — and let Web Speech carry the
      // segment on its own.
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const stopAudioCapture = useCallback((): Promise<Blob> => {
    const recorder = recorderRef.current;
    const stream = streamRef.current;
    recorderRef.current = null;
    streamRef.current = null;

    if (!recorder || recorder.state === 'inactive') {
      stream?.getTracks().forEach((t) => t.stop());
      return Promise.resolve(new Blob(chunksRef.current, { type: recorderMimeRef.current }));
    }

    return new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        stream?.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunksRef.current, { type: recorderMimeRef.current }));
      };
      try {
        recorder.stop();
      } catch {
        stream?.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunksRef.current, { type: recorderMimeRef.current }));
      }
    });
  }, []);

  const start = useCallback(async () => {
    setInterimText('');
    setFinalText('');
    setElapsedMs(0);
    setPermissionDenied(false);
    finalTextRef.current = '';
    warnedRef.current = false;

    startedAtRef.current = performance.now();
    setRecording(true);
    pingStart();
    rafRef.current = requestAnimationFrame(tick);

    void startAudioCapture();

    const sttMode = await getSttMode();
    if (sttMode === 'local_only' || !isSupported()) return;

    const epoch = ++epochRef.current;
    launchRecognition(lang, '', epoch);
  }, [lang, tick, launchRecognition, startAudioCapture]);

  /**
   * Switch the language being recognised without losing the note so far.
   * Web Speech declares one language per session and cannot auto-detect, so
   * speaking Hindi into an en-IN session returns romanised Latin text rather
   * than Devanagari. This is how the operator says "I am speaking Marathi
   * now" and gets Marathi script back.
   *
   * The already-recognised text is read fresh out of finalTextRef right
   * before the new session launches (not captured earlier), and the new
   * session's own callbacks are the only thing allowed to touch shared state
   * for this epoch — see epochRef above — so nothing already on screen can
   * be clobbered by this switch. The audio recording is untouched by a
   * language switch; it is one continuous capture for the whole segment.
   */
  const switchLang = useCallback(
    (next: Lang) => {
      if (next === activeLangRef.current) return;
      speechRef.current?.stop();
      speechRef.current = null;
      activeLangRef.current = next;
      setInterimText('');
      const epoch = ++epochRef.current;
      setTimeout(() => {
        if (epochRef.current !== epoch) return; // superseded before it got to launch
        launchRecognition(next, finalTextRef.current, epoch);
      }, LANG_SWITCH_DELAY_MS);
    },
    [launchRecognition],
  );

  const stop = useCallback(async (): Promise<SegmentResult> => {
    cancelAnimationFrame(rafRef.current);
    const durationMs = performance.now() - startedAtRef.current;
    setRecording(false);
    epochRef.current += 1; // invalidate any switchLang() still waiting on its delay

    const producedText = speechRef.current?.didProduceText() ?? false;
    speechRef.current?.stop();
    speechRef.current = null;

    const blob = await stopAudioCapture();

    pingEnd();
    if (navigator.vibrate) navigator.vibrate(200); // the phone is often not being looked at

    return {
      blob,
      durationMs,
      transcript: finalTextRef.current.trim(),
      producedText,
      usedLocalInstall: localInstallRef.current,
    };
  }, [stopAudioCapture]);

  return { elapsedMs, interimText, finalText, recording, permissionDenied, start, stop, switchLang };
}
