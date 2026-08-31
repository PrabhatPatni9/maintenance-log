import { kvGet, kvSet } from './db';

let deferredPrompt: Event & { prompt(): Promise<void> } | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as typeof deferredPrompt;
  });
}

export function getDeferredPrompt() {
  return deferredPrompt;
}

export function clearDeferredPrompt() {
  deferredPrompt = null;
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

const DISMISSED_KEY = 'ratanmoti.installDismissed';

export function isDismissed(): boolean {
  return localStorage.getItem(DISMISSED_KEY) === '1';
}

export function dismiss(): void {
  localStorage.setItem(DISMISSED_KEY, '1');
}

/** Shown "after the operator's second successful log, not on first launch"
 * (PROMPTS.md phase 5). */
export async function recordApprovedLog(): Promise<void> {
  const count = (await kvGet<number>('approvedLogCount')) ?? 0;
  await kvSet('approvedLogCount', count + 1);
}

export async function shouldShowInstallPrompt(): Promise<boolean> {
  if (isStandalone() || isDismissed()) return false;
  const count = (await kvGet<number>('approvedLogCount')) ?? 0;
  return count >= 2;
}
