// Which browsers can open a direct WebSocket from this page to a device on the local network.
// Grounded in the reachability spike (BR-CAN-O-014, still open): Chromium browsers connected to ws:// after the
// user allowed the local-network permission prompt; Firefox and WebKit blocked ws:// from an HTTPS page, with
// the exception of ws://localhost in Firefox. wss:// was not blocked on principle, but only a self-signed
// certificate was tried. Nothing here claims more than that.
import { isLoopbackHost, type ParsedTarget } from './target';

export type BrowserFamily = 'chromium' | 'firefox' | 'webkit' | 'unknown';

export interface BrowserInfo {
  family: BrowserFamily;
  name: string;
  /** True for Chromium browsers: the supported target for direct connections. */
  supported: boolean;
}

interface NavigatorLike {
  userAgent: string;
  userAgentData?: { brands?: { brand: string; version: string }[] };
}

export function detectBrowser(nav: NavigatorLike = navigator as unknown as NavigatorLike): BrowserInfo {
  const ua = nav.userAgent;
  // Every browser on iOS and iPadOS is WebKit underneath, whatever its name.
  if (/iPhone|iPad|iPod/.test(ua)) return { family: 'webkit', name: /FxiOS/.test(ua) ? 'Firefox on iOS' : /CriOS/.test(ua) ? 'Chrome on iOS' : /EdgiOS/.test(ua) ? 'Edge on iOS' : 'Safari', supported: false };
  if (/Firefox\//.test(ua)) return { family: 'firefox', name: 'Firefox', supported: false };
  const brands = nav.userAgentData?.brands?.map((b) => b.brand) ?? [];
  const chromiumUa = /Chrome\/|Chromium\//.test(ua) || brands.includes('Chromium');
  if (chromiumUa) {
    const name = brands.find((b) => /Brave/i.test(b)) ? 'Brave' : /Edg\//.test(ua) || brands.includes('Microsoft Edge') ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : brands.includes('Google Chrome') || /Chrome\//.test(ua) ? 'Chrome' : 'Chromium';
    return { family: 'chromium', name, supported: true };
  }
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return { family: 'webkit', name: 'Safari', supported: false };
  return { family: 'unknown', name: 'This browser', supported: false };
}

export interface ConnectPolicy {
  allowed: boolean;
  reason?: string;
}

/**
 * Whether to even try. Blocking is only for combinations the spike saw fail outright; everything else is attempted,
 * because a failed attempt is reported honestly and a blocked one never gets the chance to work (for example wss://).
 */
export function connectPolicy(browser: BrowserInfo, target: ParsedTarget, pageIsSecure: boolean): ConnectPolicy {
  if (!target.ok) return { allowed: false, reason: target.error };
  if (!pageIsSecure || browser.supported || target.scheme === 'wss') return { allowed: true };
  if (browser.family === 'firefox' && isLoopbackHost(target.host)) return { allowed: true };
  return {
    allowed: false,
    reason: `${browser.name} blocks plain ws:// connections from secure pages. Use a secure wss:// address if your device offers one, or use a Chromium browser (Chrome, Edge or Brave).`,
  };
}

export function unsupportedNotice(browser: BrowserInfo): { title: string; summary: string; steps: string[] } {
  return {
    title: 'This browser is not supported for direct device connection yet',
    summary: `${browser.name} does not let this page open a plain ws:// connection to a device on your network. Nothing is wrong with your device.`,
    steps: [
      'For now, open this page in Chrome, Edge or Brave.',
      'A secure wss:// device address may work in this browser, but it has not been tested here.',
      'Support for other browsers is planned through a different connection method.',
    ],
  };
}
