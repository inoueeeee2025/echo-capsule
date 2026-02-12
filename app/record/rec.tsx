import { Audio, AVPlaybackStatus } from "expo-av";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Slider from "@react-native-community/slider";
import { useFonts } from "expo-font";
import { ZenAntiqueSoft_400Regular } from "@expo-google-fonts/zen-antique-soft";
import {
  Animated,
  Easing,
  Image,
  ImageBackground,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const STATUS = {
  IDLE: "idle",
  RECORDING: "recording",
  RECORDED: "recorded",
} as const;

const FLOW = {
  RECORD: "record",
  REVIEW: "review",
} as const;

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MAX_RECORDING_SECONDS = 300;
const MAX_RECORDING_MS = MAX_RECORDING_SECONDS * 1000;
const TIMER_INTERVAL_MS = 100;

const TOOLBAR_WIDTH = 204;
const TOOLBAR_HEIGHT = 44;
const PILL_WIDTH = TOOLBAR_WIDTH / 2;

const VOICE_BUTTON_SIZE = 140;
const RECORD_BUTTON_OFFSET_Y = -160;
const REVIEW_BUTTON_OFFSET_Y = -10;

const TRANSPARENT_THUMB = {
  uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6p8N8AAAAASUVORK5CYII=",
};

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const w = WEEKDAY[date.getDay()];
  return `${y}/${m}/${d} ${w}`;
}

