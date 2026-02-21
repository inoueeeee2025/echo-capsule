export type HardwareState = { stop: boolean; play: boolean; rec: boolean };
type Listener = (s: HardwareState) => void;
type ConnectionListener = (connected: boolean) => void;

class EchoCapsuleWS {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private connectionListeners = new Set<ConnectionListener>();
  private connected = false;

  private emitConnection(connected: boolean) {
    this.connectionListeners.forEach((listener) => listener(connected));
  }

  connect() {
    if (this.ws) return;

    this.ws = new WebSocket("ws://192.168.46.1/ws");

    this.ws.onopen = () => {
      this.connected = true;
      this.emitConnection(true);
      console.log("[HW] ws open");
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.emitConnection(false);
      console.log("[HW] ws close");
      this.ws = null;
    };
    this.ws.onerror = (e) => console.log("[HW] ws error", e);

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as HardwareState;
        this.listeners.forEach((l) => l(data));
      } catch {
        // JSONじゃないゴミは無視
      }
    };
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeConnection(listener: ConnectionListener) {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  isConnected() {
    return this.connected;
  }

  async waitUntilConnected(timeoutMs = 450) {
    if (this.connected) return true;
    this.connect();

    return await new Promise<boolean>((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let unsubscribe: (() => void) | null = null;

      const finish = (value: boolean) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        unsubscribe?.();
        resolve(value);
      };

      unsubscribe = this.subscribeConnection((connected) => {
        if (connected) finish(true);
      });

      timer = setTimeout(() => {
        finish(this.connected);
      }, timeoutMs);
    });
  }
}

export const hardwareWS = new EchoCapsuleWS();
