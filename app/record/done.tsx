import { Audio, AVPlaybackStatus } from "expo-av";
import { useLocalSearchParams, useRouter } from "expo-router";
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
  TextInput,
  Text,
  View,
} from "react-native";

const DISPLAY_DATE = "2026/1/31 Sat";
const TRANSPARENT_THUMB = {
  uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6p8N8AAAAASUVORK5CYII=",
};
const VOICE_BUTTON_SIZE = 140;
const VOICE_BUTTON_OFFSET_Y = -10;
const TOOLBAR_WIDTH = 204;
const TOOLBAR_HEIGHT = 44;
const PILL_WIDTH = TOOLBAR_WIDTH / 2;

function formatMillis(millis: number): string {
  const safe = Number.isFinite(millis) && millis > 0 ? millis : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function RecordDoneScreen() {
  const router = useRouter();
  const { uri, recordedAtMs } = useLocalSearchParams<{
    uri?: string;
    recordedAtMs?: string;
  }>();
  const [zenAntiqueSoftLoaded] = useFonts({
    ZenAntiqueSoft_400Regular,
  });

  const soundRef = useRef<Audio.Sound | null>(null);

  const [segment, setSegment] = useState<"rec" | "archive">("archive");
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
  const saveReveal = useRef(new Animated.Value(0)).current;

  const playableUri =
    typeof uri === "string" && uri.length > 0 ? uri : undefined;
  const activeX = useRef(new Animated.Value(0)).current;

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
      if (!isSliding) {
        setSliderMillis(status.positionMillis ?? 0);
      }
    },
    [isSliding],
  );

  useEffect(() => {
    Animated.spring(activeX, {
      toValue: segment === "rec" ? 0 : PILL_WIDTH,
      useNativeDriver: true,
      speed: 18,
      bounciness: 6,
    }).start();
  }, [activeX, segment]);

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
    let mounted = true;

    const loadSound = async () => {
      if (!playableUri) return;

      try {
        const created = await Audio.Sound.createAsync(
          { uri: playableUri },
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

    loadSound();

    return () => {
      mounted = false;
      const s = soundRef.current;
      soundRef.current = null;
      if (s) {
        s.unloadAsync().catch(() => {});
      }
    };
  }, [onPlaybackStatusUpdate, playableUri]);

  const canControlPlayback = isLoaded && !!soundRef.current && !!playableUri;
  const canTogglePlayback = canControlPlayback || !playableUri;

  const togglePlay = useCallback(async () => {
    const s = soundRef.current;
    if (!playableUri) {
      setIsPlaying((prev) => !prev);
      return;
    }
    if (!s || !canControlPlayback) return;

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
    } catch (error) {
      console.warn("Audio toggle failed:", error);
    }
  }, [
    canControlPlayback,
    durationMillis,
    isPlaying,
    playableUri,
    positionMillis,
  ]);

  const onSlidingStart = useCallback(() => {
    setIsSliding(true);
  }, []);

  const onSlidingComplete = useCallback(
    async (value: number) => {
      setIsSliding(false);
      setSliderMillis(value);
      const s = soundRef.current;
      if (!s || !canControlPlayback) return;
      try {
        await s.setPositionAsync(value);
      } catch (error) {
        console.warn("Seek failed:", error);
      }
    },
    [canControlPlayback],
  );

  const currentSliderValue = isSliding ? sliderMillis : positionMillis;
  const timeLabel = useMemo(
    () => formatMillis(currentSliderValue),
    [currentSliderValue],
  );
  const thumbLeft = useMemo(() => {
    if (sliderWidth <= 0 || durationMillis <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, currentSliderValue / durationMillis));
    return ratio * sliderWidth;
  }, [currentSliderValue, durationMillis, sliderWidth]);

  const deliveryDateText = useMemo(() => {
    const parsed =
      typeof recordedAtMs === "string" ? Number(recordedAtMs) : NaN;
    const baseDate =
      Number.isFinite(parsed) && parsed > 0 ? new Date(parsed) : new Date();
    const deliveryDate = new Date(baseDate);
    deliveryDate.setFullYear(deliveryDate.getFullYear() + 1);
    return `${deliveryDate.getFullYear()}年${deliveryDate.getMonth() + 1}月${deliveryDate.getDate()}日`;
  }, [recordedAtMs]);

  const openProjectModal = useCallback(async () => {
    try {
      const s = soundRef.current;
      if (s && isPlaying) {
        await s.pauseAsync();
      }
      setIsPlaying(false);
    } catch {}
    setIsProjectModalVisible(true);
  }, [isPlaying]);

  const saveProjectAndBack = useCallback(async () => {
    try {
      const s = soundRef.current;
      if (s) {
        await s.stopAsync();
        await s.unloadAsync();
        soundRef.current = null;
      }
    } catch {}
    setIsProjectModalVisible(false);
    router.back();
  }, [router]);

  const closeProjectModal = useCallback(() => {
    setIsProjectModalVisible(false);
  }, []);

  const saveProject = useCallback(() => {
    const parsed =
      typeof recordedAtMs === "string" ? Number(recordedAtMs) : NaN;
    const baseDate =
      Number.isFinite(parsed) && parsed > 0 ? new Date(parsed) : new Date();
    const fallbackName = `${baseDate.getFullYear()}/${baseDate.getMonth() + 1}/${baseDate.getDate()}`;
    const normalized = projectName.trim() || fallbackName;
    setSavedProjectName(normalized);
    setIsProjectModalVisible(false);
    setIsSaveComplete(true);
  }, [projectName, recordedAtMs]);

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
            pointerEvents={
              isProjectModalVisible || isSaveComplete ? "none" : "auto"
            }
            style={styles.screenContent}
          >
            <View style={styles.topArea}>
              <Pressable
                onPress={() => router.push("/record")}
                style={styles.backArea}
              >
                <Text style={styles.backLabel}>撮り直し</Text>
                <Text style={styles.backArrow}>←</Text>
              </Pressable>

              <View style={styles.toolbarWrapper}>
                <View style={styles.toolbarPng}>
                  <Image
                    source={require("../../assets/images/Switch_base.png")}
                    style={styles.toolbarBase}
                    resizeMode="contain"
                  />
                  <Animated.Image
                    source={require("../../assets/images/Segmented_active.png")}
                    style={[
                      styles.toolbarPill,
                      { transform: [{ translateX: activeX }] },
                    ]}
                    resizeMode="contain"
                  />

                  <Pressable
                    style={styles.hitLeft}
                    onPress={() => {
                      setSegment("rec");
                      router.push("/record");
                    }}
                  />
                  <Pressable
                    style={styles.hitRight}
                    onPress={() => setSegment("archive")}
                  />

                  <View style={styles.toolbarTextRow} pointerEvents="none">
                    <Text
                      style={[
                        styles.toolbarText,
                        styles.toolbarTextRec,
                        segment === "rec" && styles.toolbarTextOn,
                      ]}
                    >
                      rec
                    </Text>
                    <Text
                      style={[
                        styles.toolbarText,
                        styles.toolbarTextArchive,
                        segment === "archive" && styles.toolbarTextOn,
                      ]}
                    >
                      archive
                    </Text>
                  </View>
                </View>
              </View>

              <Text style={styles.dateText}>{DISPLAY_DATE}</Text>
            </View>

            <View style={styles.centerArea}>
              {false ? (
                <View style={styles.savedMessageWrap}>
                  <Text
                    style={[
                      styles.savedTitle,
                      zenAntiqueSoftLoaded && styles.saveCompleteZenFont,
                    ]}
                  >
                    {savedProjectName}
                  </Text>
                  <Text
                    style={[
                      styles.savedSubText,
                      zenAntiqueSoftLoaded && styles.saveCompleteZenFont,
                    ]}
                  >
                    を保管しました
                  </Text>
                </View>
              ) : (
                <View
                  style={[
                    styles.playerGroup,
                    { marginTop: VOICE_BUTTON_OFFSET_Y },
                  ]}
                >
                  <Pressable
                    onPress={togglePlay}
                    style={[
                      styles.playerButton,
                      !canTogglePlayback && styles.disabled,
                    ]}
                    disabled={!canTogglePlayback}
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
              )}
            </View>

            <View style={styles.bottomArea}>
              {false ? (
                <View style={styles.savedBottomRow}>
                  <Text style={styles.timeText}>00:00</Text>
                  <Text
                    style={[
                      styles.deliveryText,
                      zenAntiqueSoftLoaded && styles.saveCompleteZenFont,
                    ]}
                  >
                    <Text style={styles.deliveryDateText}>
                      {deliveryDateText}
                    </Text>
                    のあなたに届きます。
                  </Text>
                </View>
              ) : (
                <View style={styles.progressRow}>
                  <Text style={styles.timeText}>{timeLabel}</Text>

                  <View
                    style={styles.sliderWrap}
                    onLayout={(e) => setSliderWidth(e.nativeEvent.layout.width)}
                  >
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
                      disabled={!canControlPlayback}
                      style={styles.slider}
                    />
                    <View
                      pointerEvents="none"
                      style={[
                        styles.customThumb,
                        {
                          left: Math.max(
                            0,
                            Math.min(sliderWidth - 10, thumbLeft - 5),
                          ),
                        },
                      ]}
                    />
                  </View>
                </View>
              )}

              <Pressable
                style={styles.okButton}
                onPress={isSaveComplete ? saveProjectAndBack : openProjectModal}
              >
                <Text style={styles.okText}>O K</Text>
              </Pressable>
            </View>
          </View>

          {(isProjectModalVisible || isSaveComplete) && (
            <View style={styles.dimLayer} />
          )}

          {isSaveComplete && (
            <Pressable
              style={styles.savedOverlayRoot}
              onPress={saveProjectAndBack}
            >
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.savedMessageWrap,
                  {
                    opacity: saveReveal.interpolate({
                      inputRange: [0, 0.35, 1],
                      outputRange: [0, 0, 1],
                    }),
                    transform: [
                      {
                        translateY: saveReveal.interpolate({
                          inputRange: [0, 1],
                          outputRange: [18, 0],
                        }),
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
                      opacity: saveReveal.interpolate({
                        inputRange: [0, 0.2, 0.85],
                        outputRange: [0, 0, 1],
                      }),
                      transform: [
                        {
                          translateY: saveReveal.interpolate({
                            inputRange: [0, 0.2, 1],
                            outputRange: [24, 24, 0],
                          }),
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
                      opacity: saveReveal.interpolate({
                        inputRange: [0, 0.4, 1],
                        outputRange: [0, 0, 1],
                      }),
                      transform: [
                        {
                          translateY: saveReveal.interpolate({
                            inputRange: [0, 0.4, 1],
                            outputRange: [18, 18, 0],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  を保管しました
                </Animated.Text>
              </Animated.View>

              <Animated.View
                pointerEvents="none"
                style={[
                  styles.savedBottomRow,
                  {
                    opacity: saveReveal.interpolate({
                      inputRange: [0, 0.58, 1],
                      outputRange: [0, 0, 1],
                    }),
                    transform: [
                      {
                        translateY: saveReveal.interpolate({
                          inputRange: [0, 0.58, 1],
                          outputRange: [14, 14, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <Text
                  style={[
                    styles.deliveryText,
                    zenAntiqueSoftLoaded && styles.saveCompleteZenFont,
                  ]}
                >
                  <Text style={styles.deliveryDateText}>
                    {deliveryDateText}
                  </Text>
                  のあなたに届きます。
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
              <Pressable
                style={styles.modalBackdropPressArea}
                onPress={closeProjectModal}
              />
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>プロジェクト名</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    value={projectName}
                    onChangeText={setProjectName}
                    placeholder="XXXX/XX/XX"
                    placeholderTextColor="#cbc6ce"
                    style={styles.modalInput}
                  />
                </View>

                <View style={styles.modalActions}>
                  <Pressable
                    style={styles.modalButton}
                    onPress={closeProjectModal}
                  >
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
  backArea: {
    position: "absolute",
    top: 2,
    left: 4,
    paddingVertical: 8,
    paddingRight: 12,
    zIndex: 10,
  },
  backLabel: {
    fontSize: 12,
    color: "#4a4951",
    marginBottom: 2,
    fontWeight: "400",
  },
  backArrow: { fontSize: 31, lineHeight: 34, color: "#26252b", marginTop: -2 },

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
  playerGroup: {
    alignItems: "center",
    justifyContent: "center",
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
  saveCompleteZenFont: {
    fontFamily: "ZenAntiqueSoft_400Regular",
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

  seekRow: {
    marginTop: 18,
    flexDirection: "row",
    gap: 12,
  },
  seekBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  seekText: { color: "#3a3840", fontSize: 12, fontWeight: "500" },

  bottomArea: { width: "100%", paddingBottom: 70 },
  progressRow: { flexDirection: "row", alignItems: "center", marginBottom: 60 },
  savedBottomRow: {
    position: "absolute",
    bottom: 175,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 51,
    elevation: 51,
  },
  timeText: {
    width: 42,
    fontSize: 7.5,
    color: "#9a95a2",
    letterSpacing: 0.8,
    marginLeft: 40,
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
    shadowColor: "#0e0e0f",
    shadowOffset: { width: 7, height: 7 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  dimLayer: {
    position: "absolute",
    left: -40,
    right: -40,
    top: -120,
    bottom: -120,
    backgroundColor: "rgba(209, 209, 209, 0.32)",
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
