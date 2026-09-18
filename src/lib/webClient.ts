// Web Client / WebSocket Bridge for Remote Browser access (iPad, remote PC, etc.)
// Seamlessly operates alongside Tauri desktop IPC.

export const isTauri = () => {
  return typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);
};

export interface WsServerEvent {
  type:
    | "output"
    | "prompt"
    | "status"
    | "pre_launch_output"
    | "pre_launch_status"
    | "cwd_changed"
    | "auth_ok"
    | "auth_error";
  payload: any;
}

type EventCallback = (payload: any) => void;

class WebClientBridge {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private token: string | null = null;
  private isConnected = false;
  private reconnectTimer: any = null;

  public isSocketConnected(): boolean {
    return this.isConnected;
  }

  constructor() {
    if (typeof window !== "undefined") {
      this.token = localStorage.getItem("agent_deck_web_token");
    }
  }

  public getToken(): string | null {
    return this.token;
  }

  public setToken(token: string) {
    this.token = token;
    localStorage.setItem("agent_deck_web_token", token);
  }

  public clearToken() {
    this.token = null;
    localStorage.removeItem("agent_deck_web_token");
  }

  public connect(onAuthFailed?: () => void) {
    if (isTauri() || typeof window === "undefined") return;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        if (this.token) {
          this.sendAction("auth", { token: this.token });
        } else if (onAuthFailed) {
          onAuthFailed();
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const parsed: WsServerEvent = JSON.parse(event.data);
          if (parsed.type === "auth_error") {
            this.clearToken();
            onAuthFailed?.();
          }
          this.emit(parsed.type, parsed.payload);
        } catch (e) {
          console.error("Error parsing WS message:", e);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.ws = null;
        // Auto reconnect after 2.5 seconds
        if (!this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect(onAuthFailed);
          }, 2500);
        }
      };

      this.ws.onerror = (err) => {
        console.error("WebSocket error:", err);
      };
    } catch (e) {
      console.error("Failed to construct WebSocket:", e);
    }
  }

  public sendAction(type: string, payload?: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  public on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private emit(event: string, payload: any) {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(payload);
      } catch (e) {
        console.error(`Error in event callback for ${event}:`, e);
      }
    });
  }
}

export const webClient = new WebClientBridge();
