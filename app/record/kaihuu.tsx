import ArchiveContent from "@/components/ArchiveContent";
import RecordToolbar from "@/components/RecordToolbar";
import { loadCapsules } from "@/src/capsules/storage";
import { useFocusEffect } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Slider from "@react-native-community/slider";
import {
  createAudioPlayer,
  setIsAudioActiveAsync,
  type AudioPlayer,
  type AudioStatus,
} from "expo-audio";
import { ZenAntiqueSoft_400Regular } from "@expo-google-fonts/zen-antique-soft";
import { useFonts } from "expo-font";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  Animated,
  Image,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TRANSPARENT_THUMB = {
  uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6p8N8AAAAASUVORK5CYII=",
};
const MOCK_DURATION_MS = 60000;
const INITIAL_SLIDE_WIDTH = 360;
const NOREC_BUTTON_NUDGE_Y = -20;
const REC_BUTTON_ALIGN_OFFSET_Y = -5;
const RECORDED_DATE_STORAGE_KEY = "recordedDateKey";
const TAB_SWIPE_THRESHOLD = 28;

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
  return `${String(minutes).padStart(2, "0")} : ${String(seconds).padStart(2, "0")}`;
}

export default function KaihuuScreen() {
  const params = useLocalSearchParams<{
    capsuleId?: string;
    transcriptId?: string;
    fromUnlockNotice?: string;
  }>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscapeViewport = windowWidth > windowHeight;
  useFonts({
    YDWbananaslipplus: require("../../assets/fonts/YDWbananaslipplus.otf"),
    ZenAntiqueSoft_400Regular,
  });
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"rec" | "archive">("archive");
  const [toolbarTab, setToolbarTab] = useState<"rec" | "archive">("archive");
  const [showMainArchive, setShowMainArchive] = useState(false);
  const [archiveSettledToMain, setArchiveSettledToMain] = useState(false);
  const [hasUnopenedInArchive, setHasUnopenedInArchive] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const [sliderMillis, setSliderMillis] = useState(0);
  const [sliderWidth, setSliderWidth] = useState(0);
  const [durationMillis, setDurationMillis] = useState(MOCK_DURATION_MS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [selectedCapsuleAudioUri, setSelectedCapsuleAudioUri] = useState<
    string | null
  >(null);
  const [isSelectedCapsuleLocked, setIsSelectedCapsuleLocked] = useState(false);
  const [slideWidth, setSlideWidth] = useState(INITIAL_SLIDE_WIDTH);
  const [recordedDateKey, setRecordedDateKey] = useState<string | null>(null);
  const slideX = useRef(new Animated.Value(-INITIAL_SLIDE_WIDTH)).current;
  const soundRef = useRef<AudioPlayer | null>(null);
  const playbackSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const capsuleId = useMemo(() => {
    if (typeof params.capsuleId === "string" && params.capsuleId.length > 0) {
      return params.capsuleId;
    }
    if (
      typeof params.transcriptId === "string" &&
      params.transcriptId.length > 0
    ) {
      return params.transcriptId;
    }
    return "";
  }, [params.capsuleId, params.transcriptId]);

  const loadRecordedDateKey = useCallback(async () => {
    try {
      const saved = await AsyncStorage.getItem(RECORDED_DATE_STORAGE_KEY);
      setRecordedDateKey(saved);
    } catch {}
  }, []);

  const refreshUnopenedBadge = useCallback(async () => {
    const nowMs = Date.now();
    const list = await loadCapsules();
    setHasUnopenedInArchive(
      list.some((item) => item.openedAtMs === null && nowMs >= item.unlockAtMs),
    );
  }, []);

  useEffect(() => {
    loadRecordedDateKey();
  }, [loadRecordedDateKey]);

  useEffect(() => {
    if (activeTab === "rec") {
      loadRecordedDateKey();
    }
  }, [activeTab, loadRecordedDateKey]);

  useFocusEffect(
    useCallback(() => {
      void refreshUnopenedBadge();
    }, [refreshUnopenedBadge]),
  );

  useEffect(() => {
    void refreshUnopenedBadge();
  }, [refreshUnopenedBadge]);

  const unloadSound = useCallback(async () => {
    playbackSubscriptionRef.current?.remove();
    playbackSubscriptionRef.current = null;
    const current = soundRef.current;
    soundRef.current = null;
    if (current) {
      try {
        current.pause();
      } catch {}
      try {
        current.remove();
      } catch {}
    }
    setIsLoaded(false);
  }, []);

  const onPlaybackStatusUpdate = useCallback(
    (status: AudioStatus) => {
      if (!status.isLoaded) {
        setIsLoaded(false);
        setIsPlaying(false);
        setPositionMillis(0);
        setDurationMillis(MOCK_DURATION_MS);
        if (!isSliding) setSliderMillis(0);
        return;
      }
      setIsLoaded(true);
      setIsPlaying(status.playing);
      const nextPositionMillis = Math.floor((status.currentTime ?? 0) * 1000);
      const nextDurationMillis = Math.floor((status.duration ?? 0) * 1000);
      setPositionMillis(nextPositionMillis);
      setDurationMillis(
        nextDurationMillis > 0 ? nextDurationMillis : MOCK_DURATION_MS,
      );
      if (!isSliding) setSliderMillis(nextPositionMillis);
    },
    [isSliding],
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!capsuleId) {
        setSelectedCapsuleAudioUri(null);
        setDurationMillis(MOCK_DURATION_MS);
        setPositionMillis(0);
        setSliderMillis(0);
        return;
      }
      const list = await loadCapsules();
      if (!mounted) return;
      const capsule = list.find((item) => item.id === capsuleId) ?? null;
      const locked = capsule ? Date.now() < capsule.unlockAtMs : false;
      setIsSelectedCapsuleLocked(locked);
      setSelectedCapsuleAudioUri(!locked ? (capsule?.audioUri ?? null) : null);
      setPositionMillis(0);
      setSliderMillis(0);
      setDurationMillis(
        capsule?.durationSec
          ? Math.max(1, capsule.durationSec) * 1000
          : MOCK_DURATION_MS,
      );
    })();

    return () => {
      mounted = false;
    };
  }, [capsuleId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!selectedCapsuleAudioUri) {
        await unloadSound();
        return;
      }
      try {
        await unloadSound();
        const player = createAudioPlayer(
          { uri: selectedCapsuleAudioUri },
          { updateInterval: 200 },
        );
        const sub = player.addListener(
          "playbackStatusUpdate",
          onPlaybackStatusUpdate,
        );
        if (!mounted) {
          sub.remove();
          player.remove();
          return;
        }
        playbackSubscriptionRef.current = sub;
        soundRef.current = player;
        onPlaybackStatusUpdate(player.currentStatus);
      } catch {
        setIsLoaded(false);
      }
    })();
    return () => {
      mounted = false;
      unloadSound().catch(() => {});
    };
  }, [onPlaybackStatusUpdate, selectedCapsuleAudioUri, unloadSound]);

  useEffect(() => {
    if (selectedCapsuleAudioUri) return;
    if (!isPlaying || isSliding) return;
    const id = setInterval(() => {
      setPositionMillis((prev) => {
        const next = prev + 100;
        if (next >= MOCK_DURATION_MS) {
          setIsPlaying(false);
          return MOCK_DURATION_MS;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [isPlaying, isSliding, selectedCapsuleAudioUri]);

  useEffect(() => {
    slideX.setValue(activeTab === "rec" ? 0 : -slideWidth);
  }, [activeTab, slideWidth, slideX]);

  const currentSliderValue = isSliding ? sliderMillis : positionMillis;
  const timeLabel = useMemo(
    () => formatMillis(currentSliderValue),
    [currentSliderValue],
  );
  const activeDurationMillis = selectedCapsuleAudioUri
    ? Math.max(durationMillis, 1)
    : MOCK_DURATION_MS;
  const thumbLeft = useMemo(() => {
    if (sliderWidth <= 0 || activeDurationMillis <= 0) return 0;
    const ratio = Math.min(
      1,
      Math.max(0, currentSliderValue / activeDurationMillis),
    );
    return ratio * sliderWidth;
  }, [activeDurationMillis, currentSliderValue, sliderWidth]);

  const togglePlay = useCallback(async () => {
    if (capsuleId && isSelectedCapsuleLocked) return;
    if (!selectedCapsuleAudioUri) {
      setIsPlaying((prev) => !prev);
      return;
    }
    const s = soundRef.current;
    if (!s || !isLoaded) return;
    try {
      if (isPlaying) {
        s.pause();
      } else {
        if (durationMillis > 0 && positionMillis >= durationMillis - 250) {
          await s.seekTo(0);
        }
        s.play();
      }
    } catch {}
  }, [
    capsuleId,
    durationMillis,
    isLoaded,
    isPlaying,
    isSelectedCapsuleLocked,
    positionMillis,
    selectedCapsuleAudioUri,
  ]);

  const todayKey = toDateKey(new Date());
  // 1日1回の録音制限は現在無効。rec 画面側（rec.tsx）でも無効にしてあり、
  // 有効/無効が画面ごとにずれると仕様が矛盾するのでここで揃えている。
  // 制限を復活させるときは両方を戻すこと。
  const isLockedToday = false;
  const recGuideText = "録音ボタンを押して録音しましょう";


  const switchToRecTab = useCallback(() => {
    setToolbarTab("rec");
    setActiveTab("rec");
  }, []);

  const switchToArchiveTab = useCallback(
    (wasArchiveTab: boolean) => {
      setToolbarTab("archive");
      setActiveTab("archive");
      if (wasArchiveTab) {
        setShowMainArchive(true);
        setArchiveSettledToMain(true);
        return;
      }
      setShowMainArchive(archiveSettledToMain);
    },
    [archiveSettledToMain],
  );

  const panResponder = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-18, 18])
        .failOffsetY([-24, 24])
        .minDistance(18)
        .cancelsTouchesInView(false)
        .onEnd((gesture) => {
          const isLeftSwipe =
            gesture.translationX <= -TAB_SWIPE_THRESHOLD ||
            (gesture.velocityX < -220 && gesture.translationX < -8);
          const isRightSwipe =
            gesture.translationX >= TAB_SWIPE_THRESHOLD ||
            (gesture.velocityX > 220 && gesture.translationX > 8);

          if (isLeftSwipe && activeTab === "rec") {
            switchToArchiveTab(false);
            return;
          }
          if (isRightSwipe && activeTab === "archive") {
            switchToRecTab();
          }
        }),
    [activeTab, switchToArchiveTab, switchToRecTab],
  );

  useEffect(() => {
    if (recordedDateKey && recordedDateKey !== todayKey) {
      setRecordedDateKey(null);
      AsyncStorage.removeItem(RECORDED_DATE_STORAGE_KEY).catch(() => {});
    }
  }, [recordedDateKey, todayKey]);

  useEffect(() => {
    setIsAudioActiveAsync(true).catch(() => {});
    return () => {
      unloadSound().catch(() => {});
    };
  }, [unloadSound]);

  if (isLandscapeViewport) {
    return (
      <ImageBackground
        source={
          activeTab === "rec"
            ? isLockedToday
              ? require("../../assets/images/norec_background.png")
              : require("../../assets/images/home.png")
            : showMainArchive
              ? require("../../assets/images/home.png")
              : require("../../assets/images/kaihuu_background.png")
        }
        resizeMode="cover"
        style={styles.background}
      />
    );
  }

  return (
    <ImageBackground
      source={
        activeTab === "rec"
          ? isLockedToday
            ? require("../../assets/images/norec_background.png")
            : require("../../assets/images/home.png")
          : showMainArchive
            ? require("../../assets/images/home.png")
            : require("../../assets/images/kaihuu_background.png")
      }
      resizeMode="cover"
      style={styles.background}
    >
      {activeTab === "archive" && showMainArchive ? (
        <>
          <View pointerEvents="none" style={styles.archiveBackgroundTint} />
          <LinearGradient
            pointerEvents="none"
            colors={[
              "rgba(255, 255, 255, 0.2)",
              "rgba(255, 255, 255, 0.42)",
              "rgba(255, 255, 255, 0.2)",
            ]}
            locations={[0, 0.5, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.archiveGradientVertical}
          />
          <LinearGradient
            pointerEvents="none"
            colors={[
              "rgba(255, 255, 255, 0.14)",
              "rgba(255, 255, 255, 0.28)",
              "rgba(255, 255, 255, 0.14)",
            ]}
            locations={[0, 0.5, 1]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.archiveGradientHorizontal}
          />
        </>
      ) : null}
      <GestureDetector gesture={panResponder}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.container}>
            <View style={styles.topArea}>
              {activeTab !== "rec" && !showMainArchive ? (
                <Pressable
                  onPress={() =>
                    router.replace({
                      pathname: "/cassette",
                      params: {
                        ...(capsuleId ? { capsuleId } : {}),
                        ...(params.fromUnlockNotice === "1"
                          ? { showArrivalIntro: "1" }
                          : {}),
                      },
                    })
                  }
                  hitSlop={8}
                  style={styles.backToCassette}
                >
                  <View style={styles.backToCassetteLabelWrap}>
                    <Text style={styles.backToCassetteText}>
                      カセットモードへ
                    </Text>
                    <View style={styles.backToCassetteUnderline} />
                  </View>
                </Pressable>
              ) : null}

              <RecordToolbar
                active={toolbarTab}
                onPressRec={switchToRecTab}
                onPressArchive={() =>
                  switchToArchiveTab(activeTab === "archive")
                }
                hasUnopenedInArchive={hasUnopenedInArchive}
              />
            </View>

            <View
              style={styles.slideViewport}
              onLayout={(e) => setSlideWidth(e.nativeEvent.layout.width)}
            >
              <Animated.View
                style={[
                  styles.slideTrack,
                  {
                    width: slideWidth * 2,
                    transform: [{ translateX: slideX }],
                  },
                ]}
              >
                <View style={[styles.slidePane, { width: slideWidth }]}>
                  <View style={styles.recTabWrap}>
                    <Text style={styles.dateText}>
                      {formatDisplayDate(new Date())}
                    </Text>
                    <View style={styles.centerArea}>
                      <Pressable
                        style={[
                          styles.recButton,
                          { transform: [{ translateY: REC_BUTTON_ALIGN_OFFSET_Y }] },
                        ]}
                        disabled={isLockedToday}
                      >
                        <Image
                          source={
                            isLockedToday
                              ? require("../../assets/images/norecButton.png")
                              : require("../../assets/images/home_voiceButton.png")
                          }
                          style={[
                            styles.recButtonImage,
                            isLockedToday && styles.recButtonImageDisabled,
                            isLockedToday && {
                              transform: [{ translateY: NOREC_BUTTON_NUDGE_Y }],
                            },
                          ]}
                          resizeMode="contain"
                        />
                      </Pressable>
                    </View>
                    <Text style={styles.recGuideText}>{recGuideText}</Text>
                  </View>
                </View>

                <View style={[styles.slidePane, { width: slideWidth }]}>
                  {showMainArchive ? (
                    <ArchiveContent
                      embedded
                      onPressRec={switchToRecTab}
                    />
                  ) : (
                    <View style={styles.recWrap}>
                      <Text style={styles.dateText}>
                        {formatDisplayDate(new Date())}
                      </Text>

                        <>
                          <View style={styles.centerArea}>
                            <Pressable
                              onPress={() => {
                                void togglePlay();
                              }}
                              style={styles.playerButton}
                              disabled={
                                isSelectedCapsuleLocked ||
                                (!!selectedCapsuleAudioUri && !isLoaded)
                              }
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

                          <View style={styles.bottomArea}>
                            <View style={styles.progressRow}>
                              <Text style={styles.timeText}>{timeLabel}</Text>

                              <View
                                style={styles.sliderWrap}
                                onLayout={(e) =>
                                  setSliderWidth(e.nativeEvent.layout.width)
                                }
                              >
                                <Slider
                                  value={currentSliderValue}
                                  minimumValue={0}
                                  maximumValue={activeDurationMillis}
                                  onSlidingStart={() => setIsSliding(true)}
                                  onValueChange={setSliderMillis}
                                  onSlidingComplete={async (value) => {
                                    if (capsuleId && isSelectedCapsuleLocked)
                                      return;
                                    setIsSliding(false);
                                    setSliderMillis(value);
                                    if (selectedCapsuleAudioUri) {
                                      const s = soundRef.current;
                                      if (!s || !isLoaded) return;
                                      try {
                                        await s.seekTo(value / 1000);
                                      } catch {}
                                    } else {
                                      setPositionMillis(value);
                                    }
                                  }}
                                  tapToSeek
                                  minimumTrackTintColor="#a7a2ae"
                                  maximumTrackTintColor="rgba(207, 200, 214, 0.9)"
                                  thumbTintColor="transparent"
                                  thumbImage={TRANSPARENT_THUMB}
                                  style={styles.slider}
                                  disabled={
                                    isSelectedCapsuleLocked ||
                                    (!!selectedCapsuleAudioUri && !isLoaded)
                                  }
                                />
                                <View
                                  pointerEvents="none"
                                  style={[
                                    styles.customThumb,
                                    {
                                      left: Math.max(
                                        0,
                                        Math.min(
                                          sliderWidth - 10,
                                          thumbLeft - 5,
                                        ),
                                      ),
                                    },
                                  ]}
                                />
                              </View>
                            </View>

                          </View>
                        </>
                    </View>
                  )}
                </View>
              </Animated.View>
            </View>
          </View>
        </SafeAreaView>
      </GestureDetector>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: "#000" },
  archiveBackgroundTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(197, 219, 204, 0.42)",
  },
  archiveGradientVertical: {
    ...StyleSheet.absoluteFillObject,
  },
  archiveGradientHorizontal: {
    ...StyleSheet.absoluteFillObject,
  },
  safeArea: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 24 },
  topArea: { paddingTop: 8, position: "relative" },
  backToCassette: { position: "absolute", top: 6, left: 2, zIndex: 10 },
  backToCassetteText: {
    fontSize: 13,
    color: "#090909",
    fontWeight: "600",
    letterSpacing: 0.2,
    top: 4,
  },
  backToCassetteLabelWrap: {
    alignSelf: "flex-start",
  },
  backToCassetteUnderline: {
    height: 1,
    backgroundColor: "#090909",
    marginTop: 8,
  },
  slideViewport: {
    flex: 1,
    width: "100%",
    overflow: "hidden",
  },
  slideTrack: {
    flex: 1,
    flexDirection: "row",
  },
  slidePane: {
    flex: 1,
  },
  recWrap: { flex: 1 },
  recTabWrap: { flex: 1 },
  dateText: {
    marginTop: 36,
    fontSize: 16,
    fontWeight: "600",
    color: "#767680",
    letterSpacing: 0.2,
    alignSelf: "center",
  },
  centerArea: {
    flex: 1,
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
    width: 130,
    height: 130,
  },
  recButton: {
    width: 176,
    height: 176,
    alignItems: "center",
    justifyContent: "center",
  },
  recButtonImage: {
    width: 140,
    height: 140,
  },
  recButtonImageDisabled: {
    opacity: 0.9,
  },
  bottomArea: { width: "100%", paddingBottom: 74 },
  progressRow: { flexDirection: "row", alignItems: "center", marginBottom: 0 },
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
  recGuideText: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: "#767680",
    letterSpacing: 0.2,
    lineHeight: 24,
    marginBottom: 84,
  },

});

