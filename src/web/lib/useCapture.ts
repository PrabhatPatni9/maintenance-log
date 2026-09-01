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

export interface SegmentResult {
  blob: Blob;
  durationMs: number;
  transcript: string;
  producedText: boolean;
  usedLocalInstall: boolean;
}

/**
 * Owns one recording. Recognition is the product here: the operator watches
 * their own words appear, and that live transcript is what gets saved.
 *
 * Deliberately does NOT open a MediaRecorder alongside it. Chrome's
 * SpeechRecognition opens and owns the microphone itself — it takes no
 * MediaStream — and on Android a getUserMedia capture running at the same
 * time fights it for the device, which shows up as recognition that starts
 * and then produces nothing. The parallel audio recording only ever existed
 * to feed server-side Whisper, which is not wired up, so it was costing the
 * primary path to feed a consumer that does not exist.
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
          /* silent fallthrough — the operator can still type it in review */
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

    const sttMode = await getSttMode();
    if (sttMode === 'local_only' || !isSupported()) return;

    const epoch = ++epochRef.current;
    launchRecognition(lang, '', epoch);
  }, [lang, tick, launchRecognition]);

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
   * be clobbered by this switch.
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

    pingEnd();
    if (navigator.vibrate) navigator.vibrate(200); // the phone is often not being looked at

    return {
      blob: new Blob([], { type: 'audio/webm' }),
      durationMs,
      transcript: finalTextRef.current.trim(),
      producedText,
      usedLocalInstall: localInstallRef.current,
    };
  }, []);

  return { elapsedMs, interimText, finalText, recording, permissionDenied, start, stop, switchLang };
}
