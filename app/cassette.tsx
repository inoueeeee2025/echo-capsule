import {
  addCapsule,
  buildDefaultTitle,
  loadCapsules,
  updateCapsule,
} from "@/src/capsules/storage";
import { hardwareWS, type HardwareState } from "@/src/hardware/ws";
import { computeUnlockAtMs, MAX_RECORDING_MS } from "@/src/config";
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
import { Asset } from "expo-asset";
import { BlurView } from "expo-blur";
import { useFonts } from "expo-font";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
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
const PROJECT_SWIPE_THRESHOLD = 28;
// カセットに貼る名札。実物のラベルのように、リールの間に収まる大きさにする。
// 幅と高さは自由に変えてよい。文字の傾きと縦位置は下で自動的に追従する。
const TAPE_LABEL_WIDTH = 300;
const TAPE_LABEL_HEIGHT = 90;
const TAPE_LABEL_FONT_SIZE = 25;
// カセット上での貼り位置（デザイン座標 852x393 のなかでの左上）
const TAPE_LABEL_LEFT = 215;
const TAPE_LABEL_TOP = 140;

// --- ここから下は maskingTape.png の実測値。画像を差し替えない限り触らない ---
const TAPE_IMAGE_WIDTH = 267;
const TAPE_IMAGE_HEIGHT = 75;
// 画像に焼き込まれている傾き（帯の中心線を最小二乗で当てた値）。
const TAPE_IMAGE_TILT_DEG = 5.06;
// 帯の中心は画像の中心より上にある。透明な余白が下側に多いため。
// 文字を枠の中央に置くと、この分だけテープより下に浮く
const TAPE_IMAGE_CENTER_OFFSET_Y = -4.19;

// resizeMode="stretch" は縦横を別々に伸ばすので、伸び方が違うと
// 焼き込まれた傾きも変わる。縦に強く伸ばせば急に、横に伸ばせば緩くなる。
// 実際に描かれている傾きを、指定した幅と高さから逆算する。
const TAPE_STRETCH_X = TAPE_LABEL_WIDTH / TAPE_IMAGE_WIDTH;
const TAPE_STRETCH_Y = TAPE_LABEL_HEIGHT / TAPE_IMAGE_HEIGHT;
const TAPE_LABEL_TILT_DEG =
  (Math.atan(
    Math.tan((TAPE_IMAGE_TILT_DEG * Math.PI) / 180) *
      (TAPE_STRETCH_Y / TAPE_STRETCH_X),
  ) *
    180) /
  Math.PI;
// 帯の中心へ文字を寄せる量。高さを変えれば同じ割合でずれるので連動させる。
const TAPE_LABEL_TEXT_OFFSET_Y = TAPE_IMAGE_CENTER_OFFSET_Y * TAPE_STRETCH_Y;
const PROJECT_SLIDE_OUT_MS = 170;
const PROJECT_SLIDE_SWAP_MS = 40;
const ARRIVAL_SOUND_FILE = require("../assets/soun/決定ボタンを押す40.mp3");
const ARRIVAL_SOUND_CLEANUP_MS = 1200;
// これより短い録音は中身がほとんど無く、再生しても何も聞こえない。
// 押した瞬間に離れた場合などに起きるので、預からずに弾く。
const MIN_RECORDING_MS = 1000;
const SAVED_NOTICE_FADE_MS = 260;
const SAVED_NOTICE_HOLD_MS = 1600;
const AnimatedImageBackground = Animated.createAnimatedComponent(ImageBackground);

type PlayableCapsule = {
  id: string;
  audioUri: string;
  title: string;
  recordedAtMs: number | null;
};

function formatDuration(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const m = String(Math.floor(safe / 60)).padStart(2, "0");
  const sec = String(safe % 60).padStart(2, "0");
  return `${m}:${sec}`;
}

function normalizeSpinProgress(value: number) {
  return ((value % 1) + 1) % 1;
}

