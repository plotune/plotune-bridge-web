import type { BusState, ChannelStatus } from '../protocol/types';
import { useStore, useWorkspace } from '../state/context';
import { Badge, type Tone } from './Badge';
import { Panel } from './Panel';

export function formatBitrate(bps: number): string {
  return bps >= 1_000_000 ? `${bps / 1_000_000} Mbit/s` : `${bps / 1000} kbit/s`;
}

const BUS: Record<BusState, { label: string; tone: Tone; hint: string }> = {
  error_active: { label: 'Bus OK', tone: 'good', hint: 'Normal operation.' },
  error_warning: { label: 'Bus warning', tone: 'warn', hint: 'The channel is seeing bus errors.' },
  error_passive: { label: 'Bus errors', tone: 'warn', hint: 'Many bus errors: the channel has backed off from signalling errors.' },
  bus_off: { label: 'Bus off', tone: 'bad', hint: 'Too many bus errors: the channel stopped sending. Check wiring, bit rate and termination.' },
};

function ChannelCard({ channel }: { channel: ChannelStatus }) {
  const store = useStore();
  const state = useWorkspace();
  const supported = state.descriptor?.supportedBitrates ?? [];
  const bus = BUS[channel.busState];
  const locked = channel.streaming || state.busy || state.phase !== 'connected';
  const selected = state.captureChannels.includes(channel.channel);
  return (
    <div className="bw-channel" data-testid={`channel-${channel.channel}`}>
      <div className="bw-channel-head">
        <h3>
          {channel.name}
          <span className="bw-muted"> · Channel {channel.channel}</span>
        </h3>
        <div className="bw-badges">
          {channel.streaming && <Badge tone="good">Capturing</Badge>}
          <Badge tone={bus.tone} title={bus.hint}>{bus.label}</Badge>
        </div>
      </div>
      <div className="bw-channel-grid">
        <label className="bw-field">
          <span>Bit rate</span>
          <select
            value={channel.bitrate ?? ''}
            disabled={locked}
            onChange={(e) => e.target.value && void store.setBitrate(channel.channel, Number(e.target.value))}
            aria-label={`${channel.name} bit rate`}
          >
            {channel.bitrate === null && <option value="">Not set</option>}
            {supported.map((bps) => (
              <option key={bps} value={bps}>{formatBitrate(bps)}</option>
            ))}
          </select>
          {channel.streaming && <small>Stop capture to change.</small>}
          {channel.bitrate === null && <small>Idle · set a bit rate to include this channel.</small>}
        </label>
        <div className="bw-field">
          <span id={`term-${channel.channel}`}>Termination (120 Ω)</span>
          <button
            type="button"
            role="switch"
            aria-checked={channel.termination}
            aria-labelledby={`term-${channel.channel}`}
            className={`bw-switch ${channel.termination ? 'is-on' : ''}`}
            disabled={state.busy}
            onClick={() => void store.setTermination(channel.channel, !channel.termination)}
          >
            <span className="bw-switch-knob" aria-hidden="true" />
            <span>{channel.termination ? 'On' : 'Off'}</span>
          </button>
          <small>Off by default. Turn on only if this device sits at an end of the bus.</small>
        </div>
        <label className="bw-field bw-check-field">
          <span>Include in capture</span>
          <input
            type="checkbox"
            checked={selected && channel.bitrate !== null}
            disabled={locked || channel.bitrate === null}
            onChange={(e) => store.setCaptureChannels(e.target.checked ? [...state.captureChannels, channel.channel].sort() : state.captureChannels.filter((c) => c !== channel.channel))}
          />
        </label>
      </div>
      <p className="bw-fine">Device buffer {channel.rxQueueDepth} of {channel.rxQueueCapacity} frames</p>
    </div>
  );
}

export function ChannelsPanel() {
  const state = useWorkspace();
  return (
    <Panel id="channels" title="Channels" status={state.channels.length === 1 ? '1 channel' : `${state.channels.length} channels`}>
      <div className="bw-channels">
        {state.channels.length === 0 && <p className="bw-empty">Connect a device to see its channels.</p>}
        {state.channels.map((c) => (
          <ChannelCard key={c.channel} channel={c} />
        ))}
      </div>
      {state.actionError && (
        <p className="bw-inline-error" role="alert" data-testid="action-error">
          {state.actionError}
        </p>
      )}
    </Panel>
  );
}
