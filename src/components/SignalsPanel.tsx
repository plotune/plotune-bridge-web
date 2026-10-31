import { useSyncExternalStore } from 'react';
import { Panel } from './Panel';
import type { SignalSource } from '../core/model';
import type { SignalBuffer } from '../core/signal-buffer';

/** A generic table of a source's scalar signals: name, latest value and unit. Knows nothing about CAN or any product. */
export function SignalsPanel({ source }: { source: SignalSource & Pick<SignalBuffer, 'getVersion' | 'onChange'> }) {
  useSyncExternalStore(source.onChange, source.getVersion);
  const signals = source.signals();
  return (
    <Panel id="signals" title="Signals" status={`${signals.length} ${signals.length === 1 ? 'signal' : 'signals'}`}>
      {signals.length === 0 ? (
        <p className="bw-empty">This source has not declared any signals yet.</p>
      ) : (
        <table className="bw-table">
          <caption className="bw-sr-only">Latest value of each signal</caption>
          <thead>
            <tr>
              <th scope="col">Signal</th>
              <th scope="col">Value</th>
              <th scope="col">Unit</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((info) => {
              const sample = source.latest(info.id);
              return (
                <tr key={info.id}>
                  <th scope="row">{info.name}</th>
                  <td>{sample ? sample.value : 'no data yet'}</td>
                  <td>{info.unit ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
