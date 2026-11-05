// BWEB-042 rev 1 / O8 — regression test for the exact inputs in the opencode-server repro evidence
// (before-state, shared preview build 427f36a). The evidence's four parseTarget results describe the
// BUGGY before-state; three of them must not be asserted as expected behaviour. The fix documents one
// honest rule (src/lib/target.ts, docs/bweb-042-o8.md): a direct target must carry an explicit port,
// and no default is invented for ws:// (80) or wss:// (443) — the single rule applies to wss:// too.
import { describe, expect, it } from 'vitest';
import { parseTarget } from '../src/lib/target';

const MISSING_PORT = 'Add the port, for example 192.168.1.50:9101.';

describe('O8 repro evidence: the reported before-state is now rejected', () => {
  it.each([
    '192.168.1.50',      // before: ok, ws://192.168.1.50 (silently port 80)
    'ws://192.168.1.50', // before: same
  ])('%j now returns the explicit-port error', (input) => {
    expect(parseTarget(input)).toMatchObject({ ok: false, url: '', scheme: null, error: MISSING_PORT });
  });

  it('the explicit-port form is unchanged', () => {
    expect(parseTarget('192.168.1.50:9101')).toMatchObject({ ok: true, url: 'ws://192.168.1.50:9101', scheme: 'ws' });
  });

  it('wss://host follows the documented rule, not the before-state "ok (443)"', () => {
    // Before-state evidence said "wss://bridge.example.net -> ok (443)". The documented decision is
    // "no default port is invented, and the single rule applies to wss:// too", so a port-less wss://
    // address is rejected; the same address with an explicit :443 remains valid.
    expect(parseTarget('wss://bridge.example.net')).toMatchObject({ ok: false, url: '', scheme: null, error: MISSING_PORT });
    expect(parseTarget('wss://bridge.example.net:443')).toMatchObject({ ok: true, url: 'wss://bridge.example.net:443', scheme: 'wss' });
  });
});
