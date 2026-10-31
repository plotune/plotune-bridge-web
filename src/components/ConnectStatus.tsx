// What a remote connection is doing now, stage by stage. After a while in the device stage it says so, because that
// stage is the one that waits for the device itself.
import { useEffect, useState } from 'react';
import { stageCopy } from '../transport/notices';
import type { ConnectStage } from '../transport/types';

/** How long the device stage runs before it is said to be taking longer than usual. */
export const SLOW_STAGE_MS = 5_000;

export function ConnectStatus({ stage }: { stage: ConnectStage | null }) {
  // The slow line belongs to one device stage only: it is cleared whenever the stage changes.
  const [slowStage, setSlowStage] = useState<ConnectStage | null>(null);
  useEffect(() => {
    if (stage !== 'device') return undefined;
    const timer = setTimeout(() => setSlowStage('device'), SLOW_STAGE_MS);
    return () => {
      clearTimeout(timer);
      setSlowStage(null);
    };
  }, [stage]);
  const copy = stageCopy(stage);
  return (
    <div className="bw-connect-status" role="status" aria-live="polite">
      <p className="bw-connect-title">
        <span className="bw-spinner" aria-hidden="true" /> {copy.title}
      </p>
      {copy.detail !== null && <p className="bw-muted">{copy.detail}</p>}
      {stage === 'device' && slowStage === 'device' && <p className="bw-muted">This is taking longer than usual.</p>}
    </div>
  );
}
