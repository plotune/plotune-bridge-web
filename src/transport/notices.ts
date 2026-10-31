// Plain-language explanations of how a link ended or failed to open. Close codes are shown only in the
// technical details; the headline and steps never assume a cause the browser does not reveal.
import { isRemoteTarget } from './remote';
import type { CloseInfo, ConnectStage } from './types';

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

export type NoticeKind =
  | 'replaced'
  | 'overflow'
  | 'lost'
  | 'device-closed'
  | 'rejected-message'
  | 'protocol'
  | 'unreachable'
  | 'permission-blocked'
  | 'timeout'
  | 'blocked-by-browser'
  | 'ended'
  | 'signed-out'
  | 'no-access'
  | 'not-found'
  | 'cloud-unavailable'
  | 'device-offline'
  | 'cloud-unreachable'
  | 'link-timeout';

/**
 * Reasons the remote connection sets up before the relay is reached (see createStore). They travel in
 * CloseInfo.reason, so they stay plain strings and never carry a token, ticket or response body.
 */
export type RemoteFailureReason = 'not-signed-in' | 'no-access' | 'not-found' | 'cloud-unavailable';

export interface Notice {
  kind: NoticeKind;
  severity: 'info' | 'warning' | 'error';
  title: string;
  summary: string;
  steps: string[];
  technical: string;
}

export interface NoticeContext {
  pageOrigin: string;
  targetUrl: string;
  permission: PermissionState;
}

function technical(info: CloseInfo): string {
  const parts = [`phase: ${info.phase}`, `close code: ${info.code ?? 'none'}`];
  if (info.reason) parts.push(`reason: ${info.reason}`);
  parts.push(info.wasClean ? 'clean close' : 'no clean close', `closed by: ${info.initiatedBy}`);
  return parts.join(' · ');
}

/** The link never opened. The browser reveals almost nothing (always code 1006), so this lists causes, not a verdict. */
export function explainOpenFailure(info: CloseInfo, ctx: NoticeContext): Notice {
  if (isRemoteTarget(ctx.targetUrl)) return explainRemoteOpenFailure(info);
  const tech = technical(info);
  const scheme = ctx.targetUrl.split(':', 1)[0];
  if (info.reason === 'timeout') {
    return {
      kind: 'timeout',
      severity: 'error',
      title: 'The device did not answer',
      summary: 'Nothing came back before the timeout. If your browser is showing a permission question, answer it and try again.',
      steps: [
        'Check that the device is powered and on the same network as this computer.',
        'Check the address, including the port.',
        'If your browser asked about local network access, choose Allow, then retry.',
      ],
      technical: tech,
    };
  }
  if (ctx.permission === 'denied') {
    return {
      kind: 'permission-blocked',
      severity: 'error',
      title: 'Your browser is blocking access to your local network',
      summary: 'This site has been denied permission to reach devices on your network, so the connection cannot start.',
      steps: [
        'Open the site settings for this page (the icon at the left of the address bar).',
        'Set "Local network" (or "Apps on device") to Allow.',
        'Come back and choose Try again. You may need to reload the page.',
      ],
      technical: tech,
    };
  }
  const steps = [
    'Check that the device is powered, on the same network as this computer, and the address is right.',
    `The device must allow this page. Add ${ctx.pageOrigin} to the device's allowed origins.`,
  ];
  if (ctx.permission !== 'granted') {
    steps.unshift('If you chose Block when your browser asked about local network access, allow it in the site settings for this page.');
  }
  if (scheme === 'ws') steps.push('If the device offers a secure address (wss://), try that instead: browsers restrict plain ws:// from secure pages.');
  return {
    kind: 'unreachable',
    severity: 'error',
    title: "Couldn't connect to the device",
    summary: 'The browser does not say why a connection fails, so here are the usual causes, most likely first.',
    steps,
    technical: tech,
  };
}

/** Shown when a remembered remote device cannot reconnect because this page has no account session. */
export function signInToReconnectNotice(technicalDetails = ''): Notice {
  return {
    kind: 'signed-out',
    severity: 'info',
    title: 'Sign in to reconnect to this device',
    summary: 'Remote devices are reached through your Plotune account.',
    steps: ['Sign in with your Plotune account, then choose Connect next to the device.'],
    technical: technicalDetails,
  };
}

