/**
 * Web Speech API wrapper.
 *
 * Reference implementation for the coding agent. The behaviours here are not
 * stylistic; each one exists because of a specific way this API misbehaves.
 * Read the comments before changing anything.
 *
 * This runs alongside MediaRecorder, never instead of it. Audio is always
 * captured regardless of whether recognition works, so a total failure here
 * degrades to the offline queue path rather than losing the operator's words.
 */

export type Lang = 'en' | 'hi' | 'mr';

const BCP47: Record<Lang, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  mr: 'mr-IN',
};

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
 * Never depend on this succeeding. It is a bonus, not a branch.
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

  const rec = new (Ctor as any)();
  rec.lang = BCP47[lang];
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onresult = (e: any) => {
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
    if (interim) cb.onInterim(interim);
  };

  rec.onerror = (e: any) => {
    // `no-speech` fires whenever the operator pauses for a couple of seconds.
    // It is expected and deliberately swallowed. Surfacing it would throw an
    // error at someone who is simply thinking mid-sentence.
    if (e.error === 'no-speech') return;

    // `aborted` is what we cause ourselves by calling stop(). Also not an error.
    if (e.error === 'aborted') return;

    // Anything else (network, not-allowed, service-not-allowed) means the
    // engine is gone. Fall through to the queue path silently. The audio is
    // already being captured by MediaRecorder, so nothing is lost.
    if (!producedText) cb.onUnavailable();
  };

  rec.onend = () => {
    // Chrome silently ends the session around the 60 second mark, and also
    // after long pauses, without firing an error. If we did not ask it to stop,
    // restart immediately. Skipping this ships a recorder that dies
    // mid-sentence and looks like a bug in the app.
    if (stopped) return;
    try {
      rec.start();
    } catch {
      // start() throws if it is already running. Harmless race, ignore.
    }
  };

  try {
    rec.start();
  } catch {
    cb.onUnavailable();
  }

  return {
    stop() {
      stopped = true;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    },
    didProduceText: () => producedText,
  };
}
