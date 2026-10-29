import { useState, type FormEvent } from 'react';
import { unsupportedNotice, type BrowserInfo } from '../lib/browser';
import { useHub, useHubState, useStore, useWorkspace } from '../state/context';
import { IconCheck, IconCopy, IconInfo, IconLink } from './icons';
import { NoticeCard } from './Notice';

export function UnsupportedBanner({ browser }: { browser: BrowserInfo }) {
  const notice = unsupportedNotice(browser);
  return (
    <div className="bw-notice bw-notice-warning" role="status" data-testid="unsupported-browser">
      <IconInfo className="bw-notice-icon" />
      <div className="bw-notice-body">
        <strong>{notice.title}</strong>
        <p>{notice.summary}</p>
        <ul>
          {notice.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Shown before the first connection: what the browser is about to ask, and what to answer. */
export function PermissionExplainer({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="bw-card bw-explainer" aria-labelledby="explainer-title" data-testid="permission-explainer">
      <p className="bw-eyebrow">Before you connect</p>
      <h1 id="explainer-title">Your browser will ask for permission</h1>
      <p className="bw-lead">Plotune Bridge talks to your device directly from this page, over your local network. Browsers treat that as sensitive, so they ask you first.</p>
      <ol className="bw-steps">
        <li>
          <div>
            <strong>When you connect, a question appears.</strong> Your browser asks whether this site may access devices on your local network. The wording differs by browser, for example “Access other devices on your local network”.
          </div>
        </li>
        <li>
          <div>
            <strong>Choose Allow.</strong> If you choose Block, the browser stops the connection and nothing reaches your device.
          </div>
        </li>
        <li>
          <div>
            <strong>Blocked by mistake?</strong> Open the site settings (the icon at the left of the address bar), set Local network to Allow, then connect again.
          </div>
        </li>
      </ol>
      <p className="bw-fine">Device traffic goes straight from this page to your device at the address you enter. It does not pass through Plotune servers.</p>
      <div className="bw-actions">
        <button type="button" className="bw-button bw-primary" onClick={onContinue}>
          Continue
        </button>
      </div>
    </section>
  );
}

function CopyOrigin({ origin }: { origin: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(origin).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <span className="bw-origin">
      <code>{origin}</code>
      <button type="button" className="bw-icon-button" onClick={copy} aria-label="Copy this page's address" title="Copy">
        {copied ? <IconCheck /> : <IconCopy />}
      </button>
    </span>
  );
}

export function ConnectView({ browser, pageOrigin }: { browser: BrowserInfo; pageOrigin: string }) {
  const store = useStore();
  const state = useWorkspace();
  const hub = useHub();
  const { permissionExplained: explained } = useHubState();
  const [address, setAddress] = useState(() => state.target);

  const connect = (target: string) => {
    void store.connect(target);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    connect(address);
  };

  if (state.phase === 'connecting') {
    return (
      <section className="bw-card bw-connecting" aria-live="polite" data-testid="connecting">
        <p className="bw-eyebrow">Connecting</p>
        <h1>
          <span className="bw-spinner" aria-hidden="true" /> Connecting to {state.target}
        </h1>
        {state.slowConnect ? (
          <p className="bw-lead" data-testid="prompt-reminder">
            Still waiting. If your browser is asking about access to devices on your local network, choose <strong>Allow</strong>. Otherwise the device may not be reachable.
          </p>
        ) : (
          <p className="bw-lead">Opening a direct connection to your device.</p>
        )}
        <div className="bw-actions">
          <button
            type="button"
            className="bw-button"
            onClick={() => {
              store.disconnect();
              store.reset();
            }}
          >
            Cancel
          </button>
        </div>
      </section>
    );
  }

  if (!explained && browser.supported && !state.notice) {
    return (
      <PermissionExplainer
        onContinue={() => {
          hub.explainPermission();
        }}
      />
    );
  }

  const showForm = !state.notice || state.notice.kind === 'ended';
  return (
    <div className="bw-connect">
      {!browser.supported && <UnsupportedBanner browser={browser} />}
      {state.notice && (
        <NoticeCard
          notice={state.notice}
          actions={
            state.notice.kind !== 'ended' && (
              <>
                {state.target && state.notice.kind !== 'blocked-by-browser' && (
                  <button type="button" className="bw-button bw-primary" onClick={() => connect(state.target)}>
                    Try again
                  </button>
                )}
                <button type="button" className="bw-button" onClick={() => store.reset()}>
                  Change address
                </button>
              </>
            )
          }
        />
      )}
      {showForm && (
        <section className="bw-card" aria-labelledby="connect-title">
          <p className="bw-eyebrow">Device</p>
          <h1 id="connect-title">Connect to a Bridge device</h1>
          <form onSubmit={submit} className="bw-form">
            <label htmlFor="device-address">Device address</label>
            <div className="bw-form-row">
              <input id="device-address" name="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.50:9101" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-describedby="address-hint" required />
              <button type="submit" className="bw-button bw-primary">
                <IconLink /> Connect
              </button>
            </div>
            <p id="address-hint" className="bw-hint">
              For example 192.168.1.50:9101. Use a wss:// address if your device offers a secure one.
            </p>
          </form>
          <details className="bw-details" open={!state.notice}>
            <summary>What will my browser ask?</summary>
            <p>
              It asks whether this site may access devices on your local network. Choose <strong>Allow</strong>. If you chose Block earlier, change it in the site settings for this page and connect again.
            </p>
          </details>
          <div className="bw-requirement">
            <strong>The device must allow this page.</strong>
            <p>
              Devices only accept connections from pages they trust. Add this address to the device's allowed origins: <CopyOrigin origin={pageOrigin} />
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
