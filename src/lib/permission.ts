import type { PermissionState } from '../transport/notices';

interface PermissionsLike {
  query(descriptor: { name: string }): Promise<{ state: string }>;
}

/**
 * Best-effort read of the browser's local-network permission. Chromium exposes it under names that have
 * changed between releases, and other browsers do not expose it, so every failure means "unknown", never "denied".
 * The names are not verified against a release browser in this repository (see docs/ux-notes.md, Not tested).
 */
export async function queryLocalNetworkPermission(loopback: boolean, permissions: PermissionsLike | undefined = navigator.permissions): Promise<PermissionState> {
  if (!permissions) return 'unknown';
  const names = loopback ? ['loopback-network'] : ['local-network', 'local-network-access'];
  const states: string[] = [];
  for (const name of names) {
    try {
      states.push((await permissions.query({ name })).state);
    } catch {
      // unknown permission name in this browser
    }
  }
  if (states.includes('denied')) return 'denied';
  if (states.length === 0) return 'unknown';
  return states.includes('prompt') ? 'prompt' : 'granted';
}
