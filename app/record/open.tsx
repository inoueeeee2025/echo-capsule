import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  CapsuleRecord,
  isCapsuleUnlocked,
  loadCapsules,
  updateCapsule,
} from "@/src/capsules/storage";

function formatDateTimeJP(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

export default function CapsuleOpenScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ capsuleId?: string }>();
  const capsuleId = typeof params.capsuleId === "string" ? params.capsuleId : "";

  const [loading, setLoading] = useState(true);
  const [capsule, setCapsule] = useState<CapsuleRecord | null>(null);

  const refresh = useCallback(async () => {
    if (!capsuleId) {
      setCapsule(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const list = await loadCapsules();
    const found = list.find((item) => item.id === capsuleId) ?? null;
    setCapsule(found);
    setLoading(false);
  }, [capsuleId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const unlocked = useMemo(() => {
    if (!capsule) return false;
    return isCapsuleUnlocked(capsule);
  }, [capsule]);

  const openAudio = () => {
    router.replace({
      pathname: "/record/kaihuu",
      params: { capsuleId },
    });
  };

  const openText = () => {
    router.replace({
      pathname: "/record/kaihuu",
      params: { mode: "text", transcriptId: capsuleId, capsuleId },
    });
  };

  const openCapsule = async () => {
    if (!capsule) return;
    if (!capsule.openedAtMs) {
      const next = await updateCapsule(capsule.id, { openedAtMs: Date.now() });
      if (next) setCapsule(next);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator size="large" color="#7e7283" />
      </View>
    );
  }

  if (!capsule) {
    return (
      <ImageBackground
        source={require("../../assets/images/home.png")}
        resizeMode="cover"
        style={styles.background}
      >
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.container}>
            <Text style={styles.title}>カプセルが見つかりません</Text>
            <Pressable style={styles.actionButton} onPress={() => router.back()}>
              <Text style={styles.actionText}>戻る</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </ImageBackground>
    );
  }

  return (
    <ImageBackground
      source={require("../../assets/images/home.png")}
      resizeMode="cover"
      style={styles.background}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Text style={styles.caption}>Echo Capsule</Text>
          <Text style={styles.title}>{capsule.title}</Text>
          <Text style={styles.meta}>
            配達予定: {formatDateTimeJP(capsule.unlockAtMs)}
          </Text>

          {!unlocked ? (
            <Text style={styles.lockedText}>このカプセルはまだ開封できません。</Text>
          ) : (
            <>
              <Pressable
                style={styles.actionButton}
                onPress={async () => {
                  await openCapsule();
                  openAudio();
                }}
              >
                <Text style={styles.actionText}>音声で開封</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.secondaryButton]}
                onPress={async () => {
                  await openCapsule();
                  openText();
                }}
              >
                <Text style={styles.actionText}>テキストで開封</Text>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: "#000" },
  safeArea: { flex: 1 },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  loadingRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f2f2f2",
  },
  caption: {
    fontSize: 13,
    color: "#65626b",
    marginBottom: 12,
    letterSpacing: 1.3,
  },
  title: {
    fontSize: 30,
    color: "#14131a",
    fontWeight: "700",
    textAlign: "center",
  },
  meta: {
    marginTop: 14,
    fontSize: 14,
    color: "#4e4a55",
    textAlign: "center",
  },
  lockedText: {
    marginTop: 28,
    fontSize: 15,
    color: "#43404a",
    textAlign: "center",
    lineHeight: 24,
  },
  actionButton: {
    marginTop: 26,
    width: 260,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(173, 162, 179, 0.78)",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButton: {
    marginTop: 12,
    backgroundColor: "rgba(188, 178, 194, 0.86)",
  },
  actionText: {
    fontSize: 16,
    color: "#faf9fb",
    letterSpacing: 1.2,
    fontWeight: "600",
  },
});
