/**
 * Web Speech API wrapper, written for Android Chrome first.
 *
 * The behaviours here are not stylistic. Each one exists because of a
 * specific, documented way this API misbehaves on the phones this app
 * actually runs on. Read the comments before changing anything.
 *
 * The single most important line in this file is `continuous = false`.
 * Continuous recognition is broken on Android (crbug 40324711): the mic
 * cuts out within a couple of seconds and results either never arrive or
 * arrive once and then stop forever. The documented-reliable pattern, and
 * the one used here, is single-shot recognition restarted from `onend`
 * for as long as the operator is still recording. Setting this back to
 * `true` ships a recorder that produces no transcript on Android.
 */

export type Lang = 'en' | 'hi' | 'mr';

const BCP47: Record<Lang, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  mr: 'mr-IN',
};

/** Android needs a beat between sessions; restarting synchronously inside
 * onend throws InvalidStateError or silently no-ops on some builds. */
const RESTART_DELAY_MS = 250;

/** If start() fails this many times in a row, the engine is genuinely gone
 * and we stop hammering it. */
const MAX_CONSECUTIVE_FAILURES = 5;

export interface SpeechHandle {
  stop(): void;
  /** True if recognition actually produced anything. Drives the fallthrough. */
  didProduceText(): boolean;
}

export interface SpeechCallbacks {
  onInterim(text: string): void;
  onFinal(text: string): void;
  /** Called once if recognition is unavailable or died without producing text. */
  onUnavailable(): void;
  /** Mic permission was refused — the one failure the operator must be told about. */
  onPermissionDenied?(): void;
}

type SR = typeof window.SpeechRecognition;

function getCtor(): SR | undefined {
  return (
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
  );
}

export function isSupported(): boolean {
  return getCtor() !== undefined;
}

/**
 * Try to install on-device recognition so capture works without sending audio
 * anywhere. Chrome ships this behind SpeechRecognition.install(); language
 * availability is user-agent dependent and Marathi may well not be there.
 *
 * Never depend on this succeeding, and never await it on the path that starts
 * recognition — on some builds the promise never settles at all.
 */
export async function tryInstallLocal(lang: Lang): Promise<boolean> {
  const Ctor: any = getCtor();
  if (!Ctor?.install) return false;
  try {
    return await Ctor.install({ langs: [BCP47[lang]], processLocally: true });
  } catch {
    return false;
  }
}

export function startRecognition(
  lang: Lang,
  cb: SpeechCallbacks,
): SpeechHandle {
  const Ctor = getCtor();
  if (!Ctor) {
    cb.onUnavailable();
    return { stop: () => {}, didProduceText: () => false };
  }

  let stopped = false;
  let producedText = false;
  let finalText = '';
  let failures = 0;
  let rec: any = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  function buildSession(): any {
    const r = new (Ctor as any)();
    r.lang = BCP47[lang];
    // See the file header: never set this to true. Android breaks.
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (e: any) => {
      failures = 0;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalText += chunk + ' ';
          producedText = true;
          cb.onFinal(finalText.trim());
        } else {
          interim += chunk;
        }
      }
      // Interim text belongs to the session that produced it. Report the
      // accumulated finals plus this session's interim so the operator sees
      // one continuously growing sentence rather than it resetting on every
      // restart.
      cb.onInterim(interim);
    };

    r.onerror = (e: any) => {
      // `no-speech` fires whenever the operator pauses. Expected, and on
      // Android it also ends the session — onend restarts us. Not an error.
      if (e.error === 'no-speech') return;

      // `aborted` is what we cause ourselves by calling stop().
      if (e.error === 'aborted') return;

      // The operator said no to the mic. This is the one case worth telling
      // them about, because nothing will work until they change it.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        stopped = true;
        console.warn(`[speech] permission refused, error="${e.error}"`);
        cb.onPermissionDenied?.();
        cb.onUnavailable();
        return;
      }

      // `audio-capture` on Android usually means something else grabbed the
      // mic for a moment. It is worth another go rather than giving up.
      if (e.error === 'audio-capture') {
        console.warn('[speech] audio-capture error, will retry');
        return;
      }

      // Anything else (network, and friends) — let onend decide whether to
      // retry. Logged to the console only, never surfaced to the operator.
      console.warn(`[speech] recognition error="${e.error}"`);
    };

    // Every session ends: after each utterance (continuous=false), after a
    // pause, or around Chrome's own timeout. As long as the operator has not
    // pressed Stop, start another one. This restart loop *is* the continuous
    // recognition the API refuses to give us on Android.
    r.onend = () => {
      if (stopped) return;
      restartTimer = setTimeout(startSession, RESTART_DELAY_MS);
    };

    return r;
  }

  function startSession() {
    if (stopped) return;
    rec = buildSession();
    try {
      rec.start();
      failures = 0;
    } catch {
      // start() throws if the previous session has not fully released yet.
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        stopped = true;
        console.warn('[speech] giving up after repeated start() failures');
        if (!producedText) cb.onUnavailable();
        return;
      }
      restartTimer = setTimeout(startSession, RESTART_DELAY_MS * failures);
    }
  }

  startSession();

  return {
    stop() {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      try {
        rec?.stop();
      } catch {
        /* already stopped */
      }
    },
    didProduceText: () => producedText,
  };
}
