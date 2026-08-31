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
 * Owns one 45(+5)s recording: MediaRecorder and SpeechRecognition run in
 * parallel from the moment mic permission resolves (CLAUDE.md section 6).
 * Audio is captured unconditionally; recognition is a bonus this hook
 * degrades out of silently.
 */
export function useCapture(lang: Lang, onHardStop: () => void) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [interimText, setInterimText] = useState('');
  const [finalText, setFinalText] = useState('');
  const [recording, setRecording] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const speechRef = useRef<SpeechHandle | null>(null);
  const startedAtRef = useRef(0);
  const rafRef = useRef<number>(0);
  const localInstallRef = useRef(false);

  const tick = useCallback(() => {
    const elapsed = performance.now() - startedAtRef.current;
    setElapsedMs(elapsed);
    if (elapsed >= 50_000) {
      onHardStop();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [onHardStop]);

  const start = useCallback(async () => {
    setInterimText('');
    setFinalText('');
    setElapsedMs(0);
    setPermissionDenied(false);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPermissionDenied(true);
      return;
    }
    streamRef.current = stream;

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 24_000 });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start();
    recorderRef.current = recorder;

    startedAtRef.current = performance.now();
    setRecording(true);
    rafRef.current = requestAnimationFrame(tick);

    const sttMode = await getSttMode();
    if (sttMode === 'local_only' || !isSupported()) return;

    // Recognition must start now, unconditionally. `SpeechRecognition.install()`
    // is a real but genuinely experimental Chromium API (present, but not
    // reliably functional, on current stable builds) and on some devices its
    // promise never settles at all. Awaiting it here used to gate the actual
    // recognition start behind it — one hung install() call and the operator
    // got a silent recorder that never transcribed anything, on every browser
    // that shares the same broken install() behaviour. It is optional
    // metadata (speech.ts: "never depend on this succeeding"), so it must
    // never block the required path. Fire it in the background instead.
    speechRef.current = startRecognition(lang, {
      onInterim: setInterimText,
      onFinal: setFinalText,
      onUnavailable: () => {
        /* silent fallthrough per CLAUDE.md section 6 — audio keeps recording */
      },
    });
    void tryInstallLocal(lang).then((ok) => {
      localInstallRef.current = ok;
    });
  }, [lang, tick]);

  const stop = useCallback(async (): Promise<SegmentResult> => {
    cancelAnimationFrame(rafRef.current);
    const durationMs = performance.now() - startedAtRef.current;
    setRecording(false);

    const recorder = recorderRef.current;
    const stopped = new Promise<void>((resolve) => {
      if (!recorder || recorder.state === 'inactive') return resolve();
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    await stopped;
    streamRef.current?.getTracks().forEach((t) => t.stop());

    const producedText = speechRef.current?.didProduceText() ?? false;
    speechRef.current?.stop();

    if (navigator.vibrate) navigator.vibrate(200); // one short vibration on stop, no sound

    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    return {
      blob,
      durationMs,
      transcript: finalText.trim(),
      producedText,
      usedLocalInstall: localInstallRef.current,
    };
  }, [finalText]);

  return { elapsedMs, interimText, finalText, recording, permissionDenied, start, stop };
}
