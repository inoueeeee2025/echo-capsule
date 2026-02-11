import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { Audio } from "expo-av";
import {
  Animated,
  Image,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const STATUS = {
  IDLE: "idle",
  RECORDING: "recording",
  RECORDED: "recorded",
};

const VOICE_BUTTON_SIZE = 140; //ボタンの大きさ
const VOICE_BUTTON_OFFSET_Y = -160; //ボタンの位置調整

const MAX_RECORDING_SECONDS = 300; //録音の最大時間（秒）
const MAX_RECORDING_MS = MAX_RECORDING_SECONDS * 1000;
const TIMER_INTERVAL_MS = 100;

const TOOLBAR_WIDTH = 204;
const TOOLBAR_HEIGHT = 44;

const PILL_WIDTH = TOOLBAR_WIDTH / 2; // 96

//ここから実際の画面
export default function RecordScreen() {
  const router = useRouter();
  const [status, setStatus] = useState(STATUS.IDLE);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastRecordedUri, setLastRecordedUri] = useState<string | null>(null);
  const [lastRecordedAtMs, setLastRecordedAtMs] = useState<number | null>(null);

  const pulse = useState(new Animated.Value(1))[0];

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef(0);
  const recordingRef = useRef<Audio.Recording | null>(null);

  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const isRecording = status === STATUS.RECORDING;
  const isRecorded = status === STATUS.RECORDED;

  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const [tab, setTab] = useState("rec"); // "rec" | "archive"

  // ピルのスライド量（0=左 / 右へ移動）
  const activeX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(activeX, {
      toValue: tab === "rec" ? 0 : PILL_WIDTH,
      useNativeDriver: true,
      speed: 18,
      bounciness: 6,
    }).start();
  }, [tab, activeX]);

  const startRecording = async () => {
    if (statusRef.current === STATUS.RECORDING) return;

    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        console.warn("[Record] mic permission denied");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
    } catch (error) {
      console.warn("[Record] start failed:", error);
      return;
    }

    clearTimer();
    recordingStartRef.current = Date.now();
    setElapsedMs(0);
    setStatus(STATUS.RECORDING);
    statusRef.current = STATUS.RECORDING;
  };

  const stopRecording = async (): Promise<{ uri: string; recordedAtMs: number } | null> => {
    if (statusRef.current !== STATUS.RECORDING) return null;

    const elapsed = Math.min(
      Date.now() - recordingStartRef.current,
      MAX_RECORDING_MS,
    );
    setElapsedMs(elapsed);
    clearTimer();
    setStatus(STATUS.RECORDED);
    statusRef.current = STATUS.RECORDED;

    const recording = recordingRef.current;
    recordingRef.current = null;

    if (!recording) return null;

    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      const uri = recording.getURI();
      if (uri) {
        const recordedAtMs = Date.now();
        setLastRecordedUri(uri);
        setLastRecordedAtMs(recordedAtMs);
        return { uri, recordedAtMs };
      }
    } catch (error) {
      console.warn("[Record] stop failed:", error);
    }
    return null;
  };

  const handleRecordPressOut = () => {
    if (statusRef.current !== STATUS.RECORDING) return;
    (async () => {
      const result = await stopRecording();
      router.push({
        pathname: "/record/done",
        params: result
          ? { uri: result.uri, recordedAtMs: String(result.recordedAtMs) }
          : undefined,
      });
    })();
  };

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;

    if (isRecording) {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1.08,
            duration: 650,
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 1,
            duration: 650,
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
    } else {
      pulse.stopAnimation();
      pulse.setValue(1);
    }

    return () => {
      if (loop) loop.stop();
    };
  }, [isRecording, pulse]);

  useEffect(() => {
    if (!isRecording) {
      clearTimer();
      return;
    }

    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - recordingStartRef.current;
      const clampedElapsed = Math.min(elapsed, MAX_RECORDING_MS);
      setElapsedMs(clampedElapsed);

      if (elapsed >= MAX_RECORDING_MS) {
        console.log("[Record] auto-stop (5min)");
        clearTimer();
        setStatus(STATUS.RECORDED);
        statusRef.current = STATUS.RECORDED;
      }
    }, TIMER_INTERVAL_MS);

    return () => clearTimer();
  }, [isRecording]);

  useEffect(() => {
    return () => {
      clearTimer();
      const recording = recordingRef.current;
      recordingRef.current = null;
      if (recording) {
        recording.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  const formatElapsed = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  };

  //ここからUI描画
  return (
    <ImageBackground
      source={require("../../assets/images/home.png")}
      resizeMode="cover"
      style={[styles.background, { backgroundColor: "#000" }]}
      imageStyle={{ opacity: 1 }}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <View style={styles.topArea}>
            {/* ツールバー領域（高さを確保） */}
            <View style={styles.toolbarWrapper}>
              <View style={styles.toolbarPng}>
                {/* 土台 */}
                <Image
                  source={require("../../assets/images/Switch_base.png")}
                  style={styles.toolbarBase}
                  resizeMode="contain"
                />

                {/* 選択ピル：左右にスライド */}
                <Animated.Image
                  source={require("../../assets/images/Segmented_active.png")}
                  style={[
                    styles.toolbarPill,
                    { transform: [{ translateX: activeX }] },
                  ]}
                  resizeMode="contain"
                />

                {/* タップ領域（透明） */}
                <Pressable
                  style={styles.hitLeft}
                  onPress={() => setTab("rec")}
                />
                <Pressable
                  style={styles.hitRight}
                  onPress={() => {
                    setTab("archive");
                    router.push({
                      pathname: "/record/done",
                      params:
                        lastRecordedUri && lastRecordedAtMs
                          ? { uri: lastRecordedUri, recordedAtMs: String(lastRecordedAtMs) }
                          : lastRecordedUri
                            ? { uri: lastRecordedUri }
                            : undefined,
                    });
                  }}
                />

                {/* 文字：PNGに文字が無い場合用（文字がPNGに入ってるなら丸ごと消してOK） */}
                <View style={styles.toolbarTextRow} pointerEvents="none">
                  <Text
                    style={[
                      styles.toolbarText,
                      styles.toolbarTextRec,
                      tab === "rec" && styles.toolbarTextOn,
                    ]}
                  >
                    rec
                  </Text>
                  <Text
                    style={[
                      styles.toolbarText,
                      styles.toolbarTextArchive,
                      tab === "archive" && styles.toolbarTextOn,
                    ]}
                  >
                    archive
                  </Text>
                </View>
              </View>
            </View>

            {/* 日付（これがズレなくなる） */}
            <Text style={styles.dateText}>2026/1/31 Sat</Text>
          </View>

          <View style={styles.centerArea}>
            <View
              style={[styles.recordGroup, { marginTop: VOICE_BUTTON_OFFSET_Y }]}
            >
              <Animated.View
                style={[
                  styles.buttonWrap,
                  isRecording && styles.recordingGlow,
                  { transform: [{ scale: pulse }] },
                ]}
              >
                <Pressable
                  style={styles.buttonPressable}
                  onPress={() => console.log("[Record] onPress")}
                  onPressIn={startRecording}
                  onPressOut={handleRecordPressOut}
                  pressRetentionOffset={{
                    top: 10000,
                    left: 10000,
                    right: 10000,
                    bottom: 10000,
                  }}
                  hitSlop={12}
                >
                  <Image
                    source={require("../../assets/images/home_voiceButton.png")}
                    style={[
                      styles.voiceButton,
                      isRecorded && styles.voiceButtonRecorded,
                    ]}
                    resizeMode="contain"
                  />
                </Pressable>
              </Animated.View>
              <Text style={styles.recordTimeText}>
                {formatElapsed(elapsedMs)}
              </Text>
            </View>
          </View>
          <Text style={styles.recordGuideText}>長押しして録音しましょう</Text>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1 },
  safeArea: { flex: 1 },
  container: { flex: 1, alignItems: "center", paddingHorizontal: 24 },
  topArea: { width: "100%", alignItems: "center", paddingTop: 26 },
  dateText: {
    marginTop: 38,
    fontSize: 15,
    fontWeight: "600",
    color: "#767680",
    letterSpacing: 0.2,
  },
  centerArea: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  recordGroup: {
    alignItems: "center",
    justifyContent: "center",
  },
  buttonWrap: {
    width: 176,
    height: 176,
    borderRadius: 88,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPressable: {
    width: 176,
    height: 176,
    borderRadius: 88,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  voiceButton: { width: VOICE_BUTTON_SIZE, height: VOICE_BUTTON_SIZE },
  recordTimeText: {
    marginTop: 20,
    fontSize: 12,
    fontWeight: "600",
    color: "#767680",
    letterSpacing: 0.2,
  },
  recordGuideText: {
    position: "absolute",
    bottom: 84,
    fontSize: 36 / 3,
    fontWeight: "600",
    color: "#767680",
    letterSpacing: 0.2,
  },
  voiceButtonRecorded: { tintColor: "#b8b8bc", opacity: 0.9 },
  recordingGlow: {
    shadowColor: "#60a8ec",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },

  toolbarWrapper: {
    width: "100%",
    alignItems: "center",
    marginTop: 30,
  },

  toolbarPng: {
    width: TOOLBAR_WIDTH,
    height: TOOLBAR_HEIGHT,
    position: "relative",
    transform: [{ scale: 0.94 }],
  },

  toolbarBase: {
    position: "absolute",
    width: TOOLBAR_WIDTH,
    height: TOOLBAR_HEIGHT,
    left: 0,
    top: 0,
    opacity: 0.55,
    tintColor: "rgb(150,140,155)",
    shadowColor: "#8f7c8f",
    shadowOpacity: 0.26,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },

  toolbarPill: {
    position: "absolute",
    width: PILL_WIDTH - 16,
    height: TOOLBAR_HEIGHT - 6,
    left: 8,
    top: 3,
    opacity: 0.82,
    tintColor: "rgba(255, 255, 255, 0.8)",
    shadowColor: "#ffffff",
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },

  hitLeft: {
    position: "absolute",
    left: 0,
    top: 0,
    width: PILL_WIDTH,
    height: TOOLBAR_HEIGHT,
  },

  hitRight: {
    position: "absolute",
    left: PILL_WIDTH,
    top: 0,
    width: PILL_WIDTH,
    height: TOOLBAR_HEIGHT,
  },

  toolbarTextRow: {
    position: "absolute",
    left: 0,
    top: 0,
    width: TOOLBAR_WIDTH,
    height: TOOLBAR_HEIGHT,
    flexDirection: "row",
  },

  toolbarText: {
    width: PILL_WIDTH,
    textAlign: "center",
    lineHeight: TOOLBAR_HEIGHT,
    fontSize: 15,
    fontWeight: "600",
    color: "rgba(255,255,255,0.85)",
  },

  toolbarTextRec: {
    transform: [{ translateX: 6 }],
  },

  toolbarTextArchive: {
    transform: [{ translateX: -6 }],
  },

  toolbarTextOn: {
    color: "rgba(255,255,255,0.85)",
  },
});
