/** Minimal WebSocket stand-in: enough surface for WebSocketTransport, driven explicitly by the test. */
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static throwOnConstruct: Error | null = null;

  readyState = 0;
  bufferedAmount = 0;
  readonly sent: string[] = [];
  closeCalls: { code?: number; reason?: string }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    if (FakeWebSocket.throwOnConstruct) throw FakeWebSocket.throwOnConstruct;
    FakeWebSocket.instances.push(this);
  }

  send(text: string): void {
    this.sent.push(text);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    if (this.readyState === 3) return;
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code: code ?? 1005, reason: reason ?? '', wasClean: true }));
  }

  // -- test controls --
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(data: unknown): void {
    this.onmessage?.({ data });
  }
  /** The remote end ends the link (or the browser reports a failed connection with 1006). */
  serverClose(code: number, reason = '', wasClean = code !== 1006): void {
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean });
  }
}