/** テープに名前を書いた札。カセットにラベルを貼った見立て。 */
function TapeLabel({
  title,
  scale,
  fontReady,
}: {
  title: string;
  scale: number;
  fontReady: boolean;
}) {
  return (
    <View
      style={[
        styles.tapeLabel,
        { width: TAPE_LABEL_WIDTH * scale, height: TAPE_LABEL_HEIGHT * scale },
      ]}
    >
      <Image
        source={require("../assets/images/maskingTape.png")}
        resizeMode="stretch"
        style={styles.tapeLabelImage}
      />
      {/*
        傾きは Text ではなく View に掛ける。
        Text に transform を書いても実機では無視され、文字だけ水平のまま残る。
      */}
      <View
        style={[
          styles.tapeLabelRotator,
          {
            transform: [
              // 枠の中央ではなく、帯の中央に乗せる
              { translateY: TAPE_LABEL_TEXT_OFFSET_Y * scale },
              { rotate: `${TAPE_LABEL_TILT_DEG.toFixed(2)}deg` },
            ],
          },
        ]}
      >
        <Text
          numberOfLines={1}
          // 長い名前でもテープから溢れないよう、収まるまで縮める
          adjustsFontSizeToFit
          minimumFontScale={0.55}
          style={[
            styles.tapeLabelText,
            fontReady && styles.tapeLabelTextFont,
            { fontSize: TAPE_LABEL_FONT_SIZE * scale },
          ]}
        >
          {title}
        </Text>
      </View>
    </View>
  );
}

