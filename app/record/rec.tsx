import PushAppBaseSvg from "@/assets/images/pushAppBase.svg";
import CassetteButtonSvg from "@/assets/images/cassetteButton.svg";
import SmartphoneBackSvg from "@/assets/images/smartphoneBack.svg";
import TouchSvg from "@/assets/images/touch.svg";
import ArchiveContent from "@/components/ArchiveContent";
import RecordToolbar from "@/components/RecordToolbar";
import {
  addCapsule,
  CapsuleRecord,
  loadCapsules,
  updateCapsule,
} from "@/src/capsules/storage";
import { ZenAntiqueSoft_400Regular } from "@expo-google-fonts/zen-antique-soft";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Slider from "@react-native-community/slider";
import { useFocusEffect } from "@react-navigation/native";
import { BlurView } from "expo-blur";
import { Asset } from "expo-asset";
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
import { useFonts } from "expo-font";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  DeviceEventEmitter,
  Dimensions,
  Easing,
  type EmitterSubscription,
  Image,
  ImageBackground,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

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

const MAX_RECORDING_SECONDS = 180;
const MAX_RECORDING_MS = MAX_RECORDING_SECONDS * 1000;
const RECORDING_WARNING_MS = 170000; // 02:50
const TIMER_INTERVAL_MS = 100;
const SCREEN_WIDTH = Dimensions.get("window").width;

const VOICE_BUTTON_SIZE = 140;
const RECORD_BUTTON_OFFSET_Y = -100;
const REVIEW_BUTTON_OFFSET_Y = -10;
const NOREC_BUTTON_NUDGE_Y = -20;

const TRANSPARENT_THUMB = {
  uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6p8N8AAAAASUVORK5CYII=",
};
const LETTER_IMAGE = require("../../assets/images/letter.png");
const LETTER_BACKGROUND_IMAGE = require("../../assets/images/letter_background.png");
const RECORDED_DATE_STORAGE_KEY = "recordedDateKey";
const DISMISSED_NOTICE_IDS_STORAGE_KEY = "dismissedUnlockNoticeIds";
const TAB_SWIPE_THRESHOLD = 28;
const PUSH_NOTICE_SLIDE_DURATION_MS = 340;
const PUSH_NOTICE_VISIBLE_MS = 8000;
const PUSH_NOTICE_SOUND_CLEANUP_MS = 1200;
const CASSETTE_FLIP_OUT_DURATION_MS = 190;
const CASSETTE_FLIP_IN_DURATION_MS = 230;
const PUSH_NOTICE_SOUND_FILE = require("../../assets/soun/決定ボタンを押す40.mp3");
const HARDWARE_WS_URL = (
  process.env.EXPO_PUBLIC_HARDWARE_WS_URL ?? "ws://192.168.46.1/ws"
).trim();
const WS_RECONNECT_DELAY_MS = 1500;
let didDevBootResetRecordedDateKey = false;

type HardwareButtonState = {
  stop: boolean;
  play: boolean;
  rec: boolean;
};

function resolveHardwareWifiConnectedFromPayload(payload: unknown): boolean | null {
  if (typeof payload === "boolean") return payload;
  if (!payload || typeof payload !== "object") return null;
  const candidate =
    (payload as { connected?: unknown }).connected ??
    (payload as { isConnected?: unknown }).isConnected ??
    (payload as { wifiConnected?: unknown }).wifiConnected;
  return typeof candidate === "boolean" ? candidate : null;
}

function resolveHardwareWifiConnectedFromMessage(data: unknown): boolean | null {
  if (typeof data === "boolean") return data;
  if (typeof data !== "string") return null;
  const trimmed = data.trim();
  if (trimmed.length === 0) return null;
  if (trimmed === "connected" || trimmed === "wifi_connected") return true;
  if (trimmed === "disconnected" || trimmed === "wifi_disconnected")
    return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return resolveHardwareWifiConnectedFromPayload(parsed);
  } catch {
    return null;
  }
}

