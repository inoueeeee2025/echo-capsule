export type HardwareState = { stop: boolean; play: boolean; rec: boolean };
type Listener = (s: HardwareState) => void;

class EchoCapsuleWS {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();

  connect() {
    if (this.ws) return;

    this.ws = new WebSocket("ws://192.168.46.1/ws");

    this.ws.onopen = () => console.log("[HW] ws open");
    this.ws.onclose = () => {
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
}

export const hardwareWS = new EchoCapsuleWS();
