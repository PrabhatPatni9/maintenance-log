import { useCallback, useRef, useState } from 'react';
import type { Lang } from '@shared/types';
import { startRecognition, tryInstallLocal, isSupported, type SpeechHandle } from './speech';
import { getSttMode } from './config';

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
  // Authoritative copy. State drives rendering, but stop() reads the ref so a
  // hard stop firing from a stale animation-frame closure still returns every
  // word that was recognised.
  const finalTextRef = useRef('');
  const onHardStopRef = useRef(onHardStop);
  onHardStopRef.current = onHardStop;

  const tick = useCallback(() => {
    const elapsed = performance.now() - startedAtRef.current;
    setElapsedMs(elapsed);
    if (elapsed >= 50_000) {
      onHardStopRef.current();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const launchRecognition = useCallback((useLang: Lang, carryOver: string) => {
    activeLangRef.current = useLang;
    speechRef.current = startRecognition(
      useLang,
      {
        onInterim: setInterimText,
        onFinal: (text) => {
          finalTextRef.current = text;
          setFinalText(text);
        },
        onUnavailable: () => {
          /* silent fallthrough — the operator can still type it in review */
        },
        onPermissionDenied: () => setPermissionDenied(true),
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

    startedAtRef.current = performance.now();
    setRecording(true);
    rafRef.current = requestAnimationFrame(tick);

    const sttMode = await getSttMode();
    if (sttMode === 'local_only' || !isSupported()) return;

    launchRecognition(lang, '');
  }, [lang, tick, launchRecognition]);

  /**
   * Switch the language being recognised without losing the note so far.
   * Web Speech declares one language per session and cannot auto-detect, so
   * speaking Hindi into an en-IN session returns romanised Latin text rather
   * than Devanagari. This is how the operator says "I am speaking Marathi
   * now" and gets Marathi script back.
   */
  const switchLang = useCallback(
    (next: Lang) => {
      if (next === activeLangRef.current) return;
      speechRef.current?.stop();
      speechRef.current = null;
      setInterimText('');
      launchRecognition(next, finalTextRef.current);
    },
    [launchRecognition],
  );

  const stop = useCallback(async (): Promise<SegmentResult> => {
    cancelAnimationFrame(rafRef.current);
    const durationMs = performance.now() - startedAtRef.current;
    setRecording(false);

    const producedText = speechRef.current?.didProduceText() ?? false;
    speechRef.current?.stop();
    speechRef.current = null;

    if (navigator.vibrate) navigator.vibrate(200); // one short vibration on stop, no sound

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
