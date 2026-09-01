/**
 * Short tones for the capture screen.
 *
 * A shed runs at around 90 dB and the operator is usually not looking at the
 * phone while they talk, so the countdown on screen tells them nothing. These
 * are the cues that do: it started, it is about to stop, it stopped.
 *
 * Synthesised with an oscillator rather than shipped as audio files — three
 * beeps are not worth 3 network requests or a cache entry, and this works
 * offline on first launch with nothing precached.
 */

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    // Browsers start the context suspended until a gesture. Recording always
    // begins from a tap, so this resolves; if it does not, the beeps are the
    // only thing lost.
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, durationMs: number, startDelayMs = 0): void {
  const ac = audioContext();
  if (!ac) return;

  const startAt = ac.currentTime + startDelayMs / 1000;
  const endAt = startAt + durationMs / 1000;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;

  // Ramped rather than switched, because an abrupt start and stop on a square
  // edge clicks audibly on phone speakers.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.35, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

  osc.connect(gain).connect(ac.destination);
  osc.start(startAt);
  osc.stop(endAt + 0.02);
}

/** Recording has begun — one clear rising note. */
export function pingStart(): void {
  tone(880, 160);
}

/** Five seconds left. Two short beeps, deliberately distinct from the other
 * two so it is not mistaken for "finished". */
export function pingWarning(): void {
  tone(660, 110);
  tone(660, 110, 170);
}

/** Recording has stopped. Lower than the start note, so it reads as closing. */
export function pingEnd(): void {
  tone(440, 240);
}
