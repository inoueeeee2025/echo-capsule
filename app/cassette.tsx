import { addCapsule, loadCapsules } from "@/src/capsules/storage";
import { hardwareWS, type HardwareState } from "@/src/hardware/ws";
import {
  computeUnlockAtMs,
  DEMO_MODE,
  DEMO_UNLOCK_DELAY_MS,
} from "@/src/config";
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioRecorder,
  type AudioPlayer,
  type AudioRecorder,
  type AudioStatus,
} from "expo-audio";
import { ZenAntiqueSoft_400Regular } from "@expo-google-fonts/zen-antique-soft";
import { BlurView } from "expo-blur";
import { useFonts } from "expo-font";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  Animated,
  Easing,
  Image,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const WHEEL_SPIN_MS = 6000;
const DESIGN_WIDTH = 852;
const DESIGN_HEIGHT = 393;
const LEFT_WHEEL_X = 110;
const LEFT_WHEEL_Y = 90;
const LEFT_WHEEL_SIZE = 221;
const RIGHT_WHEEL_X = 70;
const RIGHT_WHEEL_Y = 60;
const RIGHT_WHEEL_SIZE = 288;
const COVER_LEFT = 16;
const COVER_TOP = 28;
const COVER_WIDTH = 729;
const COVER_HEIGHT = 290;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ARRIVAL_INTRO_SLIDE_MS = 420;
const ARRIVAL_INTRO_HOLD_MS = 900;
const ARRIVAL_INTRO_FADE_OUT_MS = 420;
const ARRIVAL_INTRO_SLIDE_DISTANCE_RATIO = 0.36;
// カプセルが未確定の状態でも登場演出を出すか。デモでは常に見せたいので DEMO_MODE に従う。
const FORCE_ARRIVAL_INTRO_PREVIEW_ON_RELOAD = DEMO_MODE;
const PROJECT_SWIPE_THRESHOLD = 28;
const PROJECT_SLIDE_TRANSITION_MS = 180;
const AnimatedImageBackground = Animated.createAnimatedComponent(ImageBackground);

type PlayableCapsule = {
  id: string;
  audioUri: string;
  title: string;
  recordedAtMs: number | null;
};

