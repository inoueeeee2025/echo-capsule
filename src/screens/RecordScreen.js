import React, { useEffect, useRef, useState } from "react";
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

const VOICE_BUTTON_SIZE = 150; //ボタンの大きさ
const VOICE_BUTTON_OFFSET_Y = -160; //ボタンの位置調整

const MAX_RECORDING_SECONDS = 300; //録音の最大時間（秒）
const MAX_RECORDING_MS = MAX_RECORDING_SECONDS * 1000;
const TIMER_INTERVAL_MS = 100;

const TOOLBAR_WIDTH = 192;
const TOOLBAR_HEIGHT = 44;
const PILL_WIDTH = TOOLBAR_WIDTH / 2; // 96

//ここから実際の画面
export default function RecordScreen() {
  const [status, setStatus] = useState(STATUS.IDLE);
  const [elapsedMs, setElapsedMs] = useState(0);

  const pulse = useState(new Animated.Value(1))[0];

  const intervalRef = useRef(null);
  const recordingStartRef = useRef(0);

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

  const startRecording = () => {
    if (statusRef.current === STATUS.RECORDING) return;

    console.log("[Record] start");
    clearTimer();
    recordingStartRef.current = Date.now();
    setElapsedMs(0);
    setStatus(STATUS.RECORDING);
    statusRef.current = STATUS.RECORDING;
  };

  const stopRecording = () => {
    if (statusRef.current !== STATUS.RECORDING) return;

    console.log("[Record] stop");
    const elapsed = Math.min(
      Date.now() - recordingStartRef.current,
      MAX_RECORDING_MS,
    );
    setElapsedMs(elapsed);
    clearTimer();
    setStatus(STATUS.RECORDED);
    statusRef.current = STATUS.RECORDED;
  };

  useEffect(() => {
    let loop;

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

  useEffect(() => () => clearTimer(), []);

  const formatElapsed = (ms) => {
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
                  onPress={() => setTab("archive")}
                />

                {/* 文字：PNGに文字が無い場合用（文字がPNGに入ってるなら丸ごと消してOK） */}
                <View style={styles.toolbarTextRow} pointerEvents="none">
                  <Text
                    style={[
                      styles.toolbarText,
                      tab === "rec" && styles.toolbarTextOn,
                    ]}
                  >
                    rec
                  </Text>
                  <Text
                    style={[
                      styles.toolbarText,
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
                  onPressOut={stopRecording}
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
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1 },
  safeArea: { flex: 1 },
  container: { flex: 1, alignItems: "center", paddingHorizontal: 24 },
  topArea: { width: "100%", alignItems: "center", paddingTop: 14 },
  dateText: {
    marginTop: 34,
    fontSize: 33,
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
    fontSize: 30,
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
    marginTop: 6,
  },

  toolbarPng: {
    width: TOOLBAR_WIDTH,
    height: TOOLBAR_HEIGHT,
    position: "relative",
  },

  toolbarBase: {
    position: "absolute",
    width: TOOLBAR_WIDTH,
    height: TOOLBAR_HEIGHT,
    left: 0,
    top: 0,
  },

  toolbarPill: {
    position: "absolute",
    width: PILL_WIDTH,
    height: TOOLBAR_HEIGHT,
    left: 0,
    top: 0,
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
    color: "rgba(60,60,67,0.55)",
  },

  toolbarTextOn: {
    color: "rgba(255,255,255,0.92)",
  },
});