function resolveHardwareButtonsFromMessage(
  data: unknown,
): HardwareButtonState | null {
  if (typeof data !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return null;
    const stop = (parsed as { stop?: unknown }).stop;
    const play = (parsed as { play?: unknown }).play;
    const rec = (parsed as { rec?: unknown }).rec;
    if (
      typeof stop !== "boolean" ||
      typeof play !== "boolean" ||
      typeof rec !== "boolean"
    ) {
      return null;
    }
    return { stop, play, rec };
  } catch {
    return null;
  }
}

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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscapeViewport = windowWidth > windowHeight;
  const router = useRouter();

  const [zenAntiqueSoftLoaded] = useFonts({
    ZenAntiqueSoft_400Regular,
  });

  const [flow, setFlow] = useState<(typeof FLOW)[keyof typeof FLOW]>(
    FLOW.RECORD,
  );
  const [recordStatus, setRecordStatus] = useState<
    (typeof STATUS)[keyof typeof STATUS]
  >(STATUS.IDLE);
  const [isRecordPressing, setIsRecordPressing] = useState(false);
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
  const [activeTab, setActiveTab] = useState<"rec" | "archive">("rec");
  const [unlockNoticeCapsule, setUnlockNoticeCapsule] =
    useState<CapsuleRecord | null>(null);
  const [isDevUnlockPreviewVisible, setIsDevUnlockPreviewVisible] =
    useState(false);
  const [hasUnopenedInArchive, setHasUnopenedInArchive] = useState(false);
  const [slideWidth, setSlideWidth] = useState(SCREEN_WIDTH);
  const [isDismissedNoticeIdsReady, setIsDismissedNoticeIdsReady] =
    useState(false);
  const [isCassetteConnectPromptVisible, setIsCassetteConnectPromptVisible] =
    useState(false);
  const [isCassetteFlipAnimating, setIsCassetteFlipAnimating] = useState(false);
  const [isHardwareWifiConnected, setIsHardwareWifiConnected] = useState(false);

  const pulse = useRef(new Animated.Value(1)).current;
  const saveReveal = useRef(new Animated.Value(0)).current;
  const unlockOverlayOpacity = useRef(new Animated.Value(0)).current;
  const unlockOverlayContentTranslateY = useRef(new Animated.Value(44)).current;
  const unlockOverlayLetterScale = useRef(new Animated.Value(0.8)).current;
  const unlockOverlayLetterPulseScale = useRef(new Animated.Value(1)).current;
  const unlockOverlayCloseScale = useRef(new Animated.Value(0.8)).current;
  const unlockOverlayTouchFloatY = useRef(new Animated.Value(0)).current;
  const unlockOverlayLetterPulseLoopRef =
    useRef<Animated.CompositeAnimation | null>(null);
  const unlockOverlayTouchFloatLoopRef =
    useRef<Animated.CompositeAnimation | null>(null);
  const pushNoticeTranslateX = useRef(new Animated.Value(72)).current;
  const pushNoticeOpacity = useRef(new Animated.Value(0)).current;
  const cassetteFlip = useRef(new Animated.Value(0)).current;
  const pushNoticeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pushNoticeSoundRef = useRef<AudioPlayer | null>(null);
  const pushNoticeSoundCleanupTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const slideX = useRef(new Animated.Value(0)).current;
  const dismissedNoticeIdsRef = useRef<Set<string>>(new Set());
  const hardwareWsRef = useRef<WebSocket | null>(null);
  const wsReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const hardwareButtonStateRef = useRef<HardwareButtonState>({
    stop: false,
    play: false,
    rec: false,
  });
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef(0);
  const recordingRef = useRef<AudioRecorder | null>(null);
  const soundRef = useRef<AudioPlayer | null>(null);
  const playbackSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const autoStoppingRef = useRef(false);
  const isSlidingRef = useRef(false);

  const recordStatusRef = useRef(recordStatus);
  useEffect(() => {
    recordStatusRef.current = recordStatus;
  }, [recordStatus]);
  useEffect(() => {
    isSlidingRef.current = isSliding;
  }, [isSliding]);

  const isRecording = recordStatus === STATUS.RECORDING;
  const todayKey = useMemo(() => toDateKey(now), [now]);
  const isLockedToday = false;
  
  const cassetteFlipOpacity = cassetteFlip.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [0.16, 1, 0.16],
  });
  const cassetteFlipScale = cassetteFlip.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [0.92, 1, 0.92],
  });
  const cassetteFlipRotateY = cassetteFlip.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ["14deg", "0deg", "-14deg"],
  });
  const cassetteFlipTranslateX = cassetteFlip.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [-58, 0, 58],
  });

  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const openWifiSettings = useCallback(async () => {
    const tryOpenUrl = async (url: string): Promise<boolean> => {
      try {
        const canOpen = await Linking.canOpenURL(url).catch(() => true);
        if (canOpen === false) {
          return false;
        }
        await Linking.openURL(url);
        return true;
      } catch {
        return false;
      }
    };

    try {
      if (Platform.OS === "android") {
        await Linking.sendIntent("android.settings.WIFI_SETTINGS");
        return;
      }

      if (Platform.OS === "ios") {
        if (
          (await tryOpenUrl("App-Prefs:WIFI")) ||
          (await tryOpenUrl("App-prefs:WIFI")) ||
          (await tryOpenUrl("App-Prefs:root=WIFI")) ||
          (await tryOpenUrl("App-prefs:root=WIFI")) ||
          (await tryOpenUrl("App-Prefs:root=Settings&path=WIFI")) ||
          (await tryOpenUrl("prefs:root=WIFI")) ||
          (await tryOpenUrl("App-Prefs:"))
        ) {
          return;
        }
      }

      await Linking.openSettings();
    } catch {
      try {
        await Linking.openSettings();
      } catch {}
    }
  }, []);

  const unloadSound = useCallback(async () => {
    playbackSubscriptionRef.current?.remove();
    playbackSubscriptionRef.current = null;
    const s = soundRef.current;
    soundRef.current = null;
    if (s) {
      try {
        s.pause();
      } catch {}
      try {
        s.remove();
      } catch {}
    }
    setIsLoaded(false);
    setIsPlaying(false);
    setPositionMillis(0);
    setDurationMillis(0);
    setSliderMillis(0);
  }, []);

  const stopPushNoticeSound = useCallback(() => {
    if (pushNoticeSoundCleanupTimerRef.current) {
      clearTimeout(pushNoticeSoundCleanupTimerRef.current);
      pushNoticeSoundCleanupTimerRef.current = null;
    }
    const player = pushNoticeSoundRef.current;
    pushNoticeSoundRef.current = null;
    if (!player) return;
    try {
      player.pause();
    } catch {}
    try {
      player.remove();
    } catch {}
  }, []);

  const playPushNoticeSound = useCallback(async () => {
    stopPushNoticeSound();
    try {
      const soundAsset = Asset.fromModule(PUSH_NOTICE_SOUND_FILE);
      if (!soundAsset.localUri) {
        try {
          await soundAsset.downloadAsync();
        } catch {}
      }
      const uri = soundAsset.localUri ?? soundAsset.uri;
      if (!uri) return;
      const player = createAudioPlayer({ uri });
      pushNoticeSoundRef.current = player;
      player.play();
      pushNoticeSoundCleanupTimerRef.current = setTimeout(() => {
        if (pushNoticeSoundRef.current !== player) return;
        pushNoticeSoundRef.current = null;
        try {
          player.remove();
        } catch {}
      }, PUSH_NOTICE_SOUND_CLEANUP_MS);
    } catch {}
  }, [stopPushNoticeSound]);

  const onPlaybackStatusUpdate = useCallback((status: AudioStatus) => {
    if (!status.isLoaded) {
      setIsLoaded(false);
      setIsPlaying(false);
      setPositionMillis(0);
      setDurationMillis(0);
      if (!isSlidingRef.current) setSliderMillis(0);
      return;
    }
    setIsLoaded(true);
    setIsPlaying(status.playing);
    const nextPositionMillis = Math.floor((status.currentTime ?? 0) * 1000);
    const nextDurationMillis = Math.floor((status.duration ?? 0) * 1000);
    setPositionMillis(nextPositionMillis);
    setDurationMillis(nextDurationMillis);
    if (!isSlidingRef.current) setSliderMillis(nextPositionMillis);
  }, []);

  const stopRecording = useCallback(async (): Promise<{
    uri: string;
    recordedAtMs: number;
  } | null> => {
    if (recordStatusRef.current !== STATUS.RECORDING) return null;

    const elapsed = Math.min(
      Date.now() - recordingStartRef.current,
      MAX_RECORDING_MS,
    );
    setElapsedMs(elapsed);
    clearTimer();
    setRecordStatus(STATUS.RECORDED);
    recordStatusRef.current = STATUS.RECORDED;

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
      const recordedDateKey = toDateKey(new Date(recordedAtMs));
      setLastRecordedUri(uri);
      setLastRecordedAtMs(recordedAtMs);
      setRecordedDateKey(recordedDateKey);
      try {
        await AsyncStorage.setItem(RECORDED_DATE_STORAGE_KEY, recordedDateKey);
      } catch {}
      return { uri, recordedAtMs };
    } catch (error) {
      console.warn("[Record] stop failed:", error);
      return null;
    }
  }, []);

  const startRecording = async () => {
    if (recordStatusRef.current === STATUS.RECORDING || flow !== FLOW.RECORD) {
      setIsRecordPressing(false);
      return;
    }

    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) return;

      await unloadSound();
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      const recording = recorder;
      await recording.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
      recording.record();
      recordingRef.current = recording;
    } catch (error) {
      console.warn("[Record] start failed:", error);
      setIsRecordPressing(false);
      return;
    }

    clearTimer();
    recordingStartRef.current = Date.now();
    setElapsedMs(0);
    setRecordStatus(STATUS.RECORDING);
    recordStatusRef.current = STATUS.RECORDING;
  };

  const handleRecordPressOut = () => {
    setIsRecordPressing(false);
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

  const onSliderValueChange = useCallback((value: number) => {
    setSliderMillis(value);
  }, []);

  const onSlidingComplete = useCallback(
    async (value: number) => {
      setIsSliding(false);
      setSliderMillis(value);
      const s = soundRef.current;
      if (!s || !isLoaded) return;
      try {
        await s.seekTo(value / 1000);
      } catch {}
    },
    [isLoaded],
  );

  const togglePlay = useCallback(async () => {
    const s = soundRef.current;
    if (!s || !isLoaded) return;

    try {
      if (isPlaying) {
        s.pause();
        setIsPlaying(false);
      } else {
        if (durationMillis > 0 && positionMillis >= durationMillis - 250) {
          await s.seekTo(0);
        }
        s.play();
        setIsPlaying(true);
      }
    } catch {}
  }, [durationMillis, isLoaded, isPlaying, positionMillis]);

  const handleStopRecordingFromHardware = useCallback(async () => {
    if (recordStatusRef.current !== STATUS.RECORDING) return;
    const result = await stopRecording();
    if (result) {
      setFlow(FLOW.REVIEW);
    } else {
      setRecordStatus(STATUS.IDLE);
      recordStatusRef.current = STATUS.IDLE;
    }
  }, [stopRecording]);

  const handleHardwareRecPress = useCallback(() => {
    if (activeTab !== "rec") return;
    if (isCassetteConnectPromptVisible) return;

    if (flow === FLOW.RECORD) {
      if (recordStatusRef.current === STATUS.RECORDING) {
        void handleStopRecordingFromHardware();
        return;
      }
      if (recordStatusRef.current === STATUS.IDLE) {
        void startRecording();
      }
    }
  }, [
    activeTab,
    flow,
    handleStopRecordingFromHardware,
    isCassetteConnectPromptVisible,
    startRecording,
  ]);

  const handleHardwarePlayPress = useCallback(() => {
    if (activeTab !== "rec") return;
    if (flow !== FLOW.REVIEW) return;
    if (isCassetteConnectPromptVisible) return;
    void togglePlay();
  }, [activeTab, flow, isCassetteConnectPromptVisible, togglePlay]);

  const handleHardwareStopPress = useCallback(() => {
    if (activeTab !== "rec") return;
    if (isCassetteConnectPromptVisible) return;

    if (flow === FLOW.RECORD && recordStatusRef.current === STATUS.RECORDING) {
      void handleStopRecordingFromHardware();
      return;
    }

    if (flow === FLOW.REVIEW && isPlaying) {
      void togglePlay();
    }
  }, [
    activeTab,
    flow,
    handleStopRecordingFromHardware,
    isCassetteConnectPromptVisible,
    isPlaying,
    togglePlay,
  ]);

  const openProjectModal = useCallback(async () => {
    const s = soundRef.current;
    if (s && isPlaying) {
      try {
        s.pause();
      } catch {}
    }
    setIsPlaying(false);
    setIsProjectModalVisible(true);
  }, [isPlaying]);

  const openCassetteMode = useCallback(() => {
    router.push("/cassette");
  }, [router]);

  const closeProjectModal = useCallback(() => {
    setIsProjectModalVisible(false);
  }, []);

  const saveProject = useCallback(async () => {
    const baseDate = lastRecordedAtMs ? new Date(lastRecordedAtMs) : new Date();
    const fallbackName = `${baseDate.getFullYear()}/${baseDate.getMonth() + 1}/${baseDate.getDate()}`;
    const normalized = projectName.trim() || fallbackName;
    const recordedAtMs = lastRecordedAtMs ?? Date.now();
    const defaultUnlockDate = new Date(recordedAtMs);
    defaultUnlockDate.setFullYear(defaultUnlockDate.getFullYear() + 1);
    const unlockAtMs = __DEV__
      ? recordedAtMs + 60 * 1000
      : defaultUnlockDate.getTime();

    if (lastRecordedUri) {
      await addCapsule({
        id: `capsule-${recordedAtMs}-${Math.random().toString(36).slice(2, 8)}`,
        title: normalized,
        audioUri: lastRecordedUri,
        durationSec: Math.max(1, Math.floor((elapsedMs || 1000) / 1000)),
        recordedAtMs,
        unlockAtMs,
        openedAtMs: null,
        hasTranscript: true,
      });
    }

    setSavedProjectName(normalized);
    setActiveTab("rec");
    setIsProjectModalVisible(false);
    setIsSaveComplete(true);
  }, [elapsedMs, lastRecordedAtMs, lastRecordedUri, projectName]);

  const saveProjectAndBack = useCallback(async () => {
    await unloadSound();
    setIsProjectModalVisible(false);
    setIsSaveComplete(false);
    setProjectName("");
    setActiveTab("rec");
    setFlow(FLOW.RECORD);
    setRecordStatus(STATUS.IDLE);
    recordStatusRef.current = STATUS.IDLE;
    setIsRecordPressing(false);
    setElapsedMs(0);
  }, [unloadSound]);

  const retakeRecording = useCallback(async () => {
    setIsRecordPressing(false);
    clearTimer();
    autoStoppingRef.current = false;
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (recording) {
      try {
        await recording.stop();
      } catch {}
    }
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
    } catch {}

    await unloadSound();
    setFlow(FLOW.RECORD);
    setRecordStatus(STATUS.IDLE);
    recordStatusRef.current = STATUS.IDLE;
    setElapsedMs(0);
    setLastRecordedUri(null);
    setLastRecordedAtMs(null);
    setRecordedDateKey(null);
    try {
      await AsyncStorage.removeItem(RECORDED_DATE_STORAGE_KEY);
    } catch {}
    setProjectName("");
    setSavedProjectName("");
    setIsProjectModalVisible(false);
    setIsSaveComplete(false);
  }, [unloadSound]);

  const transitionCassetteConnectPrompt = useCallback(
    (nextVisible: boolean) => {
      if (isCassetteFlipAnimating) return;
      if (isCassetteConnectPromptVisible === nextVisible) return;

      const outDirection = nextVisible ? 1 : -1;
      setIsCassetteFlipAnimating(true);
      cassetteFlip.stopAnimation();
      Animated.timing(cassetteFlip, {
        toValue: outDirection,
        duration: CASSETTE_FLIP_OUT_DURATION_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) {
          cassetteFlip.setValue(0);
          setIsCassetteFlipAnimating(false);
          return;
        }

        setIsCassetteConnectPromptVisible(nextVisible);
        cassetteFlip.setValue(-outDirection);

        Animated.timing(cassetteFlip, {
          toValue: 0,
          duration: CASSETTE_FLIP_IN_DURATION_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(() => {
          setIsCassetteFlipAnimating(false);
        });
      });
    },
    [cassetteFlip, isCassetteConnectPromptVisible, isCassetteFlipAnimating],
  );

  useEffect(() => {
    if (flow === FLOW.RECORD) {
      setIsRecordPressing(false);
    }
  }, [flow]);

  useEffect(() => {
    if (flow !== FLOW.RECORD || activeTab !== "rec") {
      cassetteFlip.stopAnimation();
      cassetteFlip.setValue(0);
      setIsCassetteFlipAnimating(false);
      setIsCassetteConnectPromptVisible(false);
    }
  }, [activeTab, cassetteFlip, flow]);

  useEffect(() => {
    if (!isHardwareWifiConnected || !isCassetteConnectPromptVisible) return;
    transitionCassetteConnectPrompt(false);
  }, [
    isCassetteConnectPromptVisible,
    isHardwareWifiConnected,
    transitionCassetteConnectPrompt,
  ]);

  useEffect(() => {
    let cancelled = false;

    const clearReconnectTimer = () => {
      if (!wsReconnectTimerRef.current) return;
      clearTimeout(wsReconnectTimerRef.current);
      wsReconnectTimerRef.current = null;
    };

    const scheduleReconnect = () => {
      if (cancelled || wsReconnectTimerRef.current) return;
      wsReconnectTimerRef.current = setTimeout(() => {
        wsReconnectTimerRef.current = null;
        if (cancelled) return;
        connect();
      }, WS_RECONNECT_DELAY_MS);
    };

    const connect = () => {
      if (cancelled || hardwareWsRef.current) return;
      try {
        const ws = new WebSocket(HARDWARE_WS_URL);
        hardwareWsRef.current = ws;

        ws.onopen = () => {
          setIsHardwareWifiConnected(true);
        };

        ws.onmessage = (event) => {
          const next = resolveHardwareWifiConnectedFromMessage(event.data);
          if (next != null) {
            setIsHardwareWifiConnected(next);
          }
          const buttons = resolveHardwareButtonsFromMessage(event.data);
          if (!buttons) return;
          const prev = hardwareButtonStateRef.current;
          if (buttons.stop && !prev.stop) {
            DeviceEventEmitter.emit("hardware-stop");
          }
          if (buttons.play && !prev.play) {
            DeviceEventEmitter.emit("hardware-play");
          }
          if (buttons.rec && !prev.rec) {
            DeviceEventEmitter.emit("hardware-rec");
          }
          hardwareButtonStateRef.current = buttons;
        };

        ws.onerror = () => {
          setIsHardwareWifiConnected(false);
        };

        ws.onclose = () => {
          if (hardwareWsRef.current === ws) {
            hardwareWsRef.current = null;
          }
          setIsHardwareWifiConnected(false);
          hardwareButtonStateRef.current = {
            stop: false,
            play: false,
            rec: false,
          };
          scheduleReconnect();
        };
      } catch {
        setIsHardwareWifiConnected(false);
        scheduleReconnect();
      }
    };

    connect();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      const ws = hardwareWsRef.current;
      hardwareWsRef.current = null;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      }
    };
  }, []);

  useEffect(() => {
    const subs: EmitterSubscription[] = [
      DeviceEventEmitter.addListener("hardware-rec", () => {
        handleHardwareRecPress();
      }),
      DeviceEventEmitter.addListener("hardware-play", () => {
        handleHardwarePlayPress();
      }),
      DeviceEventEmitter.addListener("hardware-stop", () => {
        handleHardwareStopPress();
      }),
    ];

    return () => {
      subs.forEach((sub) => sub.remove());
    };
  }, [handleHardwarePlayPress, handleHardwareRecPress, handleHardwareStopPress]);

  useEffect(() => {
    slideX.setValue(activeTab === "rec" ? 0 : -slideWidth);
  }, [activeTab, slideWidth, slideX]);

  useEffect(() => {
    setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
    }).catch(() => {});
    setIsAudioActiveAsync(true).catch(() => {});
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (__DEV__ && !didDevBootResetRecordedDateKey) {
          didDevBootResetRecordedDateKey = true;
          await AsyncStorage.removeItem(RECORDED_DATE_STORAGE_KEY);
        }
        const saved = await AsyncStorage.getItem(RECORDED_DATE_STORAGE_KEY);
        if (!mounted || !saved) return;
        setRecordedDateKey(saved);
      } catch {}
    })();

    return () => {
      mounted = false;
    };
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
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      const current = new Date();
      setNow(current);
      const nextMidnight = new Date(current);
      nextMidnight.setHours(24, 0, 0, 0);
      timeout = setTimeout(
        schedule,
        nextMidnight.getTime() - current.getTime() + 10,
      );
    };

    schedule();

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (recordedDateKey && recordedDateKey !== todayKey) {
      setRecordedDateKey(null);
      AsyncStorage.removeItem(RECORDED_DATE_STORAGE_KEY).catch(() => {});
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
        const player = createAudioPlayer(
          { uri: lastRecordedUri },
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
        recording.stop().catch(() => {});
      }
      unloadSound().catch(() => {});
      stopPushNoticeSound();
    };
  }, [stopPushNoticeSound, unloadSound]);

  const currentSliderValue = isSliding ? sliderMillis : positionMillis;
  const isRecordVisualActive =
    flow === FLOW.RECORD &&
    isRecordPressing &&
    recordStatus === STATUS.RECORDING;
  const isRecordingWarning = isRecording && elapsedMs >= RECORDING_WARNING_MS;
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
    const baseDate = lastRecordedAtMs ? new Date(lastRecordedAtMs) : new Date();
    const deliveryDate = new Date(baseDate);
    deliveryDate.setFullYear(deliveryDate.getFullYear() + 1);
    return `${deliveryDate.getFullYear()}年${deliveryDate.getMonth() + 1}月${deliveryDate.getDate()}日`;
  }, [lastRecordedAtMs]);
  const projectNamePlaceholder = useMemo(() => {
    return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
  }, [now]);

  const guideText =
    flow === FLOW.REVIEW
      ? ""
      : isLockedToday
        ? "本日の録音は完了しています。\n1年後のあなたは、どんな場所にいるかな？"
        : "長押しして録音しましょう";
  const isArchiveTab = activeTab === "archive";
  const isRecIdleNoticeSurface =
    activeTab === "rec" &&
    flow === FLOW.RECORD &&
    !isRecordPressing &&
    !isRecording &&
    !isProjectModalVisible &&
    !isSaveComplete;
  const showUnlockNoticeOverlay =
    isRecIdleNoticeSurface &&
    (!!unlockNoticeCapsule || isDevUnlockPreviewVisible);
  const showPushNotice =
    !isRecIdleNoticeSurface &&
    !!unlockNoticeCapsule &&
    !isDevUnlockPreviewVisible;
  const unlockNoticeMessageDate = useMemo(() => {
    const sourceMs = unlockNoticeCapsule?.unlockAtMs ?? Date.now();
    const d = new Date(sourceMs);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }, [unlockNoticeCapsule]);

  useEffect(() => {
    if (!__DEV__ || Platform.OS !== "web") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key.toLowerCase() !== "r") return;
      setActiveTab("rec");
      setIsDevUnlockPreviewVisible(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const clearPushNoticeTimer = () => {
      if (!pushNoticeHideTimerRef.current) return;
      clearTimeout(pushNoticeHideTimerRef.current);
      pushNoticeHideTimerRef.current = null;
    };

    if (!showPushNotice) {
      clearPushNoticeTimer();
      stopPushNoticeSound();
      pushNoticeTranslateX.stopAnimation();
      pushNoticeOpacity.stopAnimation();
      pushNoticeTranslateX.setValue(72);
      pushNoticeOpacity.setValue(0);
      return;
    }

    void playPushNoticeSound();
    pushNoticeTranslateX.setValue(72);
    pushNoticeOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(pushNoticeTranslateX, {
        toValue: 0,
        duration: PUSH_NOTICE_SLIDE_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(pushNoticeOpacity, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();

    clearPushNoticeTimer();
    pushNoticeHideTimerRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(pushNoticeTranslateX, {
          toValue: 72,
          duration: PUSH_NOTICE_SLIDE_DURATION_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(pushNoticeOpacity, {
          toValue: 0,
          duration: PUSH_NOTICE_SLIDE_DURATION_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    }, PUSH_NOTICE_VISIBLE_MS);

    return () => {
      clearPushNoticeTimer();
    };
  }, [
    playPushNoticeSound,
    pushNoticeOpacity,
    pushNoticeTranslateX,
    showPushNotice,
    stopPushNoticeSound,
  ]);

  useEffect(() => {
    const stopFloating = () => {
      unlockOverlayLetterPulseLoopRef.current?.stop();
      unlockOverlayTouchFloatLoopRef.current?.stop();
      unlockOverlayLetterPulseLoopRef.current = null;
      unlockOverlayTouchFloatLoopRef.current = null;
      unlockOverlayLetterPulseScale.stopAnimation();
      unlockOverlayTouchFloatY.stopAnimation();
      unlockOverlayLetterPulseScale.setValue(1);
      unlockOverlayTouchFloatY.setValue(0);
    };

    const startFloating = () => {
      const letterPulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(unlockOverlayLetterPulseScale, {
            toValue: 1.06,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(unlockOverlayLetterPulseScale, {
            toValue: 1,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      const touchLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(unlockOverlayTouchFloatY, {
            toValue: 10,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(unlockOverlayTouchFloatY, {
            toValue: 0,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      unlockOverlayLetterPulseLoopRef.current = letterPulseLoop;
      unlockOverlayTouchFloatLoopRef.current = touchLoop;
      letterPulseLoop.start();
      touchLoop.start();
    };

    if (!showUnlockNoticeOverlay) {
      unlockOverlayOpacity.stopAnimation();
      unlockOverlayContentTranslateY.stopAnimation();
      unlockOverlayLetterScale.stopAnimation();
      unlockOverlayCloseScale.stopAnimation();
      stopFloating();
      unlockOverlayOpacity.setValue(0);
      unlockOverlayContentTranslateY.setValue(44);
      unlockOverlayLetterScale.setValue(0.8);
      unlockOverlayCloseScale.setValue(0.8);
      return;
    }

    unlockOverlayOpacity.setValue(0);
    unlockOverlayContentTranslateY.setValue(44);
    unlockOverlayLetterScale.setValue(0.8);
    unlockOverlayLetterPulseScale.setValue(1);
    unlockOverlayCloseScale.setValue(0.8);
    Animated.parallel([
      Animated.timing(unlockOverlayOpacity, {
        toValue: 1,
        duration: 620,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(unlockOverlayContentTranslateY, {
        toValue: 0,
        duration: 860,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(unlockOverlayLetterScale, {
        toValue: 1,
        tension: 42,
        friction: 12,
        useNativeDriver: true,
      }),
      Animated.spring(unlockOverlayCloseScale, {
        toValue: 1,
        tension: 42,
        friction: 12,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (!finished) return;
      startFloating();
    });

    return () => {
      stopFloating();
    };
  }, [
    showUnlockNoticeOverlay,
    unlockOverlayCloseScale,
    unlockOverlayContentTranslateY,
    unlockOverlayLetterPulseScale,
    unlockOverlayLetterScale,
    unlockOverlayOpacity,
    unlockOverlayTouchFloatY,
  ]);

  const persistDismissedNoticeIds = useCallback(async () => {
    try {
      const ids = Array.from(dismissedNoticeIdsRef.current);
      await AsyncStorage.setItem(
        DISMISSED_NOTICE_IDS_STORAGE_KEY,
        JSON.stringify(ids),
      );
    } catch {}
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(
          DISMISSED_NOTICE_IDS_STORAGE_KEY,
        );
        if (mounted && raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const ids = parsed.filter(
              (item): item is string =>
                typeof item === "string" && item.length > 0,
            );
            dismissedNoticeIdsRef.current = new Set(ids);
          }
        }
      } catch {}
      if (mounted) {
        setIsDismissedNoticeIdsReady(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const refreshUnlockNotice = useCallback(async () => {
    if (!isDismissedNoticeIdsReady) return;
    const nowMs = Date.now();
    const list = await loadCapsules();
    const unlockedPending = list.filter(
      (item) => item.openedAtMs == null && nowMs >= item.unlockAtMs,
    );
    setHasUnopenedInArchive(unlockedPending.length > 0);
    if (unlockNoticeCapsule) return;
    const next =
      unlockedPending.find(
        (item) => !dismissedNoticeIdsRef.current.has(item.id),
      ) ?? null;
    setUnlockNoticeCapsule(next);
  }, [isDismissedNoticeIdsReady, unlockNoticeCapsule]);

  const closeUnlockNotice = useCallback(async () => {
    if (isDevUnlockPreviewVisible) {
      setIsDevUnlockPreviewVisible(false);
      return;
    }
    if (!unlockNoticeCapsule) return;
    dismissedNoticeIdsRef.current.add(unlockNoticeCapsule.id);
    await persistDismissedNoticeIds();
    setUnlockNoticeCapsule(null);
  }, [
    isDevUnlockPreviewVisible,
    persistDismissedNoticeIds,
    unlockNoticeCapsule,
  ]);

  const openUnlockNoticeCapsule = useCallback(async () => {
    if (isDevUnlockPreviewVisible) {
      setIsDevUnlockPreviewVisible(false);
      return;
    }
    if (!unlockNoticeCapsule) return;
    const capsuleId = unlockNoticeCapsule.id;
    try {
      await updateCapsule(capsuleId, { openedAtMs: Date.now() });
    } catch {}
    dismissedNoticeIdsRef.current.delete(capsuleId);
    await persistDismissedNoticeIds();
    setUnlockNoticeCapsule(null);
    void refreshUnlockNotice();
    router.push({
      pathname: "/record/kaihuu",
      params: { capsuleId, fromUnlockNotice: "1" },
    });
  }, [
    isDevUnlockPreviewVisible,
    persistDismissedNoticeIds,
    refreshUnlockNotice,
    router,
    unlockNoticeCapsule,
  ]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .enabled(
          !(
            activeTab === "rec" &&
            flow === FLOW.RECORD &&
            (isRecordPressing || isRecording)
          ),
        )
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

          if (activeTab === "rec") {
            if (flow === FLOW.RECORD && isLeftSwipe) {
              if (isHardwareWifiConnected) {
                openCassetteMode();
              } else if (!isCassetteConnectPromptVisible) {
                transitionCassetteConnectPrompt(true);
              }
              return;
            }
            if (isRightSwipe && !isCassetteConnectPromptVisible) {
              setActiveTab("archive");
              return;
            }
          }
          if (isRightSwipe && activeTab === "archive") {
            setActiveTab("rec");
          }
        }),
    [
      activeTab,
      flow,
      isCassetteConnectPromptVisible,
      isHardwareWifiConnected,
      isRecordPressing,
      isRecording,
      openCassetteMode,
      transitionCassetteConnectPrompt,
    ],
  );

  useFocusEffect(
    useCallback(() => {
      Keyboard.dismiss();
      void refreshUnlockNotice();
    }, [refreshUnlockNotice]),
  );

  useEffect(() => {
    if (activeTab === "rec") {
      Keyboard.dismiss();
    }
  }, [activeTab]);

  useEffect(() => {
    if (
      flow !== FLOW.RECORD ||
      isRecordPressing ||
      isRecording ||
      isProjectModalVisible ||
      isSaveComplete
    ) {
      return;
    }
    void refreshUnlockNotice();
    const id = setInterval(() => {
      void refreshUnlockNotice();
    }, 1000);
    return () => clearInterval(id);
  }, [
    flow,
    isRecordPressing,
    isRecording,
    isProjectModalVisible,
    isSaveComplete,
    refreshUnlockNotice,
  ]);

  if (isLandscapeViewport) {
    return <View style={styles.orientationTransitionGuard} />;
  }

  return (
    <ImageBackground
      source={
        isArchiveTab
          ? require("../../assets/images/home.png")
          : flow !== FLOW.REVIEW && isLockedToday
            ? require("../../assets/images/norec_background.png")
            : require("../../assets/images/home.png")
      }
      resizeMode="cover"
      style={styles.background}
      imageStyle={{ opacity: 1 }}
    >
      {isArchiveTab ? (
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
      <GestureDetector gesture={panGesture}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.container}>
            <View
              pointerEvents={
                isProjectModalVisible || isSaveComplete ? "none" : "auto"
              }
              style={styles.screenContent}
            >
              {showPushNotice ? (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.pushNoticeWrap,
                    {
                      opacity: pushNoticeOpacity,
                      transform: [{ translateX: pushNoticeTranslateX }],
                    },
                  ]}
                >
                  <View style={styles.pushNoticeInner}>
                    <PushAppBaseSvg width={270} height={82} />
                    <View style={styles.pushNoticeContent}>
                      <Image
                        source={require("../../assets/images/key.png")}
                        style={styles.pushNoticeKeyImage}
                        resizeMode="contain"
                      />
                      <Text
                        style={[
                          styles.pushNoticeText,
                          zenAntiqueSoftLoaded && styles.saveCompleteZenFont,
                        ]}
                      >
                        一年前の音声が届いています
                      </Text>
                    </View>
                  </View>
                </Animated.View>
              ) : null}
              {isCassetteConnectPromptVisible ? (
                <View
                  pointerEvents="none"
                  style={[styles.dimLayer, styles.dimLayerForSaveComplete]}
                />
              ) : null}
              <Animated.View
                pointerEvents={isCassetteFlipAnimating ? "none" : "auto"}
                style={[
                  styles.cassetteFlipLayer,
                  {
                    opacity: cassetteFlipOpacity,
                    transform: [
                      { perspective: 1200 },
                      { translateX: cassetteFlipTranslateX },
                      { rotateY: cassetteFlipRotateY },
                      { scale: cassetteFlipScale },
                    ],
                  },
                ]}
              >
                <View style={styles.topArea}>
                {flow === FLOW.RECORD &&
                activeTab === "rec" &&
                !isCassetteConnectPromptVisible ? (
                  <Pressable
                    onPress={() => {
                      if (isHardwareWifiConnected) {
                        openCassetteMode();
                      } else {
                        transitionCassetteConnectPrompt(true);
                      }
                    }}
                    hitSlop={10}
                    style={styles.cassetteTopButton}
                  >
                    <CassetteButtonSvg
                      width={styles.cassetteTopButtonIcon.width}
                      height={styles.cassetteTopButtonIcon.height}
                      style={styles.cassetteTopButtonIcon}
                    />
                  </Pressable>
                ) : null}
                {flow === FLOW.RECORD &&
                activeTab === "rec" &&
                isCassetteConnectPromptVisible ? (
                  <Pressable
                    onPress={() => transitionCassetteConnectPrompt(false)}
                    hitSlop={10}
                    style={styles.smartphoneTopButton}
                  >
                    <SmartphoneBackSvg
                      width={styles.smartphoneTopButtonBg.width}
                      height={styles.smartphoneTopButtonBg.height}
                      style={styles.smartphoneTopButtonBg}
                    />
                  </Pressable>
                ) : null}
                {flow === FLOW.REVIEW && activeTab === "rec" ? (
                  <View style={styles.retakeTopRow}>
                    <Pressable
                      onPress={retakeRecording}
                      hitSlop={10}
                      style={styles.retakeTopButton}
                    >
                      <Text style={styles.retakeTopLabel}>撮り直す</Text>
                      <Text style={styles.retakeTopArrow}>←</Text>
                    </Pressable>
                  </View>
                ) : null}

                {!isCassetteConnectPromptVisible ? (
                  <RecordToolbar
                    active={activeTab}
                    onPressRec={() => setActiveTab("rec")}
                    onPressArchive={() => setActiveTab("archive")}
                    hasUnopenedInArchive={hasUnopenedInArchive}
                  />
                ) : null}
              </View>

              <View
                style={styles.slideViewport}
                onLayout={(e) => setSlideWidth(e.nativeEvent.layout.width)}
              >
                <Animated.View
                  style={[
                    styles.slideTrack,
                    { width: slideWidth * 2 },
                    {
                      transform: [{ translateX: slideX }],
                    },
                  ]}
                >
                  <View style={[styles.slidePane, { width: slideWidth }]}>
                    {!isCassetteConnectPromptVisible ? (
                      <Text style={styles.dateText}>
                        {formatDisplayDate(now)}
                      </Text>
                    ) : null}

                    <View style={styles.centerArea}>
                      {flow === FLOW.RECORD ? (
                        isCassetteConnectPromptVisible ? (
                          <View style={styles.connectionGuideLayer}>
                            <ScrollView
                              style={styles.connectionGuideScroll}
                              contentContainerStyle={
                                styles.connectionGuideScrollContent
                              }
                              showsVerticalScrollIndicator={false}
                            >
                              <View style={styles.connectionGuideCard}>
                                <Text style={styles.connectionGuideMessage}>
                                  カセットレコーダー{"\n"}接続しましょう
                                </Text>
                              </View>
                              <View style={styles.connectionGuideActions}>
                                <Pressable
                                  onPress={() => {
                                    void openWifiSettings();
                                  }}
                                  style={styles.connectionGuidePrimaryAction}
                                  hitSlop={8}
                                >
                                  <Text style={styles.connectionGuidePrimaryText}>
                                    設定を開く
                                  </Text>
                                </Pressable>
                                <Pressable
                                  style={styles.connectionGuideHelpAction}
                                >
                                  <Text style={styles.connectionGuideHelpText}>
                                    接続方法
                                  </Text>
                                </Pressable>
                                <View style={styles.connectionGuideBottomCard}>
                                  <Text style={styles.connectionGuideBottomText}>
                                    1. カセットレコーダーの電源を{"\n"}いれます
                                    {"\n\n"}
                                    2. 「設定」アプリで
                                    {"\n"}
                                    「_echocapsule_dev」を選ぶ
                                    {"\n\n"}
                                    3. パスワードを入れる
                                  </Text>
                                </View>
                              </View>
                            </ScrollView>
                          </View>
                        ) : (
                          <View style={styles.flowLayer}>
                            <View
                              style={[
                                styles.recordGroup,
                                { marginTop: RECORD_BUTTON_OFFSET_Y },
                              ]}
                            >
                              <Animated.View
                                style={[
                                  styles.buttonWrap,
                                  isRecordVisualActive && styles.recordingGlow,
                                  { transform: [{ scale: pulse }] },
                                ]}
                              >
                                <Pressable
                                  style={styles.buttonPressable}
                                  onPressIn={() => {
                                    setIsRecordPressing(true);
                                    void startRecording();
                                  }}
                                  onPressOut={handleRecordPressOut}
                                  pressRetentionOffset={{
                                    top: 10000,
                                    left: 10000,
                                    right: 10000,
                                    bottom: 10000,
                                  }}
                                  hitSlop={12}
                                  disabled={isLockedToday}
                                >
                                  <Image
                                    source={
                                      isLockedToday
                                        ? require("../../assets/images/norecButton.png")
                                        : isRecordVisualActive
                                          ? require("../../assets/images/onrec.png")
                                          : require("../../assets/images/home_voiceButton.png")
                                    }
                                    style={[
                                      styles.voiceButton,
                                      isLockedToday && styles.voiceButtonDisabled,
                                      isLockedToday && {
                                        transform: [
                                          { translateY: NOREC_BUTTON_NUDGE_Y },
                                        ],
                                      },
                                      { tintColor: undefined },
                                    ]}
                                    resizeMode="contain"
                                  />
                                </Pressable>
                              </Animated.View>
                              {!isLockedToday ? (
                                <Text
                                  style={[
                                    styles.recordTimeText,
                                    isRecordingWarning &&
                                      styles.recordTimeTextWarning,
                                  ]}
                                >
                                  {formatMillis(elapsedMs)}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        )
                      ) : (
                        <View style={styles.flowLayer}>
                          <View
                            style={[
                              styles.playerGroup,
                              { marginTop: REVIEW_BUTTON_OFFSET_Y },
                            ]}
                          >
                            <Pressable
                              onPress={togglePlay}
                              style={[
                                styles.playerButton,
                                !isLoaded && styles.disabled,
                              ]}
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
                        </View>
                      )}
                    </View>

                    <View style={styles.bottomArea}>
                      {flow === FLOW.REVIEW ? (
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
                              maximumValue={Math.max(durationMillis, 1)}
                              onSlidingStart={onSlidingStart}
                              onValueChange={onSliderValueChange}
                              onSlidingComplete={onSlidingComplete}
                              tapToSeek
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
                                  left: Math.max(
                                    0,
                                    Math.min(sliderWidth - 10, thumbLeft - 5),
                                  ),
                                },
                              ]}
                            />
                          </View>
                        </View>
                      ) : null}

                      {flow === FLOW.REVIEW ? (
                        <Pressable
                          style={styles.okButton}
                          onPress={
                            isSaveComplete
                              ? saveProjectAndBack
                              : openProjectModal
                          }
                        >
                          <Text style={styles.okText}>O K</Text>
                        </Pressable>
                      ) : null}
                    </View>

                    {activeTab === "rec" &&
                    flow === FLOW.RECORD &&
                    !isCassetteConnectPromptVisible ? (
                      <Text style={styles.recordGuideText}>{guideText}</Text>
                    ) : null}
                  </View>

                  <View style={[styles.slidePane, { width: slideWidth }]}>
                    <ArchiveContent
                      embedded
                      onPressRec={() => setActiveTab("rec")}
                    />
                  </View>
                </Animated.View>
                </View>
              </Animated.View>
            </View>

            {(isProjectModalVisible ||
              isSaveComplete ||
              showUnlockNoticeOverlay) && (
              <>
                {isSaveComplete ? (
                  <BlurView
                    pointerEvents="none"
                    intensity={5}
                    tint="light"
                    style={styles.saveCompleteBlurLayer}
                  />
                ) : null}
                <View
                  style={[
                    styles.dimLayer,
                    isSaveComplete && styles.dimLayerForSaveComplete,
                  ]}
                />
              </>
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
                    を保管しました。
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
                <Pressable
                  style={styles.modalBackdropPressArea}
                  onPress={closeProjectModal}
                />
                <View style={styles.modalCard}>
                  <Text style={styles.modalTitle}>テープ名</Text>
                  <View style={styles.inputWrap}>
                    <TextInput
                      value={projectName}
                      onChangeText={setProjectName}
                      placeholder={projectNamePlaceholder}
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
            {showUnlockNoticeOverlay ? (
              <Animated.View
                style={[
                  styles.unlockOverlay,
                  { opacity: unlockOverlayOpacity },
                ]}
              >
                <View
                  pointerEvents="none"
                  style={styles.unlockOverlayBackgroundImage}
                >
                  <Image
                    source={LETTER_BACKGROUND_IMAGE}
                    style={styles.unlockOverlayBackgroundImageFill}
                    resizeMode="stretch"
                  />
                </View>
                <Animated.View
                  style={[
                    styles.unlockOverlayTop,
                    {
                      transform: [
                        { translateY: unlockOverlayContentTranslateY },
                        { scale: unlockOverlayCloseScale },
                      ],
                    },
                  ]}
                >
                  <Pressable
                    onPress={closeUnlockNotice}
                    hitSlop={20}
                    style={styles.unlockOverlayCloseButton}
                  >
                    <Text style={styles.unlockOverlayCloseIcon}>×</Text>
                    <Text
                      style={[
                        styles.unlockOverlayCloseLabel,
                        zenAntiqueSoftLoaded && styles.saveCompleteZenFont,
                      ]}
                    >
                      閉じる
                    </Text>
                  </Pressable>
                </Animated.View>
                <Animated.View
                  style={[
                    styles.unlockOverlayContent,
                    {
                      transform: [
                        { translateY: unlockOverlayContentTranslateY },
                      ],
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.unlockOverlayMessage,
                      zenAntiqueSoftLoaded && styles.saveCompleteZenFont,
                    ]}
                  >
                    {`${unlockNoticeMessageDate}のあなたのカプセルを開封できます。`}
                  </Text>
                  <Pressable
                    onPress={() => {
                      void openUnlockNoticeCapsule();
                    }}
                    style={styles.unlockOverlayLetterButton}
                    hitSlop={10}
                  >
                    <Animated.Image
                      source={LETTER_IMAGE}
                      style={[
                        styles.unlockOverlayLetterImage,
                        {
                          transform: [
                            { scale: unlockOverlayLetterScale },
                            { scale: unlockOverlayLetterPulseScale },
                          ],
                        },
                      ]}
                      resizeMode="contain"
                    />
                  </Pressable>
                  <Animated.View
                    style={{
                      transform: [{ translateY: unlockOverlayTouchFloatY }],
                    }}
                  >
                    <TouchSvg
                      width={styles.unlockOverlayTouchImage.width}
                      height={styles.unlockOverlayTouchImage.height}
                      style={styles.unlockOverlayTouchImage}
                    />
                  </Animated.View>
                </Animated.View>
              </Animated.View>
            ) : null}
          </View>
        </SafeAreaView>
      </GestureDetector>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: "#000" },
  orientationTransitionGuard: { flex: 1, backgroundColor: "#000" },
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
  cassetteFlipLayer: {
    flex: 1,
    width: "100%",
  },
  pushNoticeWrap: {
    position: "absolute",
    top: -10,
    right: -10,
    zIndex: 18,
    elevation: 18,
  },
  pushNoticeInner: {
    width: 244,
    height: 82,
    justifyContent: "center",
  },
  pushNoticeContent: {
    position: "absolute",
    left: 34,
    right: 14,
    top: 10,
    bottom: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  pushNoticeKeyImage: {
    width: 20,
    height: 20,
    marginRight: 8,
    marginTop: -1,
  },
  pushNoticeText: {
    color: "#121216",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  topArea: { width: "100%", alignItems: "center", paddingTop: 26 },
  cassetteTopButton: {
    position: "absolute",
    top: -10,
    left: -16,
    width: 84,
    height: 84,
    zIndex: 20,
    elevation: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  cassetteTopButtonIcon: {
    width: 82,
    height: 84,
  },
  smartphoneTopButton: {
    position: "absolute",
    top: -10,
    right: -12,
    width: 84,
    height: 84,
    zIndex: 20,
    elevation: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  smartphoneTopButtonBg: {
    width: 82,
    height: 84,
  },
  slideViewport: {
    flex: 1,
    width: "100%",
    marginLeft: 0,
    overflow: "hidden",
  },
  slideTrack: {
    flex: 1,
    flexDirection: "row",
  },
  slidePane: {
    flex: 1,
    paddingHorizontal: 0,
  },

  dateText: {
    marginTop: 38,
    fontSize: 15,
    fontWeight: "600",
    color: "#767680",
    letterSpacing: 0.2,
    alignSelf: "center",
  },
  centerArea: {
    flex: 1,
    width: "100%",
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  flowLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  connectionGuideLayer: {
    width: "100%",
    flex: 1,
    alignSelf: "stretch",
  },
  connectionGuideScroll: {
    width: "100%",
    flex: 1,
  },
  connectionGuideScrollContent: {
    alignItems: "center",
    paddingTop: 82,
    paddingBottom: 0,
  },
  connectionGuideActions: {
    width: "100%",
    alignItems: "center",
  },
  connectionGuideCard: {
    width: "90%",
    maxWidth: 350,
    borderRadius: 30,
    minHeight: 170,
    backgroundColor: "rgba(249, 249, 251, 0.88)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    marginBottom: 24,
    marginTop:150,
  },
  connectionGuideMessage: {
    color: "#17171a",
    fontSize: 22,
   
    textAlign: "center",
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  connectionGuidePrimaryAction: {
    marginTop: 39,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  connectionGuidePrimaryText: {
    color: "#2d6fdf",
    fontSize: 20,
    lineHeight: 20,
    textDecorationLine: "underline",
    fontWeight: "700",
  },
  connectionGuideHintText: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 16,
    color: "#5f6270",
    textAlign: "center",
  },
  connectionGuideHelpAction: {
    marginTop: 100,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  connectionGuideHelpText: {
    color: "#1e1f24",
    fontSize: 20,
    lineHeight: 22,
    fontWeight: "700",
  },
  connectionGuideBottomCard: {
    marginTop: 8,
    width: "90%",
    maxWidth: 350,
    minHeight: 274,
    borderRadius: 30,
    backgroundColor: "rgba(249, 249, 251, 0.9)",
    paddingHorizontal: 26,
    paddingVertical: 30,
  },
  connectionGuideBottomText: {
    color: "#17171a",
    fontSize: 17,
    lineHeight: 41,
    fontWeight: "700",
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
  voiceButtonDisabled: { opacity: 0.9 },
  recordTimeText: {
    marginTop: 20,
    fontSize: 12,
    fontWeight: "600",
    color: "#767680",
    letterSpacing: 0.2,
  },
  recordTimeTextWarning: {
    color: "#d83a3a",
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

  retakeTopRow: {
    position: "absolute",
    top: 8,
    left: 8,
    alignItems: "flex-start",
    zIndex: 20,
    elevation: 20,
  },
  retakeTopButton: {
    width: 62,
    alignItems: "flex-start",
    paddingVertical: 2,
  },
  retakeTopLabel: {
    color: "#1f1f24",
    fontSize: 10,
    letterSpacing: 0.2,
    marginBottom: 0,
    fontWeight: "500",
  },
  retakeTopArrow: {
    color: "#1f1f24",
    fontSize: 30,

    lineHeight: 30,
    marginTop: 2,
    marginLeft: 4,
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
    left: 0,
    right: 0,
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
  dimLayerForSaveComplete: {
    backgroundColor: "rgba(232, 232, 232, 0.68)",
  },
  saveCompleteBlurLayer: {
    position: "absolute",
    left: -40,
    right: -40,
    top: -120,
    bottom: -120,
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
  unlockOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 45,
    elevation: 45,
    backgroundColor: "transparent",
  },
  unlockOverlayBackgroundImage: {
    position: "absolute",
    top: -60,
    right: 0,
    bottom: -120,
    left: 0,
    zIndex: 0,
  },
  unlockOverlayBackgroundImageFill: {
    width: "100%",
    height: "100%",
  },
  unlockOverlayTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 22,
    paddingHorizontal: 10,
    zIndex: 5,
    elevation: 60,
  },
  unlockOverlayCloseButton: {
    alignSelf: "flex-start",
    minWidth: 120,
    minHeight: 120,
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: "flex-start",
  },
  unlockOverlayCloseIcon: {
    color: "#111111",
    fontSize: 40,
    lineHeight: 40,
    marginLeft: 18,
    marginTop: -27,
  },
  unlockOverlayCloseLabel: {
    color: "#111111",
    fontSize: 15,
    marginTop: -8,
    marginLeft: 10,
  },
  unlockOverlayContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    marginTop: -20,
    zIndex: 1,
  },
  unlockOverlayMessage: {
    color: "#000000",
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: -10,
  },
  unlockOverlayLetterButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  unlockOverlayLetterImage: {
    width: 250,
    height: 250,
  },
  unlockOverlayTouchImage: {
    marginTop: -50,
    width: 132,
    height: 98,
  },
});

