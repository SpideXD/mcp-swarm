/**
 * SSE event stream consumer for real-time updates from the swarm server.
 *
 * Connects to GET /events and dispatches typed events to registered listeners.
 */

export type SseEventData = {
  type: string;
  timestamp?: number;
  data?: Record<string, unknown>;
};

export type SseEventHandler = (event: SseEventData) => void;

export type SseConnectionState = "disconnected" | "connected" | "reconnecting";

export type SseConnectionHandler = (state: SseConnectionState) => void;

export class SseClient {
  private eventSource: EventSource | null = null;
  private listeners: Map<string, Set<SseEventHandler>> = new Map();
  private globalListeners: Set<SseEventHandler> = new Set();
  private connectionListeners: Set<SseConnectionHandler> = new Set();
  private _url: string | null = null;
  private _connectionState: SseConnectionState = "disconnected";

  private setConnectionState(state: SseConnectionState) {
    if (this._connectionState === state) return;
    this._connectionState = state;
    this.connectionListeners.forEach((handler) => handler(state));
  }

  connect(url: string = "http://localhost:3100/events"): void {
    this.disconnect();
    this._url = url;
    this.eventSource = new EventSource(url);

    this.eventSource.onopen = () => {
      this.setConnectionState("connected");
    };

    this.eventSource.onmessage = (event) => {
      // Receiving a message means we're connected
      if (this._connectionState !== "connected") {
        this.setConnectionState("connected");
      }
      try {
        const parsed: SseEventData = JSON.parse(event.data);
        // Skip ping events
        if (parsed.type === "ping") return;

        // Dispatch to type-specific listeners
        const typeListeners = this.listeners.get(parsed.type);
        if (typeListeners) {
          typeListeners.forEach((handler) => handler(parsed));
        }

        // Dispatch to global listeners
        this.globalListeners.forEach((handler) => handler(parsed));
      } catch {
        // Ignore parse errors
      }
    };

    this.eventSource.onerror = () => {
      // EventSource auto-reconnects; surface the reconnecting state
      if (this.eventSource?.readyState === EventSource.CONNECTING) {
        this.setConnectionState("reconnecting");
      } else if (this.eventSource?.readyState === EventSource.CLOSED) {
        this.setConnectionState("disconnected");
      }
    };
  }

  /** Subscribe to a specific event type. Returns unsubscribe function. */
  on(eventType: string, callback: SseEventHandler): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(callback);
    return () => {
      this.listeners.get(eventType)?.delete(callback);
    };
  }

  /** Subscribe to all events. Returns unsubscribe function. */
  onAny(callback: SseEventHandler): () => void {
    this.globalListeners.add(callback);
    return () => {
      this.globalListeners.delete(callback);
    };
  }

  /** Subscribe to connection state changes. Returns unsubscribe function. */
  onConnectionChange(callback: SseConnectionHandler): () => void {
    this.connectionListeners.add(callback);
    return () => {
      this.connectionListeners.delete(callback);
    };
  }

  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this._url = null;
    this.setConnectionState("disconnected");
  }

  get connected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }

  get connecting(): boolean {
    return this.eventSource?.readyState === EventSource.CONNECTING;
  }

  get connectionState(): SseConnectionState {
    return this._connectionState;
  }

  get url(): string | null {
    return this._url;
  }
}

export const sseClient = new SseClient();