export default function CassetteScreen() {
  const [zenLoaded] = useFonts({ ZenAntiqueSoft_400Regular });
  // 名札の手書き文字だけに使う
  const [crayonLoaded] = useFonts({
    Crayon: require("../assets/fonts/crayon.ttf"),
  });
  const router = useRouter();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscapeViewport = windowWidth > windowHeight;
  const params = useLocalSearchParams<{
    capsuleId?: string;
    showArrivalIntro?: string;
    autoRecord?: string;
  }>();
  const [isPlaying, setIsPlaying] = useState(false);
  // ハードの REC で録音している最中か。
  // 実物のデッキと同じく録音中もテープは回る。
  // これが無いと、画面上は待機中とまったく区別がつかなかった。
  const [isCassetteRecording, setIsCassetteRecording] = useState(false);
  // カセットモードで出す短い知らせ。
  // 「◯◯ として保存しました」と「◯◯ が届きました」の2種類を同じ見た目で出す。
  const [notice, setNotice] = useState<{
    title: string;
    caption: string;
  } | null>(null);
  // 録り終えたが、まだ保管していない録音。
  // 聞き直して決めてもらうあいだ、ここで預かる。
  const [pendingRecording, setPendingRecording] = useState<{
    uri: string;
    recordedAtMs: number;
    durationSec: number;
  } | null>(null);
  const [playableCapsules, setPlayableCapsules] = useState<PlayableCapsule[]>(
    [],
  );
  const [activeCapsuleIndex, setActiveCapsuleIndex] = useState(0);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [activeCapsuleId, setActiveCapsuleId] = useState<string>("");
  const [activeCapsuleTitle, setActiveCapsuleTitle] = useState("");
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const rotateProgress = useRef(new Animated.Value(0)).current;
  const pageSlideX = useRef(new Animated.Value(0)).current;
  const savedNoticeOpacity = useRef(new Animated.Value(0)).current;
  const isProjectSlideTransitioningRef = useRef(false);
  const moveActiveCapsuleByRef = useRef<(delta: number) => void>(() => {});
  const progressRef = useRef(0);
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const playbackSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const shouldPlayFromHardwareRef = useRef(false);
  const isPlayingRef = useRef(false);
  const recordingRef = useRef<AudioRecorder | null>(null);
  const recordingStartRef = useRef(0);
  const isHardwareRecordingRef = useRef(false);
  // ハードの REC が押されている間だけ true。
  // startCassetteRecording は非同期なので、準備が終わる頃には
  // 既に離されていることがある。その取りこぼしを検出するために使う。
  const isRecPressedRef = useRef(false);
  // 押しっぱなし放置に備えた自動停止タイマー。
  const maxRecordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const prevHardwareStateRef = useRef<HardwareState>({
    stop: false,
    play: false,
    rec: false,
  });
  const hasAppliedRequestedCapsuleRef = useRef(false);
  // すでに把握しているカプセル。ここに無いものが解禁されたら「届いた」と見なす。
  const knownCapsuleIdsRef = useRef<Set<string>>(new Set());
  const hasSeededKnownCapsulesRef = useRef(false);
  const arrivalSoundRef = useRef<AudioPlayer | null>(null);
  const arrivalSoundCleanupTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const requestedCapsuleId =
    typeof params.capsuleId === "string" ? params.capsuleId : "";
  // 録音のために飛んできたかどうか。
  // 同じ画面に戻る場合も録音を始められるよう、呼ぶ側は毎回違う値を渡してくる。
  const autoRecordToken =
    typeof params.autoRecord === "string" ? params.autoRecord : "";

  const uiScale = useMemo(() => {
    const byWidth = windowWidth / DESIGN_WIDTH;
    const byHeight = windowHeight / DESIGN_HEIGHT;
    return Math.min(byWidth, byHeight);
  }, [windowHeight, windowWidth]);

  // 確認待ちのあいだは、保管済みのカプセルではなく預かっている録音を鳴らす。
  const activeAudioUri = pendingRecording?.uri ?? audioUri;

  const boardWidth = DESIGN_WIDTH * uiScale;
  const boardLeft = Math.max(0, (windowWidth - boardWidth) / 2);

  // 描画のたびに即座に反映する。useEffect だと1フレーム遅れ、
  // ボタンを押した瞬間の判定がずれることがある。
  isPlayingRef.current = isPlaying;

  // 回転ループの継続判定で使う（コールバックの中から最新値を見るため）
  const shouldSpinRef = useRef(false);
  // 確認待ちかどうか。WebSocket のコールバックから最新値を見る必要がある。
  const isReviewingRef = useRef(false);
  isReviewingRef.current = pendingRecording !== null;

  const onPlaybackStatusUpdate = useCallback((status: AudioStatus) => {
    if (!status.isLoaded) {
      setIsPlaying(false);
      return;
    }
    // 再生位置が進んでいるかを見る。進んでいるのに聞こえないなら
    // 出口（消音スイッチ・音量）側の問題になる。
    if (status.playing) {
      console.log(
        `[CAS] status playing=${status.playing}` +
          ` t=${status.currentTime?.toFixed(1)}/${status.duration?.toFixed(1)}`,
      );
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
  }, [activeCapsuleIndex, playableCapsules]);

  const clearMaxRecordingTimeout = useCallback(() => {
    if (!maxRecordingTimeoutRef.current) return;
    clearTimeout(maxRecordingTimeoutRef.current);
    maxRecordingTimeoutRef.current = null;
  }, []);

  /**
   * 始まってしまった録音を、保存せずに畳む。
   * REC の準備が終わる前にボタンが離された場合に使う。
   */
  const abortCassetteRecording = useCallback(async () => {
    console.log("[CAS] 録音を畳む（短すぎる・押し損ね）");
    clearMaxRecordingTimeout();
    const recording = recordingRef.current;
    recordingRef.current = null;
    isHardwareRecordingRef.current = false;
    setIsCassetteRecording(false);
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
  }, [clearMaxRecordingTimeout]);

  const stopCassetteRecording = useCallback(async () => {
    clearMaxRecordingTimeout();
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording) {
      // ここを通ると録音中フラグが降りないまま残る。
      // 次の録音が門前払いされる原因になりうるので、必ず降ろしておく。
      console.log("[CAS] 停止しようとしたが、録音が動いていなかった");
      isHardwareRecordingRef.current = false;
      setIsCassetteRecording(false);
      return null;
    }

    try {
      await recording.stop();
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
      const uri = recording.getStatus().url;
      if (!uri) {
        console.log("[CAS] stop: url が空だった");
        return null;
      }

      const recordedAtMs = Date.now();
      const elapsedMs = Date.now() - recordingStartRef.current;

      if (elapsedMs < MIN_RECORDING_MS) {
        console.log(`[CAS] 短すぎるので破棄 ${elapsedMs}ms uri=${uri}`);
        setNotice({ title: "短すぎました", caption: "もう一度録音してください" });
        return null;
      }

      const durationSec = Math.max(1, Math.round(elapsedMs / 1000));

      // ここでは保存しない。聞き直して決めてもらうため、いったん預かる。
      console.log(`[CAS] recorded ${durationSec}s (${elapsedMs}ms) uri=${uri}`);
      setPendingRecording({ uri, recordedAtMs, durationSec });
      return uri;
    } catch (error) {
      console.log("[CAS] 録音の停止に失敗", error);
      return null;
    } finally {
      isHardwareRecordingRef.current = false;
      setIsCassetteRecording(false);
    }
  }, [clearMaxRecordingTimeout]);

  // 確認画面で「決定」されたとき。ここで初めて保管する。
  const confirmPendingRecording = useCallback(async () => {
    if (!pendingRecording) return;

    const { uri, recordedAtMs, durationSec } = pendingRecording;
    // 待ち時間の起点は保管した瞬間。録音した時刻から数えると、
    // 聞き直していた時間のぶんだけ早く届いてしまう。
    const storedAtMs = Date.now();
    const title = await buildDefaultTitle(recordedAtMs);

    await addCapsule({
      id: `capsule-${recordedAtMs}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      audioUri: uri,
      durationSec,
      recordedAtMs,
      unlockAtMs: computeUnlockAtMs(storedAtMs),
      openedAtMs: null,
      hasTranscript: false,
    });

    await unloadSound();
    setPendingRecording(null);
    setNotice({ title, caption: "として保存しました" });
  }, [pendingRecording, unloadSound]);

  const startCassetteRecording = useCallback(async () => {
    // 無言で抜けると「押しても何も起きない」に見えてしまうので、
    // 抜けた理由を必ず残す。
    if (isHardwareRecordingRef.current) {
      console.log("[CAS] 録音を開始できない: 前の録音がまだ終わっていない扱い");
      return;
    }

    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        console.log("[CAS] 録音を開始できない: マイクの許可がない");
        return;
      }
      console.log("[CAS] 録音を開始する");

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
      setIsCassetteRecording(true);

      // REC を押しっぱなしのまま放置されても止まるようにする。
      // rec 画面と違い、ここには上限がなかった。
      clearMaxRecordingTimeout();
      maxRecordingTimeoutRef.current = setTimeout(() => {
        maxRecordingTimeoutRef.current = null;
        void stopCassetteRecording();
      }, MAX_RECORDING_MS);

      // 準備を待っている間に REC が離されていた場合、停止処理は
      // 「まだ録音していない」と判断して素通りしている。ここで畳む。
      if (!isRecPressedRef.current) {
        await abortCassetteRecording();
      }
    } catch (error) {
      console.log("[CAS] 録音の開始に失敗", error);
      isHardwareRecordingRef.current = false;
      setIsCassetteRecording(false);
    }
  }, [
    abortCassetteRecording,
    clearMaxRecordingTimeout,
    recorder,
    stopCassetteRecording,
    unloadSound,
  ]);

  // カプセルの送り。
  //
  // 以前は「出す」だけを行い、戻すのは登場演出の完了を待っていた。
  // そのため演出を出さない場面では画面がずれたまま戻らず、
  // 音だけ鳴って表示が真っ白になっていた。
  // 演出と切り離し、スライドは自力で往復させる。
  // カプセルの送り。
  //
  // 以前は「横に出す → 中身を差し替える → 横から入れる」の2段構えで、
  // 折り返しで一度止まるため途切れて見えていた。
  // 出したまま中身を差し替え、同じ勢いのまま入れてくることで
  // 1回のまとまった動きに見せる。
  const moveActiveCapsuleBy = useCallback(
    (delta: number) => {
      if (!isLandscapeViewport) return;
      if (isReviewingRef.current) return;
      if (playableCapsules.length <= 1) return;
      if (isProjectSlideTransitioningRef.current) return;

      const next = activeCapsuleIndex + delta;
      if (next < 0 || next > playableCapsules.length - 1) return;

      isProjectSlideTransitioningRef.current = true;
      const outTo = delta > 0 ? -windowWidth : windowWidth;

      pageSlideX.stopAnimation();
      Animated.sequence([
        // 出ていくときは加速。止まる感じを出さない。
        Animated.timing(pageSlideX, {
          toValue: outTo,
          duration: PROJECT_SLIDE_OUT_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        // 差し替えのための待ち。0 だと描画が間に合わず一瞬ちらつく。
        Animated.delay(PROJECT_SLIDE_SWAP_MS),
        // 入ってくるときは減速。行き過ぎてから戻る動きで勢いを残す。
        Animated.spring(pageSlideX, {
          toValue: 0,
          damping: 22,
          stiffness: 190,
          mass: 0.9,
          useNativeDriver: true,
        }),
      ]).start(() => {
        isProjectSlideTransitioningRef.current = false;
      });

      // 画面の外に出きったところで中身を差し替える。
      setTimeout(() => {
        pageSlideX.setValue(-outTo);
        setActiveCapsuleIndex(next);
      }, PROJECT_SLIDE_OUT_MS);
    },
    [
      activeCapsuleIndex,
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

  // ハードの PLAY / STOP ボタンから呼ばれる再生・停止の入口。
  const handleHardwarePlaybackChange = useCallback((next: boolean) => {
    console.log(`[CAS] play=${next} player=${playerRef.current ? "あり" : "なし"}`);
    shouldPlayFromHardwareRef.current = next;
    const player = playerRef.current;
    if (!player) {
      setIsPlaying(next);
      return;
    }
    try {
      if (next) {
        // 最後まで鳴らし終わった状態で押された場合、頭に戻さないと無反応になる
        const status = player.currentStatus;
        const duration = status?.duration ?? 0;
        const currentTime = status?.currentTime ?? 0;
        if (duration > 0 && currentTime >= duration - 0.25) {
          void player.seekTo(0);
        }
        player.play();
        setIsPlaying(true);
      } else {
        player.pause();
        setIsPlaying(false);
      }
    } catch {}
  }, []);

  // PLAY を押したときの切り替え。
  // state の反映を待たず、プレイヤーの実際の状態を見て決める。
  const toggleHardwarePlayback = useCallback(() => {
    const player = playerRef.current;
    const playing = player?.currentStatus?.playing ?? isPlayingRef.current;
    handleHardwarePlaybackChange(!playing);
  }, [handleHardwarePlaybackChange]);

  // 表示中のときだけボタンを受け取る。
  // useEffect のままだと、裏に残っている録音画面と二重に反応してしまう。
  useFocusEffect(
    useCallback(() => {
    hardwareWS.connect();

    // 画面を離れているあいだのボタン操作は受け取れていない。
    // 前回値が古いままだと、戻ってきて最初の1回が
    // 「変化なし」と判断されて無視される。今の状態を起点にする。
    prevHardwareStateRef.current = hardwareWS.getLastState();

    const unsub = hardwareWS.subscribe((s) => {
      const prev = prevHardwareStateRef.current;
      console.log(
        `[CAS] btn stop=${s.stop} play=${s.play} rec=${s.rec}` +
          ` | recording=${isHardwareRecordingRef.current}` +
          ` pressed=${isRecPressedRef.current}` +
          ` reviewing=${isReviewingRef.current}`,
      );
      const playDown = s.play && !prev.play;
      const recDown = s.rec && !prev.rec;
      const recUp = !s.rec && prev.rec;
      const stopDown = s.stop && !prev.stop;

      // 録音中は「止める」だけを受け付ける。
      //
      // REC は固定式で、他のボタンを押すと機械的に上がる。
      // つまり PLAY でも STOP でも rec:false が届くので、
      // 「REC が上がったら止まる」で意図どおりになる。
      if (isRecPressedRef.current || isHardwareRecordingRef.current) {
        if (recUp || stopDown) {
          isRecPressedRef.current = false;

          // PLAY で止めた場合、その押下は停止に使われて消える。
          // PLAY は固定式なので押し直せず、聞けなくなってしまう。
          // 止めたあとそのまま再生に入るようにしておく。
          if (playDown) {
            shouldPlayFromHardwareRef.current = true;
          }

          void stopCassetteRecording();
        }
        prevHardwareStateRef.current = s;
        return;
      }

      // 確認待ちのあいだは、同じボタンでも意味が変わる。
      //   PLAY → 録った音を聞く / REC → 録り直す / STOP → 決定して保管
      if (isReviewingRef.current) {
        if (playDown) toggleHardwarePlayback();
        if (recDown) {
          // ここで前の録音を捨てない。
          // 録り直しが成立しなければ前のテープが残る。
          isRecPressedRef.current = true;
          void startCassetteRecording();
        }
        if (stopDown) {
          handleHardwarePlaybackChange(false);
          void confirmPendingRecording();
        }

        prevHardwareStateRef.current = s;
        return;
      }

      // PLAY は押すたびに再生と停止が入れ替わる。
      // 押している間だけ鳴らす作りだと、録音直後のようにプレイヤーの
      // 用意が間に合っていない場面で、離した時点で取り消されてしまい
      // 何も鳴らないことがあった。実物のデッキの PLAY も押すと固定される。
      if (playDown) {
        toggleHardwarePlayback();
      }
      if (recDown) {
        isRecPressedRef.current = true;
        void startCassetteRecording();
      }
      if (stopDown) {
        handleHardwarePlaybackChange(false);
        moveActiveCapsuleBy(1);
      }

      prevHardwareStateRef.current = s;
    });
      return unsub;
    }, [
      confirmPendingRecording,
      handleHardwarePlaybackChange,
      moveActiveCapsuleBy,
      startCassetteRecording,
      stopCassetteRecording,
      toggleHardwarePlayback,
    ]),
  );

  // 録音画面で REC を押してこの画面に飛んできた場合、そのまま録音を始める。
  // 押しっぱなしのまま遷移してくるので、離したときに停止できるよう
  // 「REC は押されている」状態から始める。
  const appliedAutoRecordTokenRef = useRef("");
  useEffect(() => {
    if (!autoRecordToken) return;
    if (appliedAutoRecordTokenRef.current === autoRecordToken) return;
    appliedAutoRecordTokenRef.current = autoRecordToken;

    prevHardwareStateRef.current = { stop: false, play: false, rec: true };
    isRecPressedRef.current = true;
    void startCassetteRecording();
  }, [autoRecordToken, startCassetteRecording]);

  useEffect(() => {
    void setIsAudioActiveAsync(true);
    return () => {
      unloadSound().catch(() => {});
    };
  }, [unloadSound]);

  useEffect(() => {
    void refreshPlayableCapsule();
  }, [refreshPlayableCapsule]);

  const stopArrivalSound = useCallback(() => {
    if (arrivalSoundCleanupTimerRef.current) {
      clearTimeout(arrivalSoundCleanupTimerRef.current);
      arrivalSoundCleanupTimerRef.current = null;
    }
    const player = arrivalSoundRef.current;
    arrivalSoundRef.current = null;
    if (!player) return;
    try {
      player.pause();
    } catch {}
    try {
      player.remove();
    } catch {}
  }, []);

  // 新着の知らせ音。モバイルモードの通知と同じ音を使う。
  const playArrivalSound = useCallback(async () => {
    // 録音中に鳴らすと自分の声に混ざるので鳴らさない。
    if (isHardwareRecordingRef.current) return;

    stopArrivalSound();
    try {
      const soundAsset = Asset.fromModule(ARRIVAL_SOUND_FILE);
      if (!soundAsset.localUri) {
        try {
          await soundAsset.downloadAsync();
        } catch {}
      }
      const uri = soundAsset.localUri ?? soundAsset.uri;
      if (!uri) return;
      const player = createAudioPlayer({ uri });
      arrivalSoundRef.current = player;
      player.play();
      arrivalSoundCleanupTimerRef.current = setTimeout(() => {
        if (arrivalSoundRef.current !== player) return;
        arrivalSoundRef.current = null;
        try {
          player.remove();
        } catch {}
      }, ARRIVAL_SOUND_CLEANUP_MS);
    } catch {}
  }, [stopArrivalSound]);

  // 解禁されたカプセルが現れたらその場で知らせる。
  // これが無いと、開封のたびにモバイルモードへ戻る必要があった。
  const checkForNewlyUnlocked = useCallback(async () => {
    // 確認中に割り込むと、聞いている音が差し替わってしまう。
    // 次の巡回で拾えるので、ここでは何もしない。
    if (isReviewingRef.current) return;

    const list = await loadCapsules();
    const nowMs = Date.now();
    const unlocked = list.filter(
      (item) =>
        nowMs >= item.unlockAtMs &&
        typeof item.audioUri === "string" &&
        item.audioUri.length > 0,
    );

    // 初回は現状を記録するだけ。既存のカプセルを「届いた」と誤認しないため。
    if (!hasSeededKnownCapsulesRef.current) {
      hasSeededKnownCapsulesRef.current = true;
      unlocked.forEach((item) => knownCapsuleIdsRef.current.add(item.id));
      return;
    }

    const arrived = unlocked.find(
      (item) => !knownCapsuleIdsRef.current.has(item.id),
    );
    unlocked.forEach((item) => knownCapsuleIdsRef.current.add(item.id));
    if (!arrived) return;

    await refreshPlayableCapsule();
    setActiveCapsuleIndex(0);
    setNotice({ title: arrived.title, caption: "が届きました" });
    void playArrivalSound();

    if (arrived.openedAtMs === null) {
      await updateCapsule(arrived.id, { openedAtMs: Date.now() });
    }
  }, [playArrivalSound, refreshPlayableCapsule]);

  useFocusEffect(
    useCallback(() => {
      void checkForNewlyUnlocked();
      const id = setInterval(() => {
        void checkForNewlyUnlocked();
      }, 1000);
      return () => clearInterval(id);
    }, [checkForNewlyUnlocked]),
  );

  // 保存の知らせ。出して、少し置いて、消す。
  useEffect(() => {
    if (!notice) return;

    savedNoticeOpacity.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(savedNoticeOpacity, {
        toValue: 1,
        duration: SAVED_NOTICE_FADE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.delay(SAVED_NOTICE_HOLD_MS),
      Animated.timing(savedNoticeOpacity, {
        toValue: 0,
        duration: SAVED_NOTICE_FADE_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    animation.start(({ finished }) => {
      if (finished) setNotice(null);
    });

    return () => animation.stop();
  }, [notice, savedNoticeOpacity]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      // 録音中はプレイヤーを作らない。
      // 録音用と再生用でオーディオの設定が競合し、
      // 録り直したあとに音が出なくなることがある。
      if (isCassetteRecording) return;

      if (!activeAudioUri) {
        await unloadSound();
        return;
      }
      try {
        await unloadSound();

        // ここで音声セッションを触ってはいけない。
        // この処理は非同期なので、録音の開始と同時に走ると
        // 録音用に設定したセッションを打ち消してしまい、
        // 長く録っても中身が空のファイルになる。
        // セッションを戻すのは録音を止めるときだけ（stopCassetteRecording）。
        const player = createAudioPlayer(
          { uri: activeAudioUri },
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
        console.log(`[CAS] player ready uri=${activeAudioUri}`);
        playerRef.current = player;
        playbackSubscriptionRef.current = sub;
        onPlaybackStatusUpdate(player.currentStatus);
        if (shouldPlayFromHardwareRef.current) {
          try {
            player.play();
            setIsPlaying(true);
          } catch {}
        }
      } catch (error) {
        console.log("[CAS] player 作成に失敗", error);
        setIsPlaying(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [activeAudioUri, isCassetteRecording, onPlaybackStatusUpdate, unloadSound]);

  useEffect(() => {
    const id = rotateProgress.addListener(({ value }) => {
      progressRef.current = normalizeSpinProgress(value);
    });
    return () => rotateProgress.removeListener(id);
  }, [rotateProgress]);

  const shouldSpinWheels = isPlaying || isCassetteRecording;
  shouldSpinRef.current = shouldSpinWheels;

  useEffect(() => {
    if (shouldSpinWheels) {
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
          if (!finished || !shouldSpinRef.current) return;
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
  }, [rotateProgress, shouldSpinWheels]);

  useEffect(() => {
    return () => {
      clearMaxRecordingTimeout();
      stopArrivalSound();
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
  }, [clearMaxRecordingTimeout, rotateProgress, stopArrivalSound]);

  const spin = rotateProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const reverseSpin = rotateProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "-360deg"],
  });

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
          {/*
            カセットに貼られた名札。演出ではなく、実物のラベルと同じく
            そのカプセルを見ているあいだずっと貼られている。
          */}
          {activeCapsuleTitle && !isCassetteRecording ? (
            <View
              style={[
                styles.tapeLabelSlot,
                {
                  left: boardLeft + TAPE_LABEL_LEFT * uiScale,
                  top: TAPE_LABEL_TOP * uiScale,
                },
              ]}
            >
              <TapeLabel
                title={activeCapsuleTitle}
                scale={uiScale}
                fontReady={crayonLoaded}
              />
            </View>
          ) : null}

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
        {/*
          録音中の目印。実物のデッキの録音ランプと同じ役割。
          リールは再生中も回るので、赤い点が「録音」を区別する唯一の手がかりになる。
        */}
        {isCassetteRecording ? (
          <View
            pointerEvents="none"
            style={[
              styles.recordingDot,
              {
                width: 16 * uiScale,
                height: 16 * uiScale,
                borderRadius: 8 * uiScale,
                top: 24 * uiScale,
                right: boardLeft + 40 * uiScale,
              },
            ]}
          />
        ) : null}

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

        {/*
          録り終えたあとの確認。ここで保管するか録り直すかを決める。
          スマホは筐体の中にあるので、どのボタンが何をするかを画面に出す。
        */}
        {pendingRecording && !isCassetteRecording ? (
          <View pointerEvents="none" style={styles.reviewOverlay}>
            <BlurView
              intensity={34}
              tint="light"
              style={styles.arrivalIntroBlur}
            />
            <Text style={styles.reviewDuration}>
              {formatDuration(pendingRecording.durationSec)}
            </Text>
            <Text
              style={[
                styles.reviewHeading,
                zenLoaded && styles.arrivalIntroTitleZen,
              ]}
            >
              この声でよいですか
            </Text>
            <View style={styles.reviewGuideList}>
              <Text style={styles.reviewGuideRow}>
                <Text style={styles.reviewGuideKey}>PLAY</Text>
                {"　聞いてみる / 止める"}
              </Text>
              <Text style={styles.reviewGuideRow}>
                <Text style={styles.reviewGuideKey}>REC</Text>
                {"　押しながら録り直す"}
              </Text>
              <Text style={styles.reviewGuideRow}>
                <Text style={styles.reviewGuideKey}>STOP</Text>
                {"　保管する"}
              </Text>
            </View>
          </View>
        ) : null}

        {/*
          録り終わったあと、どの名前で保管したかを知らせる。
          録音前に名前を見せても、まだ存在しないテープの名前になってしまう。
        */}
        {notice ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.arrivalIntroOverlay,
              { opacity: savedNoticeOpacity },
            ]}
          >
            <BlurView
              intensity={34}
              tint="light"
              style={styles.arrivalIntroBlur}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.arrivalIntroTitle,
                zenLoaded && styles.arrivalIntroTitleZen,
              ]}
            >
              {notice.title}
            </Text>
            <Text
              style={[
                styles.savedNoticeCaption,
                zenLoaded && styles.arrivalIntroTitleZen,
              ]}
            >
              {notice.caption}
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
  recordingDot: {
    position: "absolute",
    backgroundColor: "#e0362a",
    zIndex: 10,
    shadowColor: "#e0362a",
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  bottomBarBackground: {
    position: "absolute",
    zIndex: 4,
  },
  bottomButtonImage: {
    width: 60,
    height: 60,
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
  tapeLabelSlot: {
    position: "absolute",
    // カバーやリールより手前に置く
    zIndex: 6,
  },
  tapeLabel: {
    alignItems: "center",
    justifyContent: "center",
  },
  tapeLabelImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  // テープ画像は右下がりに傾いているので、文字も同じ向きに倒す。
  // 逆向きだと、貼った紙の上に書いたようには見えない。
  tapeLabelRotator: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  tapeLabelText: {
    color: "#2b2521",
    fontWeight: "400",
    letterSpacing: 4,
    paddingHorizontal: 20,
    textAlign: "center",
  },
  tapeLabelTextFont: {
    fontFamily: "Crayon",
    fontWeight: "400",
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
  arrivalIntroBlur: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(252, 249, 249, 0.89)",
  },
  reviewOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  reviewDuration: {
    color: "#6f7178",
    fontSize: 17,
    fontWeight: "500",
    letterSpacing: 0.4,
    marginBottom: 10,
  },
  reviewHeading: {
    color: "#111217",
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: 0.2,
    marginBottom: 22,
  },
  reviewGuideList: {
    alignItems: "flex-start",
    gap: 6,
  },
  reviewGuideRow: {
    color: "#3d3f47",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "500",
  },
  reviewGuideKey: {
    color: "#111217",
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  savedNoticeCaption: {
    marginTop: 14,
    color: "#6f7178",
    fontSize: 17,
    fontWeight: "500",
    letterSpacing: 0.4,
  },
});