function formatMillis(millis: number): string {
  const safe = Number.isFinite(millis) && millis > 0 ? millis : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function RecordDoneScreen() {
  const router = useRouter();
  const [zenAntiqueSoftLoaded] = useFonts({
    ZenAntiqueSoft_400Regular,
  });

  const [flow, setFlow] = useState<(typeof FLOW)[keyof typeof FLOW]>(FLOW.RECORD);
  const [recordStatus, setRecordStatus] = useState<(typeof STATUS)[keyof typeof STATUS]>(STATUS.IDLE);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastRecordedUri, setLastRecordedUri] = useState<string | null>(null);
  const [lastRecordedAtMs, setLastRecordedAtMs] = useState<number | null>(null);
  const [recordedDateKey, setRecordedDateKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const [isLoaded, setIsLoaded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const [sliderMillis, setSliderMillis] = useState(0);
  const [sliderWidth, setSliderWidth] = useState(0);

  const [isProjectModalVisible, setIsProjectModalVisible] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [savedProjectName, setSavedProjectName] = useState("");
  const [isSaveComplete, setIsSaveComplete] = useState(false);

  const pulse = useRef(new Animated.Value(1)).current;
  const saveReveal = useRef(new Animated.Value(0)).current;
  const flowProgress = useRef(new Animated.Value(0)).current;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const autoStoppingRef = useRef(false);

  const recordStatusRef = useRef(recordStatus);
  useEffect(() => {
    recordStatusRef.current = recordStatus;
  }, [recordStatus]);

  const isRecording = recordStatus === STATUS.RECORDING;
  const todayKey = useMemo(() => toDateKey(now), [now]);
  const isLockedToday = recordedDateKey === todayKey;

  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const unloadSound = useCallback(async () => {
    const s = soundRef.current;
    soundRef.current = null;
    if (s) {
      try {
        await s.unloadAsync();
      } catch {}
    }
    setIsLoaded(false);
    setIsPlaying(false);
    setPositionMillis(0);
    setDurationMillis(0);
    setSliderMillis(0);
  }, []);

  const onPlaybackStatusUpdate = useCallback(
    (status: AVPlaybackStatus) => {
      if (!status.isLoaded) {
        setIsLoaded(false);
        setIsPlaying(false);
        setPositionMillis(0);
        setDurationMillis(0);
        if (!isSliding) setSliderMillis(0);
        return;
      }
      setIsLoaded(true);
      setIsPlaying(status.isPlaying);
      setPositionMillis(status.positionMillis ?? 0);
      setDurationMillis(status.durationMillis ?? 0);
      if (!isSliding) setSliderMillis(status.positionMillis ?? 0);
    },
    [isSliding],
  );

  const stopRecording = useCallback(async (): Promise<{ uri: string; recordedAtMs: number } | null> => {
    if (recordStatusRef.current !== STATUS.RECORDING) return null;

    const elapsed = Math.min(Date.now() - recordingStartRef.current, MAX_RECORDING_MS);
    setElapsedMs(elapsed);
    clearTimer();
    setRecordStatus(STATUS.RECORDED);
    recordStatusRef.current = STATUS.RECORDED;

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
      if (!uri) return null;

      const recordedAtMs = Date.now();
      setLastRecordedUri(uri);
      setLastRecordedAtMs(recordedAtMs);
      setRecordedDateKey(toDateKey(new Date(recordedAtMs)));
      return { uri, recordedAtMs };
    } catch (error) {
      console.warn("[Record] stop failed:", error);
      return null;
    }
  }, []);

  const startRecording = async () => {
    if (recordStatusRef.current === STATUS.RECORDING || isLockedToday || flow !== FLOW.RECORD) return;

    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) return;

      await unloadSound();
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
    setRecordStatus(STATUS.RECORDING);
    recordStatusRef.current = STATUS.RECORDING;
  };

  const handleRecordPressOut = () => {
    if (recordStatusRef.current !== STATUS.RECORDING) return;

    (async () => {
      const result = await stopRecording();
      if (result) {
        setFlow(FLOW.REVIEW);
      } else {
        setRecordStatus(STATUS.IDLE);
        recordStatusRef.current = STATUS.IDLE;
      }
    })();
  };

  const onSlidingStart = useCallback(() => {
    setIsSliding(true);
  }, []);

  const onSlidingComplete = useCallback(
    async (value: number) => {
      setIsSliding(false);
      setSliderMillis(value);
      const s = soundRef.current;
      if (!s || !isLoaded) return;
      try {
        await s.setPositionAsync(value);
      } catch {}
    },
    [isLoaded],
  );

  const togglePlay = useCallback(async () => {
    const s = soundRef.current;
    if (!s || !isLoaded) return;

    try {
      if (isPlaying) {
        await s.pauseAsync();
        setIsPlaying(false);
      } else {
        if (durationMillis > 0 && positionMillis >= durationMillis - 250) {
          await s.setPositionAsync(0);
        }
        await s.playAsync();
        setIsPlaying(true);
      }
    } catch {}
  }, [durationMillis, isLoaded, isPlaying, positionMillis]);

  const openProjectModal = useCallback(async () => {
    const s = soundRef.current;
    if (s && isPlaying) {
      try {
        await s.pauseAsync();
      } catch {}
    }
    setIsPlaying(false);
    setIsProjectModalVisible(true);
  }, [isPlaying]);

  const closeProjectModal = useCallback(() => {
    setIsProjectModalVisible(false);
  }, []);

  const saveProject = useCallback(() => {
    const baseDate = lastRecordedAtMs ? new Date(lastRecordedAtMs) : new Date();
    const fallbackName = `${baseDate.getFullYear()}/${baseDate.getMonth() + 1}/${baseDate.getDate()}`;
    const normalized = projectName.trim() || fallbackName;
    setSavedProjectName(normalized);
    setIsProjectModalVisible(false);
    setIsSaveComplete(true);
  }, [lastRecordedAtMs, projectName]);

  const saveProjectAndBack = useCallback(async () => {
    await unloadSound();
    setIsProjectModalVisible(false);
    setFlow(FLOW.RECORD);
    setRecordStatus(STATUS.IDLE);
    setElapsedMs(0);
    setIsSaveComplete(false);
    setProjectName("");
    router.back();
  }, [router, unloadSound]);

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isSaveComplete) {
      saveReveal.stopAnimation();
      saveReveal.setValue(0);
      return;
    }

    saveReveal.setValue(0);
    Animated.timing(saveReveal, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isSaveComplete, saveReveal]);

  useEffect(() => {
    Animated.spring(flowProgress, {
      toValue: flow === FLOW.REVIEW ? 1 : 0,
      useNativeDriver: true,
      speed: 18,
      bounciness: 7,
    }).start();
  }, [flow, flowProgress]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      const current = new Date();
      setNow(current);
      const nextMidnight = new Date(current);
      nextMidnight.setHours(24, 0, 0, 0);
      timeout = setTimeout(schedule, nextMidnight.getTime() - current.getTime() + 10);
    };

    schedule();

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (recordedDateKey && recordedDateKey !== todayKey) {
      setRecordedDateKey(null);
      setRecordStatus(STATUS.IDLE);
      recordStatusRef.current = STATUS.IDLE;
      setElapsedMs(0);
    }
  }, [recordedDateKey, todayKey]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (flow !== FLOW.REVIEW || !lastRecordedUri) {
        await unloadSound();
        return;
      }

      try {
        const created = await Audio.Sound.createAsync(
          { uri: lastRecordedUri },
          { shouldPlay: false, progressUpdateIntervalMillis: 200 },
          onPlaybackStatusUpdate,
        );

        if (!mounted) {
          await created.sound.unloadAsync();
          return;
        }

        soundRef.current = created.sound;
      } catch (error) {
        console.warn("Audio load failed:", error);
      }
    };

    load();

    return () => {
      mounted = false;
      unloadSound().catch(() => {});
    };
  }, [flow, lastRecordedUri, onPlaybackStatusUpdate, unloadSound]);

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
      const clamped = Math.min(elapsed, MAX_RECORDING_MS);
      setElapsedMs(clamped);

      if (elapsed >= MAX_RECORDING_MS && !autoStoppingRef.current) {
        autoStoppingRef.current = true;
        (async () => {
          const result = await stopRecording();
          if (result) setFlow(FLOW.REVIEW);
          autoStoppingRef.current = false;
        })();
      }
    }, TIMER_INTERVAL_MS);

    return () => clearTimer();
  }, [isRecording, stopRecording]);

  useEffect(() => {
    return () => {
      clearTimer();
      const recording = recordingRef.current;
      recordingRef.current = null;
      if (recording) {
        recording.stopAndUnloadAsync().catch(() => {});
      }
      unloadSound().catch(() => {});
    };
  }, [unloadSound]);

  const currentSliderValue = isSliding ? sliderMillis : positionMillis;
  const timeLabel = useMemo(() => formatMillis(currentSliderValue), [currentSliderValue]);
  const thumbLeft = useMemo(() => {
    if (sliderWidth <= 0 || durationMillis <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, currentSliderValue / durationMillis));
    return ratio * sliderWidth;
  }, [currentSliderValue, durationMillis, sliderWidth]);

  const deliveryDateText = useMemo(() => {
    const baseDate = lastRecordedAtMs ? new Date(lastRecordedAtMs) : new Date();
    const deliveryDate = new Date(baseDate);
    deliveryDate.setFullYear(deliveryDate.getFullYear() + 1);
    return `${deliveryDate.getFullYear()}年${deliveryDate.getMonth() + 1}月${deliveryDate.getDate()}日`;
  }, [lastRecordedAtMs]);

  const recordViewStyle = {
    opacity: flowProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [
      {
        translateX: flowProgress.interpolate({ inputRange: [0, 1], outputRange: [0, -24] }),
      },
    ],
  };

  const reviewViewStyle = {
    opacity: flowProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
    transform: [
      {
        translateX: flowProgress.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }),
      },
    ],
  };

  const guideText =
    flow === FLOW.REVIEW
      ? ""
      : isLockedToday
        ? "本日の録音は完了しています。\n1年後の自分に届くまで、楽しみにしていてね。"
        : "長押しして録音を開始します。";

  return (
    <ImageBackground
      source={require("../../assets/images/home.png")}
      resizeMode="cover"
      style={styles.background}
      imageStyle={{ opacity: 1 }}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <View
            pointerEvents={isProjectModalVisible || isSaveComplete ? "none" : "auto"}
            style={styles.screenContent}
          >
            <View style={styles.topArea}>
              <View style={styles.toolbarWrapper}>
                <View style={styles.toolbarPng}>
                  <Image
                    source={require("../../assets/images/Switch_base.png")}
                    style={styles.toolbarBase}
                    resizeMode="contain"
                  />
                  <Animated.Image
                    source={require("../../assets/images/Segmented_active.png")}
                    style={[styles.toolbarPill, { transform: [{ translateX: 0 }] }]}
                    resizeMode="contain"
                  />

                  <Pressable style={styles.hitLeft} onPress={() => {}} />
                  <Pressable style={styles.hitRight} disabled />

                  <View style={styles.toolbarTextRow} pointerEvents="none">
                    <Text style={[styles.toolbarText, styles.toolbarTextRec, styles.toolbarTextOn]}>rec</Text>
                    <Text style={[styles.toolbarText, styles.toolbarTextArchive]}>archive</Text>
                  </View>
                </View>
              </View>

              <Text style={styles.dateText}>{formatDisplayDate(now)}</Text>
            </View>

            <View style={styles.centerArea}>
              <Animated.View
                pointerEvents={flow === FLOW.RECORD ? "auto" : "none"}
                style={[styles.flowLayer, recordViewStyle]}
              >
                <View style={[styles.recordGroup, { marginTop: RECORD_BUTTON_OFFSET_Y }]}>
                  <Animated.View
                    style={[
                      styles.buttonWrap,
                      isRecording && styles.recordingGlow,
                      { transform: [{ scale: pulse }] },
                    ]}
                  >
                    <Pressable
                      style={styles.buttonPressable}
                      onPressIn={startRecording}
                      onPressOut={handleRecordPressOut}
                      pressRetentionOffset={{ top: 10000, left: 10000, right: 10000, bottom: 10000 }}
                      hitSlop={12}
                      disabled={isLockedToday}
                    >
                      <Image
                        source={require("../../assets/images/home_voiceButton.png")}
                        style={[styles.voiceButton, isLockedToday && styles.voiceButtonDisabled]}
                        resizeMode="contain"
                      />
                    </Pressable>
                  </Animated.View>
                  <Text style={styles.recordTimeText}>{formatMillis(elapsedMs)}</Text>
                </View>
              </Animated.View>

              <Animated.View
                pointerEvents={flow === FLOW.REVIEW ? "auto" : "none"}
                style={[styles.flowLayer, reviewViewStyle]}
              >
                <View style={[styles.playerGroup, { marginTop: REVIEW_BUTTON_OFFSET_Y }]}>
                  <Pressable
                    onPress={togglePlay}
                    style={[styles.playerButton, !isLoaded && styles.disabled]}
                    disabled={!isLoaded}
                  >
                    <Image
                      source={
                        isPlaying
                          ? require("../../assets/images/stopButton.png")
                          : require("../../assets/images/saiseiButton.png")
                      }
                      style={styles.playerImage}
                      resizeMode="contain"
                    />
                  </Pressable>
                </View>
              </Animated.View>
            </View>

            <View style={styles.bottomArea}>
              {flow === FLOW.REVIEW ? (
                <View style={styles.progressRow}>
                  <Text style={styles.timeText}>{timeLabel}</Text>

                  <View style={styles.sliderWrap} onLayout={(e) => setSliderWidth(e.nativeEvent.layout.width)}>
                    <Slider
                      value={currentSliderValue}
                      minimumValue={0}
                      maximumValue={Math.max(durationMillis, 1)}
                      onSlidingStart={onSlidingStart}
                      onValueChange={setSliderMillis}
                      onSlidingComplete={onSlidingComplete}
                      minimumTrackTintColor="#a7a2ae"
                      maximumTrackTintColor="rgba(207, 200, 214, 0.9)"
                      thumbTintColor="transparent"
                      thumbImage={TRANSPARENT_THUMB}
                      disabled={!isLoaded}
                      style={styles.slider}
                    />
                    <View
                      pointerEvents="none"
                      style={[
                        styles.customThumb,
                        {
                          left: Math.max(0, Math.min(sliderWidth - 10, thumbLeft - 5)),
                        },
                      ]}
                    />
                  </View>
                </View>
              ) : null}

              {flow === FLOW.REVIEW ? (
                <Pressable style={styles.okButton} onPress={isSaveComplete ? saveProjectAndBack : openProjectModal}>
                  <Text style={styles.okText}>O K</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {flow === FLOW.RECORD ? <Text style={styles.recordGuideText}>{guideText}</Text> : null}

          {(isProjectModalVisible || isSaveComplete) && <View style={styles.dimLayer} />}

          {isSaveComplete && (
            <Pressable style={styles.savedOverlayRoot} onPress={saveProjectAndBack}>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.savedMessageWrap,
                  {
                    opacity: saveReveal.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 0, 1] }),
                    transform: [
                      {
                        translateY: saveReveal.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }),
                      },
                    ],
                  },
                ]}
              >
                <Animated.Text
                  style={[
                    styles.savedTitle,
                    zenAntiqueSoftLoaded && styles.saveCompleteZenFont,
                    {
                      opacity: saveReveal.interpolate({ inputRange: [0, 0.2, 0.85], outputRange: [0, 0, 1] }),
                      transform: [
                        {
                          translateY: saveReveal.interpolate({ inputRange: [0, 0.2, 1], outputRange: [24, 24, 0] }),
                        },
                      ],
                    },
                  ]}
                >
                  {savedProjectName}
                </Animated.Text>
                <Animated.Text
                  style={[
                    styles.savedSubText,
                    zenAntiqueSoftLoaded && styles.saveCompleteZenFont,
                    {
                      opacity: saveReveal.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0, 1] }),
                      transform: [
                        {
                          translateY: saveReveal.interpolate({ inputRange: [0, 0.4, 1], outputRange: [18, 18, 0] }),
                        },
                      ],
                    },
                  ]}
                >
                  を保管しました。
                </Animated.Text>
              </Animated.View>

              <Animated.View
                pointerEvents="none"
                style={[
                  styles.savedBottomRow,
                  {
                    opacity: saveReveal.interpolate({ inputRange: [0, 0.58, 1], outputRange: [0, 0, 1] }),
                    transform: [
                      {
                        translateY: saveReveal.interpolate({ inputRange: [0, 0.58, 1], outputRange: [14, 14, 0] }),
                      },
                    ],
                  },
                ]}
              >
                <Text style={[styles.deliveryText, zenAntiqueSoftLoaded && styles.saveCompleteZenFont]}>
                  <Text style={styles.deliveryDateText}>{deliveryDateText}</Text>
                  {" のあなたに届きます"}
                </Text>
              </Animated.View>
            </Pressable>
          )}

          <Modal
            visible={isProjectModalVisible}
            transparent
            animationType="fade"
            onRequestClose={closeProjectModal}
          >
            <View style={styles.modalRoot}>
              <Pressable style={styles.modalBackdropPressArea} onPress={closeProjectModal} />
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>プロジェクト名</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    value={projectName}
                    onChangeText={setProjectName}
                    placeholder="YYYY/MM/DD"
                    placeholderTextColor="#cbc6ce"
                    style={styles.modalInput}
                  />
                </View>

                <View style={styles.modalActions}>
                  <Pressable style={styles.modalButton} onPress={closeProjectModal}>
                    <Text style={styles.cancelText}>キャンセル</Text>
                  </Pressable>
                  <View style={styles.modalDivider} />
                  <Pressable style={styles.modalButton} onPress={saveProject}>
                    <Text style={styles.saveText}>保存</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
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
    paddingHorizontal: 24,
  },
  screenContent: {
    flex: 1,
    width: "100%",
    alignItems: "center",
  },
  topArea: { width: "100%", alignItems: "center", paddingTop: 26 },

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
  toolbarTextRec: { transform: [{ translateX: 6 }] },
  toolbarTextArchive: { transform: [{ translateX: -6 }] },
  toolbarTextOn: { color: "rgba(255,255,255,0.85)" },

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
  flowLayer: {
    position: "absolute",
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
  voiceButtonDisabled: { tintColor: "#b8b8bc", opacity: 0.9 },
  recordTimeText: {
    marginTop: 20,
    fontSize: 12,
    fontWeight: "600",
    color: "#767680",
    letterSpacing: 0.2,
  },
  recordingGlow: {
    shadowColor: "#60a8ec",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },

  playerGroup: {
    alignItems: "center",
    justifyContent: "center",
  },
  playerButton: {
    width: 176,
    height: 176,
    alignItems: "center",
    justifyContent: "center",
  },
  playerImage: {
    width: VOICE_BUTTON_SIZE,
    height: VOICE_BUTTON_SIZE,
  },
  disabled: { opacity: 0.5 },

  bottomArea: { width: "100%", paddingBottom: 70 },
  progressRow: { flexDirection: "row", alignItems: "center", marginBottom: 60 },
  timeText: {
    width: 42,
    fontSize: 7.5,
    color: "#9a95a2",
    letterSpacing: 0.8,
    marginLeft: 40,
  },
  sliderWrap: {
    width: "60%",
    marginLeft: -3,
    height: 24,
    justifyContent: "center",
  },
  slider: {
    width: "100%",
    height: 24,
    zIndex: 1,
  },
  customThumb: {
    position: "absolute",
    top: 7,
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(188, 182, 194, 0.63)",
    zIndex: 3,
    elevation: 3,
  },

  okButton: {
    alignSelf: "center",
    width: 285,
    height: 53,
    borderRadius: 28,
    backgroundColor: "rgba(176, 163, 179, 0.58)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#6f6878",
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  okText: {
    color: "#f6f5f7",
    fontSize: 16,
    letterSpacing: 8,
    fontWeight: "500",
    marginLeft: 10,
  },

  recordGuideText: {
    position: "absolute",
    bottom: 84,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: "#767680",
    letterSpacing: 0.2,
    lineHeight: 24,
  },

  dimLayer: {
    position: "absolute",
    left: -40,
    right: -40,
    top: -120,
    bottom: -120,
    backgroundColor: "rgba(209, 209, 209, 0.32)",
  },
  savedOverlayRoot: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 50,
    elevation: 50,
  },
  savedMessageWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 5,
    zIndex: 51,
    elevation: 51,
  },
  savedTitle: {
    color: "#17171a",
    fontSize: 36,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  savedSubText: {
    marginTop: 40,
    color: "#17171a",
    fontSize: 18,
    fontWeight: "700",
  },
  savedBottomRow: {
    position: "absolute",
    bottom: 175,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 51,
    elevation: 51,
  },
  deliveryText: {
    color: "#17171a",
    fontSize: 18,
    fontWeight: "700",
    marginLeft: 15,
  },
  deliveryDateText: {
    fontWeight: "900",
  },
  saveCompleteZenFont: {
    fontFamily: "ZenAntiqueSoft_400Regular",
  },

  modalRoot: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  modalBackdropPressArea: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    width: 330,
    height: 200,
    borderRadius: 32,
    backgroundColor: "rgba(132, 133, 139, 0.82)",
    overflow: "hidden",
  },
  modalTitle: {
    marginTop: 38,
    textAlign: "center",
    color: "#f2f2f4",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 1.1,
  },
  inputWrap: {
    marginTop: 18,
    marginHorizontal: 34,
    marginBottom: 30,
    borderRadius: 14,
    backgroundColor: "rgba(201, 201, 206, 0.55)",
    paddingHorizontal: 18,
    justifyContent: "center",
    height: 40,
    width: 263,
  },
  modalInput: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 0.6,
  },
  modalActions: {
    height: 70,
    borderTopWidth: 1,
    borderTopColor: "rgba(245, 245, 248, 0.68)",
    flexDirection: "row",
    alignItems: "center",
  },
  modalButton: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  modalDivider: {
    width: 1,
    height: "100%",
    backgroundColor: "rgba(245, 245, 248, 0.68)",
  },
  cancelText: {
    color: "rgb(237, 7, 7)",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.2,
    marginTop: -15,
  },
  saveText: {
    color: "#f4f4f6",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.3,
    marginTop: -15,
  },
});