function formatRecordedDate(ms: number | null): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${WEEKDAY[d.getDay()]}`;
}

function normalizeSpinProgress(value: number) {
  return ((value % 1) + 1) % 1;
}

export default function CassetteScreen() {
  const [zenAntiqueSoftLoaded] = useFonts({
    ZenAntiqueSoft_400Regular,
  });
  const router = useRouter();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscapeViewport = windowWidth > windowHeight;
  const params = useLocalSearchParams<{
    capsuleId?: string;
    showArrivalIntro?: string;
  }>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [playableCapsules, setPlayableCapsules] = useState<PlayableCapsule[]>(
    [],
  );
  const [activeCapsuleIndex, setActiveCapsuleIndex] = useState(0);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [activeCapsuleId, setActiveCapsuleId] = useState<string>("");
  const [activeCapsuleTitle, setActiveCapsuleTitle] = useState("");
  const [activeCapsuleRecordedAtMs, setActiveCapsuleRecordedAtMs] = useState<number | null>(null);
  const [isArrivalIntroVisible, setIsArrivalIntroVisible] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const rotateProgress = useRef(new Animated.Value(0)).current;
  const pageSlideX = useRef(new Animated.Value(0)).current;
  const arrivalIntroTranslateX = useRef(new Animated.Value(0)).current;
  const arrivalIntroOpacity = useRef(new Animated.Value(0)).current;
  const isProjectSlideTransitioningRef = useRef(false);
  const pendingPageInAfterIntroRef = useRef(false);
  const pendingMoveDeltaRef = useRef<number | null>(null);
  const moveActiveCapsuleByRef = useRef<(delta: number) => void>(() => {});
  const progressRef = useRef(0);
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const playbackSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const shouldPlayFromHardwareRef = useRef(false);
  const isPlayingRef = useRef(false);
  const recordingRef = useRef<AudioRecorder | null>(null);
  const recordingStartRef = useRef(0);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHardwareRecordingRef = useRef(false);
  const prevHardwareStateRef = useRef<HardwareState>({
    stop: false,
    play: false,
    rec: false,
  });
  const hasAppliedRequestedCapsuleRef = useRef(false);
  const requestedCapsuleId =
    typeof params.capsuleId === "string" ? params.capsuleId : "";
  const shouldPlayArrivalIntro = true;

  const uiScale = useMemo(() => {
    const byWidth = windowWidth / DESIGN_WIDTH;
    const byHeight = windowHeight / DESIGN_HEIGHT;
    return Math.min(byWidth, byHeight);
  }, [windowHeight, windowWidth]);

  const boardWidth = DESIGN_WIDTH * uiScale;
  const boardLeft = Math.max(0, (windowWidth - boardWidth) / 2);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const onPlaybackStatusUpdate = useCallback((status: AudioStatus) => {
    if (!status.isLoaded) {
      setIsPlaying(false);
      return;
    }
    setIsPlaying(status.playing);
  }, []);

  const unloadSound = useCallback(async () => {
    playbackSubscriptionRef.current?.remove();
    playbackSubscriptionRef.current = null;
    const current = playerRef.current;
    playerRef.current = null;
    if (!current) return;
    try {
      current.pause();
    } catch {}
    try {
      current.remove();
    } catch {}
  }, []);

  const clearRecordingTimeout = useCallback(() => {
    if (!recordingTimeoutRef.current) return;
    clearTimeout(recordingTimeoutRef.current);
    recordingTimeoutRef.current = null;
  }, []);

  const refreshPlayableCapsule = useCallback(async () => {
    const list = await loadCapsules();
    const now = Date.now();
    const unlocked = list
      .filter(
        (item) =>
          now >= item.unlockAtMs &&
          typeof item.audioUri === "string" &&
          item.audioUri.length > 0,
      )
      .sort((a, b) => b.unlockAtMs - a.unlockAtMs);

    if (unlocked.length === 0) {
      setPlayableCapsules([]);
      setActiveCapsuleIndex(0);
      setAudioUri(null);
      setActiveCapsuleId("");
      setActiveCapsuleTitle("");
      setActiveCapsuleRecordedAtMs(null);
      return;
    }

    const nextCapsules: PlayableCapsule[] = unlocked.map((item) => ({
      id: item.id,
      audioUri: item.audioUri,
      title: item.title,
      recordedAtMs: item.recordedAtMs ?? null,
    }));
    setPlayableCapsules(nextCapsules);

    let requestedIndex = -1;
    if (
      requestedCapsuleId.length > 0 &&
      !hasAppliedRequestedCapsuleRef.current
    ) {
      requestedIndex = nextCapsules.findIndex(
        (item) => item.id === requestedCapsuleId,
      );
      if (requestedIndex >= 0) {
        hasAppliedRequestedCapsuleRef.current = true;
      }
    }
    setActiveCapsuleIndex((prev) => {
      if (requestedIndex >= 0) return requestedIndex;
      return Math.min(prev, nextCapsules.length - 1);
    });
  }, [requestedCapsuleId]);

  // 録音したカプセルが開封可能になった頃に一覧を取り直す。
  // 本番の待ち時間（1年）では setTimeout の上限を超えるうえ意味がないので、
  // デモ中だけ動かす。
  const scheduleLatestCapsuleRefresh = useCallback(() => {
    if (!DEMO_MODE) return;
    clearRecordingTimeout();
    recordingTimeoutRef.current = setTimeout(() => {
      void (async () => {
        await refreshPlayableCapsule();
        setActiveCapsuleIndex(0);
      })();
    }, DEMO_UNLOCK_DELAY_MS + 300);
  }, [clearRecordingTimeout, refreshPlayableCapsule]);

  useEffect(() => {
    if (playableCapsules.length === 0) return;
    const safeIndex = Math.min(
      Math.max(0, activeCapsuleIndex),
      playableCapsules.length - 1,
    );
    const target = playableCapsules[safeIndex];
    setAudioUri(target.audioUri);
    setActiveCapsuleId(target.id);
    setActiveCapsuleTitle(target.title);
    setActiveCapsuleRecordedAtMs(target.recordedAtMs);
  }, [activeCapsuleIndex, playableCapsules]);

  const stopCassetteRecording = useCallback(async () => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording) return null;

    try {
      await recording.stop();
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
      const uri = recording.getStatus().url;
      if (!uri) return null;

      const recordedAtMs = Date.now();
      const unlockAtMs = computeUnlockAtMs(recordedAtMs);
      const title = `${new Date(recordedAtMs).getFullYear()}/${String(new Date(recordedAtMs).getMonth() + 1).padStart(2, "0")}/${String(new Date(recordedAtMs).getDate()).padStart(2, "0")}`;
      const durationSec = Math.max(
        1,
        Math.floor((Date.now() - recordingStartRef.current) / 1000),
      );

      await addCapsule({
        id: `capsule-${recordedAtMs}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        audioUri: uri,
        durationSec,
        recordedAtMs,
        unlockAtMs,
        openedAtMs: null,
        hasTranscript: true,
      });
      scheduleLatestCapsuleRefresh();
      return uri;
    } catch {
      return null;
    } finally {
      isHardwareRecordingRef.current = false;
    }
  }, [scheduleLatestCapsuleRefresh]);

  const startCassetteRecording = useCallback(async () => {
    if (isHardwareRecordingRef.current) return;

    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) return;

      await unloadSound();
      shouldPlayFromHardwareRef.current = false;
      setIsPlaying(false);
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      const recording = recorder;
      await recording.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
      recording.record();
      recordingRef.current = recording;
      recordingStartRef.current = Date.now();
      isHardwareRecordingRef.current = true;
    } catch {
      isHardwareRecordingRef.current = false;
    }
  }, [recorder, unloadSound]);

  const finishPendingPageTransition = useCallback(() => {
    arrivalIntroTranslateX.stopAnimation();
    arrivalIntroOpacity.stopAnimation();
    setIsArrivalIntroVisible(false);
    pendingPageInAfterIntroRef.current = false;
    pageSlideX.stopAnimation();
    Animated.timing(pageSlideX, {
      toValue: 0,
      duration: PROJECT_SLIDE_TRANSITION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      isProjectSlideTransitioningRef.current = false;
      const queuedDelta = pendingMoveDeltaRef.current;
      pendingMoveDeltaRef.current = null;
      if (queuedDelta == null) return;
      moveActiveCapsuleByRef.current(queuedDelta);
    });
  }, [arrivalIntroOpacity, arrivalIntroTranslateX, pageSlideX]);

  const moveActiveCapsuleBy = useCallback(
    (delta: number) => {
      if (!isLandscapeViewport) return;
      if (playableCapsules.length <= 1) return;
      if (isProjectSlideTransitioningRef.current) {
        if (pendingPageInAfterIntroRef.current || isArrivalIntroVisible) {
          pendingMoveDeltaRef.current = delta;
          finishPendingPageTransition();
        }
        return;
      }
      const next = activeCapsuleIndex + delta;
      if (next < 0 || next > playableCapsules.length - 1) return;

      isProjectSlideTransitioningRef.current = true;
      const outTo = delta > 0 ? -windowWidth : windowWidth;
      const inFrom = -outTo;
      pageSlideX.stopAnimation();
      Animated.timing(pageSlideX, {
        toValue: outTo,
        duration: PROJECT_SLIDE_TRANSITION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        pendingPageInAfterIntroRef.current = true;
        pageSlideX.setValue(inFrom);
        setActiveCapsuleIndex(next);
      });
    },
    [
      activeCapsuleIndex,
      finishPendingPageTransition,
      isArrivalIntroVisible,
      isLandscapeViewport,
      pageSlideX,
      playableCapsules.length,
      windowWidth,
    ],
  );

  useEffect(() => {
    moveActiveCapsuleByRef.current = moveActiveCapsuleBy;
  }, [moveActiveCapsuleBy]);

  const projectSwipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-18, 18])
        .failOffsetY([-24, 24])
        .minDistance(18)
        .onEnd((gesture) => {
          const isLeftSwipe =
            gesture.translationX <= -PROJECT_SWIPE_THRESHOLD ||
            (gesture.velocityX < -220 && gesture.translationX < -8);
          const isRightSwipe =
            gesture.translationX >= PROJECT_SWIPE_THRESHOLD ||
            (gesture.velocityX > 220 && gesture.translationX > 8);

          if (isLeftSwipe) {
            moveActiveCapsuleBy(1);
            return;
          }
          if (isRightSwipe) {
            moveActiveCapsuleBy(-1);
          }
        }),
    [moveActiveCapsuleBy],
  );

  const handleHardwarePlaybackChange = useCallback((next: boolean) => {
    shouldPlayFromHardwareRef.current = next;
    const player = playerRef.current;
    if (!player) {
      setIsPlaying(next);
      return;
    }
    try {
      if (next) {
        player.play();
        setIsPlaying(true);
      } else {
        player.pause();
        setIsPlaying(false);
      }
    } catch {}
  }, []);

  useEffect(() => {
    hardwareWS.connect();
    const unsub = hardwareWS.subscribe((s) => {
      const prev = prevHardwareStateRef.current;
      const playDown = s.play && !prev.play;
      const playUp = !s.play && prev.play;
      const recDown = s.rec && !prev.rec;
      const recUp = !s.rec && prev.rec;
      const stopDown = s.stop && !prev.stop;

      if (playDown) {
        handleHardwarePlaybackChange(true);
      }
      if (recDown) {
        void startCassetteRecording();
      }
      if (recUp) {
        void stopCassetteRecording();
      }
      if (playUp) {
        handleHardwarePlaybackChange(false);
      }
      if (stopDown) {
        handleHardwarePlaybackChange(false);
        moveActiveCapsuleBy(1);
      }

      prevHardwareStateRef.current = s;
    });
    return unsub;
  }, [
    handleHardwarePlaybackChange,
    moveActiveCapsuleBy,
    startCassetteRecording,
    stopCassetteRecording,
  ]);

  useEffect(() => {
    void setIsAudioActiveAsync(true);
    return () => {
      unloadSound().catch(() => {});
    };
  }, [unloadSound]);

  useEffect(() => {
    void refreshPlayableCapsule();
  }, [refreshPlayableCapsule]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!audioUri) {
        await unloadSound();
        return;
      }
      try {
        await unloadSound();
        const player = createAudioPlayer({ uri: audioUri }, { updateInterval: 200 });
        const sub = player.addListener(
          "playbackStatusUpdate",
          onPlaybackStatusUpdate,
        );
        if (!mounted) {
          sub.remove();
          player.remove();
          return;
        }
        playerRef.current = player;
        playbackSubscriptionRef.current = sub;
        onPlaybackStatusUpdate(player.currentStatus);
        if (shouldPlayFromHardwareRef.current) {
          try {
            player.play();
            setIsPlaying(true);
          } catch {}
        }
      } catch {
        setIsPlaying(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [audioUri, onPlaybackStatusUpdate, unloadSound]);

  useEffect(() => {
    const id = rotateProgress.addListener(({ value }) => {
      progressRef.current = normalizeSpinProgress(value);
    });
    return () => rotateProgress.removeListener(id);
  }, [rotateProgress]);

  useEffect(() => {
    if (isPlaying) {
      if (loopRef.current) {
        loopRef.current.stop();
        loopRef.current = null;
      }

      const startSpinLoop = () => {
        rotateProgress.setValue(0);
        progressRef.current = 0;
        loopRef.current = Animated.loop(
          Animated.timing(rotateProgress, {
            toValue: 1,
            duration: WHEEL_SPIN_MS,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          { resetBeforeIteration: true },
        );
        loopRef.current.start();
      };

      const normalized = normalizeSpinProgress(progressRef.current);
      if (normalized > 0) {
        rotateProgress.setValue(normalized);
        Animated.timing(rotateProgress, {
          toValue: 1,
          duration: Math.max(1, Math.round((1 - normalized) * WHEEL_SPIN_MS)),
          easing: Easing.linear,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (!finished || !isPlayingRef.current) return;
          startSpinLoop();
        });
      } else {
        startSpinLoop();
      }
      return;
    }

    if (loopRef.current) {
      loopRef.current.stop();
      loopRef.current = null;
    }
    rotateProgress.stopAnimation((value) => {
      const normalized = normalizeSpinProgress(value);
      progressRef.current = normalized;
      rotateProgress.setValue(normalized);
    });
  }, [isPlaying, rotateProgress]);

  useEffect(() => {
    return () => {
      clearRecordingTimeout();
      if (loopRef.current) {
        loopRef.current.stop();
        loopRef.current = null;
      }
      rotateProgress.stopAnimation();
      if (recordingRef.current) {
        recordingRef.current.stop().catch(() => {});
        recordingRef.current = null;
      }
    };
  }, [clearRecordingTimeout, rotateProgress]);

  useEffect(() => {
    if (!shouldPlayArrivalIntro) return;
    if (!activeCapsuleId && !FORCE_ARRIVAL_INTRO_PREVIEW_ON_RELOAD) return;
    if (!activeCapsuleTitle && !FORCE_ARRIVAL_INTRO_PREVIEW_ON_RELOAD) return;
    setIsArrivalIntroVisible(true);
    arrivalIntroTranslateX.stopAnimation();
    arrivalIntroOpacity.stopAnimation();
    const slideDistance = Math.max(140, windowWidth * ARRIVAL_INTRO_SLIDE_DISTANCE_RATIO);
    arrivalIntroTranslateX.setValue(slideDistance);
    arrivalIntroOpacity.setValue(0);

    Animated.sequence([
      Animated.parallel([
        Animated.timing(arrivalIntroTranslateX, {
          toValue: 0,
          duration: ARRIVAL_INTRO_SLIDE_MS,
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
          toValue: -slideDistance,
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
      if (!pendingPageInAfterIntroRef.current) return;
      pendingPageInAfterIntroRef.current = false;
      Animated.timing(pageSlideX, {
        toValue: 0,
        duration: PROJECT_SLIDE_TRANSITION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        isProjectSlideTransitioningRef.current = false;
      });
    });
  }, [
    activeCapsuleId,
    activeCapsuleTitle,
    arrivalIntroOpacity,
    arrivalIntroTranslateX,
    pageSlideX,
    shouldPlayArrivalIntro,
    windowWidth,
  ]);

  const spin = rotateProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const reverseSpin = rotateProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "-360deg"],
  });
  const canPlay = useMemo(() => !!audioUri, [audioUri]);
  const showArrivalIntro = isArrivalIntroVisible;

  return (
    <AnimatedImageBackground
      source={require("../assets/images/cassette_background.png")}
      resizeMode="cover"
      style={[styles.background, { transform: [{ translateX: pageSlideX }] }]}
    >
      <GestureDetector gesture={projectSwipeGesture}>
        <SafeAreaView style={styles.safeArea}>
        <View style={[styles.cassetteArea, styles.cassetteAreaLandscape]}>
          <View
            style={[
              styles.leftWheelSlot,
              {
                left: boardLeft + LEFT_WHEEL_X * uiScale,
                top: LEFT_WHEEL_Y * uiScale,
                width: LEFT_WHEEL_SIZE * uiScale,
                height: LEFT_WHEEL_SIZE * uiScale,
              },
            ]}
          >
            <Animated.Image
              source={require("../assets/images/leftwheel.png")}
              resizeMode="contain"
              style={[styles.wheelImage, { transform: [{ rotate: reverseSpin }] }]}
            />
          </View>
          <View
            style={[
              styles.rightWheelSlot,
              {
                right: boardLeft + RIGHT_WHEEL_X * uiScale,
                top: RIGHT_WHEEL_Y * uiScale,
                width: RIGHT_WHEEL_SIZE * uiScale,
                height: RIGHT_WHEEL_SIZE * uiScale,
              },
            ]}
          >
            <Animated.Image
              source={require("../assets/images/rightwheel.png")}
              resizeMode="contain"
              style={[styles.wheelImage, { transform: [{ rotate: spin }] }]}
            />
          </View>
          <Image
            source={require("../assets/images/cassetteCover.png")}
            resizeMode="cover"
            style={[
              styles.cassetteCover,
              {
                width: COVER_WIDTH * uiScale,
                height: COVER_HEIGHT * uiScale,
                top: COVER_TOP * uiScale,
                left: boardLeft + COVER_LEFT * uiScale,
              },
            ]}
          />
        </View>

        <Image
          source={require("../assets/images/cassetteBottomBar.png")}
          resizeMode="stretch"
          style={[
            styles.bottomBarBackground,
            {
              left: boardLeft,
              width: DESIGN_WIDTH * uiScale,
              height: 94 * uiScale,
              bottom: -2 * uiScale,
            },
          ]}
        />
        <View
          style={[
            styles.bottomBar,
            {
              bottom: 15 * uiScale,
              paddingHorizontal: 24 * uiScale,
            },
          ]}
        >
          <Pressable
            onPress={() => router.back()}
            style={[styles.bottomAction, styles.backAction, { width: 110 * uiScale }]}
            hitSlop={8}
          >
            <Image
              source={require("../assets/images/backButton.png")}
              resizeMode="contain"
              style={[
                styles.bottomButtonImage,
                { width: 60 * uiScale, height: 60 * uiScale },
              ]}
            />
          </Pressable>
          <Pressable
            onPress={() =>
              router.replace({
                pathname: "/record/kaihuu",
                params: activeCapsuleId ? { capsuleId: activeCapsuleId } : undefined,
              })
            }
            style={[styles.bottomAction, { width: 110 * uiScale }]}
            hitSlop={8}
          >
            <Image
              source={require("../assets/images/mobileButton.png")}
              resizeMode="contain"
              style={[
                styles.bottomButtonImage,
                { width: 60 * uiScale, height: 60 * uiScale },
              ]}
            />
          </Pressable>
        </View>

        <Pressable
          onLongPress={() => handleHardwarePlaybackChange(!isPlaying)}
          delayLongPress={700}
          style={styles.devPlaybackToggleZone}
          disabled={!canPlay}
          hitSlop={16}
        />
        {showArrivalIntro ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.arrivalIntroOverlay,
              {
                opacity: arrivalIntroOpacity,
                transform: [
                  {
                    translateX: Animated.add(
                      arrivalIntroTranslateX,
                      Animated.multiply(pageSlideX, -1),
                    ),
                  },
                ],
              },
            ]}
          >
            <BlurView intensity={34} tint="light" style={styles.arrivalIntroBlur} />
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
              {activeCapsuleTitle || "プロジェクト名"}
            </Text>
          </Animated.View>
        ) : null}
        </SafeAreaView>
      </GestureDetector>
    </AnimatedImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: "#0f0f12",
  },
  safeArea: {
    flex: 1,
  },
  cassetteArea: {
    flex: 1,
    justifyContent: "center",
  },
  cassetteAreaLandscape: {
    justifyContent: "flex-start",
  },
  leftWheelSlot: {
    position: "absolute",
    zIndex: 2,
    overflow: "visible",
  },
  rightWheelSlot: {
    position: "absolute",
    zIndex: 2,
    overflow: "visible",
  },
  wheelImage: {
    width: "100%",
    height: "100%",
  },
  cassetteCover: {
    zIndex: 3,
    position: "absolute",
  },
  bottomAction: {
    alignItems: "center",
  },
  backAction: {
    marginLeft: 8,
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 8,
    zIndex: 5,
  },
  bottomBarBackground: {
    position: "absolute",
    zIndex: 4,
  },
  bottomButtonImage: {
    width: 60,
    height: 60,
  },
  devPlaybackToggleZone: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
    zIndex: 99,
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
    fontSize: 50,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  arrivalIntroTitleZen: {
    fontFamily: "ZenAntiqueSoft_400Regular",
    fontWeight: "400",
  },
});