/** A remote connection could not be opened. Reasons come from the cloud setup step, or from the relay link itself. */
export function explainRemoteOpenFailure(info: CloseInfo): Notice {
  const tech = technical(info);
  switch (info.reason as RemoteFailureReason | string) {
    case 'not-signed-in':
      return signInToReconnectNotice(tech);
    case 'no-access':
      return {
        kind: 'no-access',
        severity: 'error',
        title: 'Your account cannot use this device',
        summary: 'Your Plotune account does not have access to this device in the selected project.',
        steps: ['Ask a project owner or admin to check your access, then try again.'],
        technical: tech,
      };
    case 'not-found':
      return {
        kind: 'not-found',
        severity: 'error',
        title: 'This device is not paired to the project',
        summary: 'The device was not found in the selected project. It may have been removed.',
        steps: ['Choose another device, or add this one again with a new pairing code.'],
        technical: tech,
      };
    case 'cloud-unavailable':
      return {
        kind: 'cloud-unavailable',
        severity: 'error',
        title: 'The Plotune cloud could not set up the connection',
        summary: 'The cloud could not be reached or returned an error. Nothing is wrong with your device.',
        steps: ['Check your internet connection, then try again shortly.'],
        technical: tech,
      };
    case 'device is not online':
      return {
        kind: 'device-offline',
        severity: 'error',
        title: 'Your device is not reachable',
        summary: 'The Plotune cloud is working, but your device did not answer. It may be powered off, offline, or its firmware may not support cloud connections yet.',
        steps: ['Make sure the device is powered on and connected to Wi-Fi.', 'Then try again.'],
        technical: tech,
      };
    case 'cloud unreachable':
      return {
        kind: 'cloud-unreachable',
        severity: 'error',
        title: "Couldn't reach the Plotune cloud",
        summary: 'The Plotune cloud did not answer in time. Your device may be fine.',
        steps: ['Check your internet connection, then try again.'],
        technical: tech,
      };
    case 'link setup timed out':
      return {
        kind: 'link-timeout',
        severity: 'error',
        title: 'The connection could not be set up',
        summary: 'The Plotune cloud and your device found each other, but the connection between them could not be set up in time.',
        steps: ['Check that your network does not block the connection. Firewalls and some Wi-Fi networks do.', 'Then try again.'],
        technical: tech,
      };
    default:
      return {
        kind: 'unreachable',
        severity: 'error',
        title: "Couldn't connect through the Plotune cloud",
        summary: 'The connection could not be opened. The browser and the cloud do not say which step failed.',
        steps: ['Check your internet connection, then try again.', 'Make sure the device is online.'],
        technical: tech,
      };
  }
}

/** An established link ended. */
export function explainClose(info: CloseInfo): Notice {
  const tech = technical(info);
  if (info.initiatedBy === 'local' && (info.code === 1000 || info.code === 1005)) {
    return { kind: 'ended', severity: 'info', title: 'Disconnected', summary: 'You disconnected from the device.', steps: [], technical: tech };
  }
  switch (info.code) {
    case 4001:
      return {
        kind: 'replaced',
        severity: 'warning',
        title: 'Another window or tool took over this device',
        summary: 'A device can only talk to one connection at a time. A newer connection replaced this one.',
        steps: ['Connect again to take the device back. Whatever took it over will be disconnected.', 'Use only one workspace tab per device to avoid this.'],
        technical: tech,
      };
    case 1013:
      return {
        kind: 'overflow',
        severity: 'warning',
        title: 'The device closed the link because this page could not keep up',
        summary: 'Data was arriving faster than it could be received. The device keeps capturing and counts what it had to drop.',
        steps: ['Connect again. Check the dropped-frames count to see how much was missed.', 'Close other busy tabs, or lower the bus load, if this repeats.'],
        technical: tech,
      };
    case 1003:
    case 1009:
    case 1007:
      return {
        kind: 'rejected-message',
        severity: 'error',
        title: 'The device rejected something this page sent',
        summary:
          info.code === 1009
            ? 'A message was too large for the device. This should not happen.'
            : 'The device refused a message it could not accept. This should not happen.',
        steps: ['Connect again. If it repeats, please report it with the technical details below.'],
        technical: tech,
      };
    case 4000:
      return {
        kind: 'protocol',
        severity: 'error',
        title: 'The device sent data this page could not understand',
        summary: 'The link was closed instead of guessing. The device may be running an incompatible software version.',
        steps: ['Update the device and this page, then connect again.'],
        technical: tech,
      };
    case 1001:
      return {
        kind: 'device-closed',
        severity: 'info',
        title: 'The device ended the connection',
        summary: 'The device closed the link on purpose, for example while restarting or shutting down.',
        steps: ['Connect again when the device is ready.'],
        technical: tech,
      };
    case 1006:
      return {
        kind: 'lost',
        severity: 'error',
        title: 'Lost the connection to the device',
        summary: 'The link dropped without warning. Common causes are a cable or Wi-Fi interruption, a power loss, or the device restarting.',
        steps: ['Check the cable, network and power, then connect again. Settings stay on the device; the capture on the device may have kept running.'],
        technical: tech,
      };
    default:
      return {
        kind: 'device-closed',
        severity: 'warning',
        title: 'The connection ended',
        summary: 'The device closed the link.',
        steps: ['Connect again.'],
        technical: tech,
      };
  }
}

/** Failures of a remote open that name a cause the user can act on. They offer "Try again" first. */
export const RETRY_NOTICE_KINDS: readonly NoticeKind[] = ['device-offline', 'cloud-unreachable', 'link-timeout'];

/** The headline and the detail line for the connecting screen, for each stage of a remote open. */
export function stageCopy(stage: ConnectStage | null): { title: string; detail: string | null } {
  switch (stage) {
    case 'device':
      return { title: 'Waiting for your device…', detail: 'Make sure it is powered on and connected to Wi-Fi.' };
    case 'link':
      return { title: 'Setting up the connection…', detail: null };
    default:
      return { title: 'Contacting the Plotune cloud…', detail: null };
  }
}
