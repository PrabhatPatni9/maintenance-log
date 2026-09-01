import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startRecognition } from './speech';

/**
 * Android Chrome does not do continuous recognition (crbug 40324711): every
 * session ends on its own after a single utterance, whatever `continuous` is
 * set to. These tests stand in a mock that behaves exactly that way, because
 * that behaviour is what broke transcription in the field — recognition
 * started, produced one result at most, and then sat dead while the operator
 * kept talking.
 */

interface MockResult {
  transcript: string;
  isFinal: boolean;
}

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  stopped = false;

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }

  start() {
    this.started = true;
  }

  stop() {
    this.stopped = true;
    this.onend?.();
  }

  /** Emit results as the real API does, then end the session like Android. */
  emit(results: MockResult[]) {
    this.onresult?.({
      resultIndex: 0,
      results: Object.assign(
        results.map((r) => Object.assign([{ transcript: r.transcript }], { isFinal: r.isFinal })),
        { length: results.length },
      ),
    });
  }

  endSession() {
    this.onend?.();
  }

  fail(error: string) {
    this.onerror?.({ error });
  }
}

beforeEach(() => {
  MockSpeechRecognition.instances = [];
  (globalThis as unknown as { window: unknown }).window = {
    SpeechRecognition: MockSpeechRecognition,
  };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

function cbs() {
  const finals: string[] = [];
  const interims: string[] = [];
  let unavailable = 0;
  let denied = 0;
  return {
    finals,
    interims,
    get unavailable() {
      return unavailable;
    },
    get denied() {
      return denied;
    },
    handlers: {
      onInterim: (t: string) => interims.push(t),
      onFinal: (t: string) => finals.push(t),
      onUnavailable: () => {
        unavailable += 1;
      },
      onPermissionDenied: () => {
        denied += 1;
      },
    },
  };
}

describe('startRecognition on Android-style single-shot recognition', () => {
  it('never asks for continuous mode, which is broken on Android', () => {
    const c = cbs();
    startRecognition('en', c.handlers);
    expect(MockSpeechRecognition.instances[0]!.continuous).toBe(false);
    expect(MockSpeechRecognition.instances[0]!.interimResults).toBe(true);
  });

  it('restarts after each session so a long note keeps transcribing', () => {
    const c = cbs();
    startRecognition('en', c.handlers);

    const first = MockSpeechRecognition.instances[0]!;
    first.emit([{ transcript: 'oil change kiya', isFinal: true }]);
    first.endSession();

    // Without the restart loop the app would stop here — which is exactly
    // what operators saw: a couple of words, then nothing.
    vi.advanceTimersByTime(300);
    expect(MockSpeechRecognition.instances).toHaveLength(2);

    const second = MockSpeechRecognition.instances[1]!;
    second.emit([{ transcript: 'belt bhi badla', isFinal: true }]);

    // Text accumulates across sessions rather than resetting each restart.
    expect(c.finals.at(-1)).toBe('oil change kiya belt bhi badla');
  });

  it('keeps going through the no-speech error a pause produces', () => {
    const c = cbs();
    startRecognition('en', c.handlers);

    const first = MockSpeechRecognition.instances[0]!;
    first.fail('no-speech');
    first.endSession();
    vi.advanceTimersByTime(300);

    expect(MockSpeechRecognition.instances).toHaveLength(2);
    expect(c.unavailable).toBe(0);
  });

  it('stops restarting once the operator presses stop', () => {
    const c = cbs();
    const handle = startRecognition('en', c.handlers);

    MockSpeechRecognition.instances[0]!.emit([{ transcript: 'done', isFinal: true }]);
    handle.stop();
    vi.advanceTimersByTime(2000);

    expect(MockSpeechRecognition.instances).toHaveLength(1);
    expect(handle.didProduceText()).toBe(true);
  });

  it('reports a refused microphone instead of retrying forever', () => {
    const c = cbs();
    startRecognition('en', c.handlers);

    MockSpeechRecognition.instances[0]!.fail('not-allowed');
    MockSpeechRecognition.instances[0]!.endSession();
    vi.advanceTimersByTime(2000);

    expect(c.denied).toBe(1);
    expect(MockSpeechRecognition.instances).toHaveLength(1);
  });

  it('carries earlier text over when the spoken language is switched', () => {
    const c = cbs();
    // Operator spoke English, then switches to Hindi mid-note. The new handle
    // continues the same sentence instead of starting from nothing.
    startRecognition('hi', c.handlers, 'oil change kiya');
    expect(MockSpeechRecognition.instances[0]!.lang).toBe('hi-IN');

    MockSpeechRecognition.instances[0]!.emit([{ transcript: 'बेल्ट बदला', isFinal: true }]);
    expect(c.finals.at(-1)).toBe('oil change kiya बेल्ट बदला');
  });

  it('reports unavailable when the browser has no engine at all', () => {
    (globalThis as unknown as { window: unknown }).window = {};
    const c = cbs();
    const handle = startRecognition('en', c.handlers);
    expect(c.unavailable).toBe(1);
    expect(handle.didProduceText()).toBe(false);
  });
});
