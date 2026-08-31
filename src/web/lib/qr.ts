import jsQR from 'jsqr';

export interface QrScanner {
  stop(): void;
}

/** BarcodeDetector where Chrome has it; jsQR against the same video frames
 * otherwise. QR payload is just the machine id — the app never parses a
 * machine number out of anything (CLAUDE.md section 6). */
export async function startQrScan(
  video: HTMLVideoElement,
  onDetect: (payload: string) => void,
): Promise<QrScanner> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  video.srcObject = stream;
  await video.play();

  let stopped = false;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const HasDetector = 'BarcodeDetector' in window;
  const detector = HasDetector
    ? new (window as unknown as { BarcodeDetector: new (opts: { formats: string[] }) => {
        detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
      } }).BarcodeDetector({ formats: ['qr_code'] })
    : null;

  async function tick() {
    if (stopped) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      if (detector) {
        try {
          const codes = await detector.detect(canvas);
          if (codes[0]) {
            onDetect(codes[0].rawValue);
            return;
          }
        } catch {
          /* fall through to jsQR below for this frame */
        }
      } else {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code) {
          onDetect(code.data);
          return;
        }
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    stop() {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
