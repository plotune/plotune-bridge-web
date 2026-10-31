// Shown for a remembered remote device when the page needs the user to sign in: the automatic attempt failed, the user
// signed out in this tab, or this address cannot complete sign-in. Informational, not an error.
export function SignInCard({ signInAvailable, onSignIn, onLocal }: { signInAvailable: boolean; onSignIn: () => void; onLocal: () => void }) {
  return (
    <section className="bw-card bw-sign-in-card" aria-labelledby="sign-in-card-title">
      <h2 id="sign-in-card-title">Sign in to connect to your device</h2>
      <p>Remote devices are reached through your Plotune account.</p>
      {!signInAvailable && (
        <p className="bw-muted">Sign-in with a Plotune account works on bridge.plotune.net. On this address you can still connect to a device on your local network.</p>
      )}
      <div className="bw-actions">
        <button type="button" className="bw-button bw-primary" onClick={onSignIn} disabled={!signInAvailable}>
          Sign in with Plotune
        </button>
        <button type="button" className="bw-button" onClick={onLocal}>
          Use the local network instead
        </button>
      </div>
    </section>
  );
}
