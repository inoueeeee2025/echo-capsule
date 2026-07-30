import Constants from "expo-constants";

export type HardwareState = { stop: boolean; play: boolean; rec: boolean };
type Listener = (s: HardwareState) => void;
type ConnectionListener = (connected: boolean) => void;
type StatusListener = (s: HardwareDebugStatus) => void;

export type HardwareDebugStatus = {
  url: string;
  connected: boolean;
  connecting: boolean;
  reconnectScheduled: boolean;
  reconnectAttempt: number;
  lastMessageAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  lastState: HardwareState;
};

const DEFAULT_WS_URL = "ws://192.168.46.1/ws";

function getHardwareWsUrl() {
  const configuredUrl =
    Constants.expoConfig?.extra?.hardware?.wsUrl ??
    Constants.expoConfig?.extra?.hardwareWsUrl;

  return typeof configuredUrl === "string" && configuredUrl.length > 0
    ? configuredUrl
    : DEFAULT_WS_URL;
}

class EchoCapsuleWS {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private connectionListeners = new Set<ConnectionListener>();
  private statusListeners = new Set<StatusListener>();
  private connected = false;
  private connecting = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private manualDisconnect = false;
  private lastMessageAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastError: string | null = null;
  private lastState: HardwareState = { stop: false, play: false, rec: false };

  private emitConnection(connected: boolean) {
    this.connectionListeners.forEach((listener) => listener(connected));
  }

  private emitStatus() {
    const status = this.getDebugStatus();
    this.statusListeners.forEach((listener) => listener(status));
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private scheduleReconnect() {
    if (this.manualDisconnect || this.reconnectTimer || this.connected) return;

    const delayMs = Math.min(5000, 700 * Math.max(1, this.reconnectAttempt + 1));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
    this.emitStatus();
  }

  connect() {
    if (this.ws || this.connecting) return;

    this.manualDisconnect = false;
    this.clearReconnectTimer();
    const wsUrl = getHardwareWsUrl();
    this.connecting = true;
    this.emitStatus();
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      this.connecting = false;
      this.reconnectAttempt = 0;
      this.lastError = null;
      this.emitConnection(true);
      this.emitStatus();
      console.log("[HW] ws open", wsUrl);
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.connecting = false;
      this.emitConnection(false);
      this.ws = null;
      if (!this.manualDisconnect) {
        this.reconnectAttempt += 1;
        this.scheduleReconnect();
      }
      this.emitStatus();
      console.log("[HW] ws close");
    };
    this.ws.onerror = (e) => {
      this.lastErrorAt = Date.now();
      this.lastError = JSON.stringify(e);
      this.emitStatus();
      console.log("[HW] ws error", e);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as HardwareState;
        // ボタンの配線とラベルの対応を確かめるための一時的なログ。
        // どの画面にいても出る。確認が済んだら消す。
        console.log(
          `[HW] btn stop=${data.stop} play=${data.play} rec=${data.rec}`,
        );
        this.lastState = data;
        this.lastMessageAt = Date.now();
        this.emitStatus();
        this.listeners.forEach((l) => l(data));
      } catch {
        // JSONじゃないゴミは無視
      }
    };
  }

  disconnect() {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    this.connecting = false;
    const target = this.ws;
    this.ws = null;
    target?.close();
    this.emitStatus();
  }

  reconnect() {
    this.disconnect();
    this.manualDisconnect = false;
    this.connect();
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

  subscribeStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    listener(this.getDebugStatus());
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  isConnected() {
    return this.connected;
  }

  getUrl() {
    return getHardwareWsUrl();
  }

  getDebugStatus(): HardwareDebugStatus {
    return {
      url: getHardwareWsUrl(),
      connected: this.connected,
      connecting: this.connecting,
      reconnectScheduled: this.reconnectTimer !== null,
      reconnectAttempt: this.reconnectAttempt,
      lastMessageAt: this.lastMessageAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
      lastState: this.lastState,
    };
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
