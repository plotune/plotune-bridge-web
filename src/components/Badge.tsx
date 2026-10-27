import type { ReactNode } from 'react';

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`bw-badge bw-${tone}`} title={title}>
      <span className="bw-dot" aria-hidden="true" />
      {children}
    </span>
  );
}
