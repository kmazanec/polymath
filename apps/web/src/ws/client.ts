import { type ClientEvent, type ServerMessage, ServerMessage as ServerMessageSchema } from '@polymath/contract';

/**
 * Typed WebSocket client for the agent stream (ADR-009). Outbound frames are
 * `ClientEvent`s; inbound frames are validated against the `ServerMessage` Zod
 * schema before reaching the app (the client trusts only contract-shaped data).
 * Reconnects with a capped backoff.
 */
export interface AgentSocketHandlers {
  onMessage: (msg: ServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export class AgentSocket {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private reconnectDelayMs = 500;
  private readonly maxReconnectDelayMs = 8000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly handlers: AgentSocketHandlers,
  ) {}

  connect(): void {
    this.closedByUser = false;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.reconnectDelayMs = 500;
      this.handlers.onOpen?.();
    });

    ws.addEventListener('message', (ev) => {
      let json: unknown;
      try {
        json = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const parsed = ServerMessageSchema.safeParse(json);
      if (parsed.success) {
        this.handlers.onMessage(parsed.data);
      }
    });

    ws.addEventListener('close', () => {
      this.handlers.onClose?.();
      if (!this.closedByUser) this.scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }

  private scheduleReconnect(): void {
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(delay * 2, this.maxReconnectDelayMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.connect();
    }, delay);
  }

  send(event: ClientEvent): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  close(): void {
    this.closedByUser = true;
    // Cancel any pending reconnect so close() during the backoff window keeps
    // no dangling timer alive (matters under React StrictMode mount/unmount).
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
  }
}
