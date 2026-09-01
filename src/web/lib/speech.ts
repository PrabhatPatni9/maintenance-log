/**
 * Web Speech API wrapper, written for Android Chrome first.
 *
 * The behaviours here are not stylistic. Each one exists because of a
 * specific, documented way this API misbehaves on the phones this app
 * actually runs on. Read the comments before changing anything.
 *
 * `continuous = false` is deliberate — do not "fix" it back to true. It was
 * tried, on the theory that one long session would chime less often than
 * restarting every phrase. On a real device it came back worse: Android
 * re-fired already-finalised results as new ones under continuous mode, and
 * because the Web Speech spec's own `resultIndex` field is what is supposed
 * to say "everything before this index you have already seen", a broken
 * resultIndex meant the same sentence got appended to the transcript over
 * and over — visibly, in production, as a wall of repeated text. That is a
 * corrupted log, which is a strictly worse failure than an audible chime.
 * `continuous = false` plus the restart-on-`onend` loop below is the
 * verified-safe configuration; it also has an audible-chime cost (Chrome's
 * start-of-listening chime, which no web API can silence — a deliberate
 * anti-covert-listening signal, not a bug) but never corrupts the text.
 *
 * The onresult handler additionally never trusts `resultIndex` alone — see
 * `consumedResults` below — as a second, independent guard against exactly
 * this class of bug on whatever device turns out to be broken next.
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
  /** Text already recognised before this handle existed. Lets the caller
   * switch spoken language mid-note without losing what was said so far. */
  initialText = '',
): SpeechHandle {
  const Ctor = getCtor();
  if (!Ctor) {
    cb.onUnavailable();
    return { stop: () => {}, didProduceText: () => false };
  }

  let stopped = false;
  let producedText = false;
  let finalText = initialText ? initialText.trim() + ' ' : '';
  let failures = 0;
  let rec: any = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  function buildSession(): any {
    // Highest index into this session's own e.results this handler has
    // already turned into text. `e.resultIndex` is supposed to mean the same
    // thing, coming from the browser — but a broken resultIndex (observed:
    // stuck at 0 while e.results kept growing) is exactly what re-fed
    // already-finalised results back in as "new" ones and duplicated the
    // transcript. Tracking our own high-water mark means a result can only
    // ever be turned into text once, regardless of what the event claims.
    let consumedResults = 0;

    const r = new (Ctor as any)();
    r.lang = BCP47[lang];
    // See the file header. Verified-safe on real Android hardware; do not
    // change without re-verifying on-device, not just in the mock tests.
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (e: any) => {
      // A session that has been stopped (Stop pressed, or superseded by a
      // language switch) can still fire one last onresult while it winds
      // down. Without this guard that late event writes into the SAME
      // shared callbacks the new session already started reporting to,
      // overwriting whatever the new session had already recognised —
      // which read as the transcript "deleting itself" right after a
      // language switch. Once stopped, a session is not allowed to speak.
      if (stopped) return;
      failures = 0;
      const startAt = Math.max(e.resultIndex, consumedResults);
      let interim = '';
      for (let i = startAt; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalText += chunk + ' ';
          producedText = true;
          consumedResults = i + 1;
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
      // Same reasoning as onresult above: a stopped/superseded session's
      // error is not this recording's problem any more.
      if (stopped) return;

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
