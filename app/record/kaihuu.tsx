import ArchiveContent from "@/components/ArchiveContent";
import RecordToolbar from "@/components/RecordToolbar";
import { loadCapsules, saveCapsules } from "@/src/capsules/storage";
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
import { BlurView } from "expo-blur";
import { useFonts } from "expo-font";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  Animated,
  Easing,
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
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
const TEXT_BOARD_IMAGE = require("../../assets/images/textBoard.png");
const TAB_SWIPE_THRESHOLD = 28;
const ARRIVAL_INTRO_SLIDE_MS = 420;
const ARRIVAL_INTRO_HOLD_MS = 900;
const ARRIVAL_INTRO_FADE_OUT_MS = 420;

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

function formatRecordedDate(ms: number | null): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${WEEKDAY[d.getDay()]}`;
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
    mode?: string;
    capsuleId?: string;
    transcriptId?: string;
    fromUnlockNotice?: string;
  }>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscapeViewport = windowWidth > windowHeight;
  const [fontsLoaded] = useFonts({
    YDWbananaslipplus: require("../../assets/fonts/YDWbananaslipplus.otf"),
    ZenAntiqueSoft_400Regular,
  });
  const ydwLoaded = fontsLoaded;
  const zenAntiqueSoftLoaded = fontsLoaded;
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"rec" | "archive">("archive");
  const [toolbarTab, setToolbarTab] = useState<"rec" | "archive">("archive");
  const [isTextMode, setIsTextMode] = useState(false);
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
  const [line1Width, setLine1Width] = useState(0);
  const [line2Width, setLine2Width] = useState(0);
  const [activeCapsuleTitle, setActiveCapsuleTitle] = useState("");
  const [activeCapsuleRecordedAtMs, setActiveCapsuleRecordedAtMs] = useState<
    number | null
  >(null);
  const [isArrivalIntroVisible, setIsArrivalIntroVisible] = useState(false);
  const slideX = useRef(new Animated.Value(-INITIAL_SLIDE_WIDTH)).current;
  const arrivalIntroTranslateX = useRef(new Animated.Value(0)).current;
  const arrivalIntroOpacity = useRef(new Animated.Value(0)).current;
  const arrivalIntroPlayedRef = useRef(false);
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
  const shouldPlayArrivalIntro = true;

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

  const openAllDay21Capsules = useCallback(async () => {
    const list = await loadCapsules();
    let changed = false;
    const nowMs = Date.now();
    const next = list.map((item) => {
      const unlockDate = new Date(item.unlockAtMs);
      const isDay21 = unlockDate.getDate() === 21;
      if (!isDay21 || item.openedAtMs !== null) return item;
      changed = true;
      return { ...item, openedAtMs: nowMs };
    });
    if (changed) {
      await saveCapsules(next);
    }
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
    (async () => {
      await openAllDay21Capsules();
      await refreshUnopenedBadge();
    })();
  }, [openAllDay21Capsules, refreshUnopenedBadge]);

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
        setActiveCapsuleTitle("");
        setActiveCapsuleRecordedAtMs(null);
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
      setActiveCapsuleTitle(capsule?.title ?? "");
      setActiveCapsuleRecordedAtMs(capsule?.recordedAtMs ?? null);
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
  const isLockedToday = recordedDateKey === todayKey;
  const recGuideText = isLockedToday
    ? "本日の録音は完了しました。\n1年後のあなたへ届けられます。"
    : "録音ボタンを押して録音しましょう";

  const transcriptLine1 = "こんにちはー";
  const transcriptLine2 = "おはようございますー";
  const ydwStyle = ydwLoaded ? styles.ydwBananaslipPlus : undefined;

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
    if (params.mode !== "text") return;
    setToolbarTab("archive");
    setActiveTab("archive");
    setShowMainArchive(false);
    setArchiveSettledToMain(false);
    setIsTextMode(true);
  }, [params.mode]);

  useEffect(() => {
    const resolved = Image.resolveAssetSource(TEXT_BOARD_IMAGE);
    if (!resolved?.uri) return;
    Image.prefetch(resolved.uri).catch(() => {});
  }, []);

  useEffect(() => {
    setIsAudioActiveAsync(true).catch(() => {});
    return () => {
      unloadSound().catch(() => {});
    };
  }, [unloadSound]);

  useEffect(() => {
    if (!shouldPlayArrivalIntro) return;
    if (arrivalIntroPlayedRef.current) return;

    arrivalIntroPlayedRef.current = true;
    setIsArrivalIntroVisible(true);
    arrivalIntroTranslateX.stopAnimation();
    arrivalIntroOpacity.stopAnimation();
    arrivalIntroTranslateX.setValue(0);
    arrivalIntroOpacity.setValue(0);

    Animated.sequence([
      Animated.parallel([
        Animated.timing(arrivalIntroTranslateX, {
          toValue: 0,
          duration: 0,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(arrivalIntroOpacity, {
          toValue: 1,
          duration: ARRIVAL_INTRO_SLIDE_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(ARRIVAL_INTRO_HOLD_MS),
      Animated.parallel([
        Animated.timing(arrivalIntroTranslateX, {
          toValue: 0,
          duration: ARRIVAL_INTRO_FADE_OUT_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(arrivalIntroOpacity, {
          toValue: 0,
          duration: ARRIVAL_INTRO_FADE_OUT_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      setIsArrivalIntroVisible(false);
    });
  }, [
    activeCapsuleTitle,
    arrivalIntroOpacity,
    arrivalIntroTranslateX,
    shouldPlayArrivalIntro,
  ]);

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
                      onPressTranscript={() => {
                        setToolbarTab("archive");
                        setActiveTab("archive");
                        setShowMainArchive(false);
                        setArchiveSettledToMain(false);
                        setIsTextMode(true);
                      }}
                    />
                  ) : (
                    <View style={styles.recWrap}>
                      <Text style={styles.dateText}>
                        {formatDisplayDate(new Date())}
                      </Text>

                      {isTextMode ? (
                        <>
                          <ImageBackground
                            source={TEXT_BOARD_IMAGE}
                            resizeMode="stretch"
                            style={styles.paperCard}
                          >
                            <ScrollView
                              style={styles.paperScroll}
                              contentContainerStyle={styles.paperScrollContent}
                              showsVerticalScrollIndicator={false}
                            >
                              <Text
                                style={[styles.lineText, ydwStyle]}
                                onTextLayout={(e) => {
                                  const w =
                                    e.nativeEvent.lines?.[0]?.width ?? 0;
                                  if (w > 0) setLine1Width(w);
                                }}
                              >
                                {transcriptLine1}
                              </Text>
                              <View
                                style={[
                                  styles.line,
                                  { width: Math.max(1, (line1Width || 1) - 2) },
                                ]}
                              />
                              <Text
                                style={[
                                  styles.lineText,
                                  styles.secondLineText,
                                  ydwStyle,
                                ]}
                                onTextLayout={(e) => {
                                  const w =
                                    e.nativeEvent.lines?.[0]?.width ?? 0;
                                  if (w > 0) setLine2Width(w);
                                }}
                              >
                                {transcriptLine2}
                              </Text>
                              <View
                                style={[
                                  styles.lineWide,
                                  { width: Math.max(1, (line2Width || 1) - 2) },
                                ]}
                              />
                            </ScrollView>
                          </ImageBackground>
                          <Pressable
                            style={styles.audioModeLink}
                            onPress={() => setIsTextMode(false)}
                          >
                            <Text style={styles.audioModeLinkText}>
                              音声モードへ
                            </Text>
                          </Pressable>
                        </>
                      ) : (
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

                            <Pressable
                              style={styles.textModeLink}
                              onPress={() => setIsTextMode(true)}
                            >
                              <Text style={styles.textModeLinkText}>
                                テキストモードへ
                              </Text>
                            </Pressable>
                          </View>
                        </>
                      )}
                    </View>
                  )}
                </View>
              </Animated.View>
            </View>
          </View>
        </SafeAreaView>
      </GestureDetector>
      {isArrivalIntroVisible ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.arrivalIntroOverlay,
            {
              opacity: arrivalIntroOpacity,
              transform: [{ translateX: arrivalIntroTranslateX }],
            },
          ]}
        >
          <BlurView
            intensity={34}
            tint="light"
            style={styles.arrivalIntroBlur}
          />
          <Text style={styles.arrivalIntroDate}>
            -{formatRecordedDate(activeCapsuleRecordedAtMs || Date.now())}-
          </Text>
          <Text
            numberOfLines={1}
            style={[
              styles.arrivalIntroTitle,
              zenAntiqueSoftLoaded && styles.arrivalIntroTitleZen,
            ]}
          >
            {activeCapsuleTitle || "あなたのカプセル"}
          </Text>
        </Animated.View>
      ) : null}
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
  audioModeLink: {
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  audioModeLinkText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#767680",
    letterSpacing: 0.2,
    bottom: -25,
  },
  textModeLink: {
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  textModeLinkText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#767680",
    letterSpacing: 0.2,
    bottom: -40,
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
  paperCard: {
    marginTop: 56,
    width: 312,
    height: 449,
    flex: 1,
    maxHeight: 470,
    elevation: 3,
    paddingTop: 30,
    paddingHorizontal: 26,
    alignSelf: "center",
  },
  paperScroll: {
    flex: 1,
  },
  paperScrollContent: {
    paddingBottom: 8,
  },
  lineText: {
    fontSize: 20,
    lineHeight: 26,
    color: "#242428",
    letterSpacing: 0.3,
    alignSelf: "flex-start",
  },
  secondLineText: {
    marginTop: 20,
  },
  line: {
    marginTop: 3,
    width: 142,
    height: 2,
    backgroundColor: "#3a3a3f",
  },
  lineWide: {
    marginTop: 3,
    width: 240,
    height: 2,
    backgroundColor: "#3a3a3f",
  },
  ydwBananaslipPlus: {
    fontFamily: "YDWbananaslipplus",
  },

  arrivalIntroOverlay: {
    position: "absolute",
    left: -36,
    right: -36,
    top: -72,
    bottom: -72,
    zIndex: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  arrivalIntroBlur: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(252, 249, 249, 0.89)",
  },
  arrivalIntroDate: {
    color: "#6f7178",
    fontSize: 17,
    marginBottom: 18,
    fontWeight: "500",
    letterSpacing: 0.4,
  },
  arrivalIntroTitle: {
    color: "#111217",
    fontSize: 40,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  arrivalIntroTitleZen: {
    fontFamily: "ZenAntiqueSoft_400Regular",
    fontWeight: "400",
  },
});

