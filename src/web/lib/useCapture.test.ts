import { describe, it, expect, afterEach } from 'vitest';
import { pickAudioMimeType } from './useCapture';

describe('pickAudioMimeType', () => {
  afterEach(() => {
    // @ts-expect-error test-only global cleanup
    delete globalThis.MediaRecorder;
  });

  it('prefers Opus in a webm container when the browser supports it', () => {
    // @ts-expect-error minimal test stub
    globalThis.MediaRecorder = { isTypeSupported: (t: string) => t === 'audio/webm;codecs=opus' || t === 'audio/webm' };
    expect(pickAudioMimeType()).toBe('audio/webm;codecs=opus');
  });

  it('falls through to whatever the browser actually accepts, in order', () => {
    // @ts-expect-error minimal test stub
    globalThis.MediaRecorder = { isTypeSupported: (t: string) => t === 'audio/mp4' };
    expect(pickAudioMimeType()).toBe('audio/mp4');
  });

  it('returns undefined rather than throwing when nothing is supported', () => {
    // @ts-expect-error minimal test stub
    globalThis.MediaRecorder = { isTypeSupported: () => false };
    expect(pickAudioMimeType()).toBeUndefined();
  });

  it('returns undefined when MediaRecorder does not exist at all', () => {
    expect(pickAudioMimeType()).toBeUndefined();
  });
});
