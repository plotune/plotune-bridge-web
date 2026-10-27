import WebSocket from 'ws';

/** Minimal client for the bench generator's control endpoint (one JSON text frame per message). */
export class GeneratorControl {
  private next = 1;
  private readonly pending = new Map<number, (m: { ok: boolean; result?: unknown; error?: { code: string; message: string } }) => void>();
  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString());
      this.pending.get(m.id)?.(m);
      this.pending.delete(m.id);
    });
  }

  static async open(url: string): Promise<GeneratorControl> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const control = new GeneratorControl(ws);
    await control.call('hello', { contract_version: '0.1.0', client: 'plotune-bridge-web-integration-test' });
    return control;
  }

  call(op: string, params: object = {}): Promise<unknown> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (m) => (m.ok ? resolve(m.result) : reject(new Error(`${op}: ${m.error?.code} ${m.error?.message}`))));
      this.ws.send(JSON.stringify({ type: 'request', id, op, params }));
    });
  }

  /** A synthetic ECU answering ISO-TP/UDS on 700/708 and XCP on 600/601, plus one 10 ms periodic message (id 0x180). */
  async enableEcu(): Promise<void> {
    await this.call('configure', { interface: 'virtual-can0', bitrate: 1_000_000, mode: 'normal' });
    await this.call('configure_ecu', {
      configuration: {
        messages: [{ id: 0x180, extended: false, dlc: 8, period_ms: 10, data: '0000000000000000', signals: [{ name: 'EngineSpeed', start_bit: 0, bit_length: 16, byte_order: 'little', signed: false, factor: 1, offset: 0, value: 1000, increment: 1 }] }],
        isotp: { request_id: 0x700, response_id: 0x708, extended: false, max_payload: 256, timeout_ms: 1000 },
        xcp: { request_id: 0x600, response_id: 0x601, extended: false, memory_size: 256 },
      },
    });
    await this.call('enable_ecu', { enabled: true, guard: { bench_isolated: true, termination_checked: true } });
  }

  close(): void {
    this.ws.close();
  }
}
