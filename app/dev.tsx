import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { hardwareWS, type HardwareDebugStatus } from "@/src/hardware/ws";

const initialStatus = hardwareWS.getDebugStatus();

function formatTime(value: number | null) {
  if (!value) return "まだ受信なし";
  return new Date(value).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusTone(status: HardwareDebugStatus) {
  if (status.connected) return "#2D8A4E";
  if (status.connecting || status.reconnectScheduled) return "#C78719";
  return "#A03C3C";
}

export default function Dev() {
  const [status, setStatus] = useState<HardwareDebugStatus>(initialStatus);

  useEffect(() => {
    hardwareWS.connect();
    return hardwareWS.subscribeStatus(setStatus);
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.title}>Echo Capsule Debug</Text>
        <Text style={styles.subtitle}>
          明日の接続確認用。Wi-Fi, WebSocket, ボタン信号の到達をここで見ます。
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>接続状態</Text>
          <View
            style={[
              styles.pill,
              { backgroundColor: statusTone(status) },
            ]}
          >
            <Text style={styles.pillText}>
              {status.connected
                ? "connected"
                : status.connecting
                  ? "connecting"
                  : status.reconnectScheduled
                    ? "reconnecting"
                    : "disconnected"}
            </Text>
          </View>
        </View>

        <Text style={styles.meta}>URL: {status.url}</Text>
        <Text style={styles.meta}>
          再接続試行回数: {status.reconnectAttempt}
        </Text>
        <Text style={styles.meta}>
          最後の受信: {formatTime(status.lastMessageAt)}
        </Text>
        <Text style={styles.meta}>
          最後のエラー: {status.lastErrorAt ? formatTime(status.lastErrorAt) : "なし"}
        </Text>
        {status.lastError ? (
          <Text style={styles.errorText} numberOfLines={4}>
            {status.lastError}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Pressable style={styles.buttonPrimary} onPress={() => hardwareWS.reconnect()}>
            <Text style={styles.buttonPrimaryText}>再接続</Text>
          </Pressable>
          <Pressable style={styles.buttonSecondary} onPress={() => hardwareWS.disconnect()}>
            <Text style={styles.buttonSecondaryText}>切断</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>ボタン状態</Text>
        <View style={styles.signalRow}>
          <Signal name="STOP" active={status.lastState.stop} />
          <Signal name="PLAY" active={status.lastState.play} />
          <Signal name="REC" active={status.lastState.rec} />
        </View>
        <Text style={styles.hint}>
          ボタンを押して色が切り替われば、WebSocket メッセージがアプリまで届いています。
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>明日の確認順</Text>
        <Text style={styles.step}>1. ハードの Wi-Fi にスマホを接続する</Text>
        <Text style={styles.step}>2. この画面で `connected` になるか見る</Text>
        <Text style={styles.step}>3. STOP / PLAY / REC を押して色が変わるか確認する</Text>
        <Text style={styles.step}>4. 問題なければ通常の録音画面 `/record/rec` を使う</Text>
      </View>
    </ScrollView>
  );
}

function Signal({ name, active }: { name: string; active: boolean }) {
  return (
    <View style={[styles.signal, active ? styles.signalActive : styles.signalIdle]}>
      <Text style={styles.signalName}>{name}</Text>
      <Text style={styles.signalValue}>{active ? "ON" : "OFF"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    gap: 16,
    backgroundColor: "#F4EEE5",
  },
  hero: {
    paddingTop: 40,
    gap: 8,
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    color: "#1E1C1A",
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: "#5A5149",
  },
  card: {
    borderRadius: 24,
    padding: 18,
    gap: 10,
    backgroundColor: "#FFF9F2",
    borderWidth: 1,
    borderColor: "#E1D5C8",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  label: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1E1C1A",
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillText: {
    color: "#FFFFFF",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  meta: {
    fontSize: 14,
    color: "#544C45",
  },
  errorText: {
    fontSize: 13,
    color: "#A03C3C",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  buttonPrimary: {
    flex: 1,
    backgroundColor: "#1E1C1A",
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonPrimaryText: {
    color: "#FFF9F2",
    fontWeight: "700",
  },
  buttonSecondary: {
    flex: 1,
    backgroundColor: "#EADFD2",
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonSecondaryText: {
    color: "#443B34",
    fontWeight: "700",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1E1C1A",
  },
  signalRow: {
    flexDirection: "row",
    gap: 10,
  },
  signal: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: "center",
    gap: 6,
  },
  signalActive: {
    backgroundColor: "#D9472B",
  },
  signalIdle: {
    backgroundColor: "#DDD3C8",
  },
  signalName: {
    fontWeight: "800",
    color: "#1E1C1A",
  },
  signalValue: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFF9F2",
  },
  hint: {
    fontSize: 14,
    lineHeight: 20,
    color: "#5A5149",
  },
  step: {
    fontSize: 14,
    lineHeight: 22,
    color: "#544C45",
  },
});
