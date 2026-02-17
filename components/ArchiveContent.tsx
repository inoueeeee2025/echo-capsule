import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import PlayCircleSvg from "@/assets/images/Play_circle.svg";
import { loadCapsules, toDateKeyFromMs, updateCapsule } from "@/src/capsules/storage";
import {
  Alert,
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type RecordingItem = {
  id: string;
  title: string;
  durationSec: number;
  date: string;
  hasTranscript: boolean;
  isLocked: boolean;
  isUnopened: boolean;
  source: "dummy" | "capsule";
};

type ArchiveContentProps = {
  embedded?: boolean;
  onPressRec?: () => void;
  onPressTranscript?: (id: string) => void;
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const LIST_TITLE_NUDGE_X = 2;
const LIST_TITLE_NUDGE_Y = -3;
const LIST_TITLE_WEIGHT = "400" as const;
const GREEN_DOT_IMAGE = require("../assets/images/green.png");

const DUMMY_RECORDINGS: RecordingItem[] = [
  { id: "r1", title: "project 1", durationSec: 230, date: "2027-01-31", hasTranscript: true, isLocked: false, isUnopened: false, source: "dummy" },
  { id: "r2", title: "project 1", durationSec: 230, date: "2027-01-31", hasTranscript: true, isLocked: false, isUnopened: false, source: "dummy" },
  { id: "r3", title: "project 1", durationSec: 230, date: "2027-01-31", hasTranscript: true, isLocked: false, isUnopened: false, source: "dummy" },
  { id: "r4", title: "design memo", durationSec: 186, date: "2025-09-16", hasTranscript: false, isLocked: false, isUnopened: false, source: "dummy" },
  { id: "r5", title: "morning log", durationSec: 143, date: "2025-09-16", hasTranscript: true, isLocked: false, isUnopened: false, source: "dummy" },
  { id: "r6", title: "weekly review", durationSec: 301, date: "2025-09-25", hasTranscript: true, isLocked: false, isUnopened: false, source: "dummy" },
  { id: "r7", title: "brainstorm", durationSec: 208, date: "2025-09-11", hasTranscript: false, isLocked: false, isUnopened: false, source: "dummy" },
  { id: "r8", title: "interview", durationSec: 355, date: "2025-09-01", hasTranscript: true, isLocked: false, isUnopened: false, source: "dummy" },
  { id: "r9", title: "afternoon log", durationSec: 122, date: "2025-08-30", hasTranscript: false, isLocked: false, isUnopened: false, source: "dummy" },
  { id: "r10", title: "user test", durationSec: 276, date: "2025-08-18", hasTranscript: true, isLocked: false, isUnopened: false, source: "dummy" },
  { id: "r11", title: "project 2", durationSec: 264, date: "2025-07-07", hasTranscript: true, isLocked: false, isUnopened: false, source: "dummy" },
  { id: "r12", title: "meeting", durationSec: 198, date: "2025-06-05", hasTranscript: false, isLocked: false, isUnopened: false, source: "dummy" },
];

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDuration(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const min = Math.floor(safe / 60);
  const rem = safe % 60;
  return `${String(min).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function formatDateJP(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${y}/${Number(m)}/${Number(d)}`;
}

function formatDateJPWithWeekday(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const dayIndex = new Date(y, m - 1, d).getDay();
  return `${y}/${m}/${d}(${weekdays[dayIndex]})`;
}

function createCalendarCells(year: number, monthIndex: number): Date[] {
  const firstDay = new Date(year, monthIndex, 1);
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDay.getDay());

  const cells: Date[] = [];
  for (let i = 0; i < 35; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    cells.push(day);
  }
  return cells;
}

export default function ArchiveContent({
  embedded = false,
  onPressRec,
  onPressTranscript,
}: ArchiveContentProps) {
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () => {
      setIsKeyboardVisible(true);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setIsKeyboardVisible(false);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const showFullTitle = (title: string) => {
    Alert.alert("タイトル", title);
  };

  const isSvgReady = typeof PlayCircleSvg !== "number";
  const router = useRouter();
  const [capsuleItems, setCapsuleItems] = useState<RecordingItem[]>([]);
  const isCapsuleUnlockedNow = useCallback(async (capsuleId: string) => {
    const list = await loadCapsules();
    const target = list.find((item) => item.id === capsuleId);
    if (!target) return false;
    return Date.now() >= target.unlockAtMs;
  }, []);
  const openTranscript = (item: RecordingItem) => {
    Keyboard.dismiss();
    if (item.isLocked) return;
    if (item.source === "capsule") {
      void (async () => {
        const unlocked = await isCapsuleUnlockedNow(item.id);
        if (!unlocked) {
          void reloadCapsules();
          return;
        }
        if (item.isUnopened) {
          await updateCapsule(item.id, { openedAtMs: Date.now() });
          void reloadCapsules();
        }
        router.push({
          pathname: "/record/kaihuu",
          params: { mode: "text", transcriptId: item.id, capsuleId: item.id },
        });
      })();
      return;
    }
    if (onPressTranscript) {
      onPressTranscript(item.id);
      return;
    }
    router.push({
      pathname: "/record/kaihuu",
      params: { mode: "text", transcriptId: item.id },
    });
  };
  const openCassetteScreen = (item: RecordingItem) => {
    if (item.isLocked) return;
    if (item.source === "capsule") {
      void (async () => {
        const unlocked = await isCapsuleUnlockedNow(item.id);
        if (!unlocked) {
          void reloadCapsules();
          return;
        }
        if (item.isUnopened) {
          await updateCapsule(item.id, { openedAtMs: Date.now() });
          void reloadCapsules();
        }
        router.push({
          pathname: "/record/kaihuu",
          params: { capsuleId: item.id },
        });
      })();
      return;
    }
    router.push("/cassette");
  };
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const reloadCapsules = useCallback(async () => {
    const nowMs = Date.now();
    const capsules = await loadCapsules();
    const mapped: RecordingItem[] = capsules.map((item) => ({
      id: item.id,
      title: item.title,
      durationSec: item.durationSec,
      date: toDateKeyFromMs(item.unlockAtMs),
      hasTranscript: item.hasTranscript,
      isLocked: nowMs < item.unlockAtMs,
      isUnopened: item.openedAtMs == null,
      source: "capsule",
    }));
    setCapsuleItems(mapped);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reloadCapsules();
    }, [reloadCapsules]),
  );
  useEffect(() => {
    const id = setInterval(() => {
      void reloadCapsules();
    }, 1000);
    return () => clearInterval(id);
  }, [reloadCapsules]);

  const monthIndex = currentMonth.getMonth();
  const year = currentMonth.getFullYear();

  const sortedLatest = useMemo(() => {
    return [...capsuleItems, ...DUMMY_RECORDINGS].sort((a, b) => {
      if (a.date === b.date) return b.id.localeCompare(a.id);
      return b.date.localeCompare(a.date);
    });
  }, [capsuleItems]);

  const dotDateKeys = useMemo(() => {
    const prefix = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    return new Set(
      sortedLatest
        .filter((r) => r.date.startsWith(prefix) && !r.isLocked)
        .map((r) => r.date),
    );
  }, [monthIndex, sortedLatest, year]);
  const unlockedDateKeys = useMemo(() => {
    const prefix = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    return new Set(
      sortedLatest
        .filter((r) => r.date.startsWith(prefix) && !r.isLocked)
        .map((r) => r.date),
    );
  }, [monthIndex, sortedLatest, year]);
  const unopenedDotDateKeys = useMemo(() => {
    const prefix = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    return new Set(
      sortedLatest
        .filter((r) => r.date.startsWith(prefix) && !r.isLocked && r.isUnopened)
        .map((r) => r.date),
    );
  }, [monthIndex, sortedLatest, year]);

  const visibleBaseList = useMemo(
    () => sortedLatest.filter((item) => !item.isLocked).slice(0, 10),
    [sortedLatest],
  );
  const searchableList = useMemo(
    () => sortedLatest,
    [sortedLatest],
  );

  const visibleList = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return visibleBaseList;
    return searchableList.filter((item) => item.title.toLowerCase().includes(keyword));
  }, [searchText, searchableList, visibleBaseList]);

  const selectedDateItems = useMemo(() => {
    if (!selectedDateKey) return [];
    return sortedLatest.filter((item) => item.date === selectedDateKey && !item.isLocked);
  }, [selectedDateKey, sortedLatest]);

  const cells = useMemo(() => createCalendarCells(year, monthIndex), [monthIndex, year]);

  const isSearching = searchText.trim().length > 0;
  const sectionTitle = isSearching ? "検索結果" : "最新10件";

  useEffect(() => {
    if (!isSearching) return;
    setSelectedDateKey(null);
    setMonthPickerOpen(false);
    setYearPickerOpen(false);
  }, [isSearching]);

  const moveMonth = (delta: number) => {
    const next = new Date(year, monthIndex + delta, 1);
    setCurrentMonth(next);
  };

  const onSelectDay = (date: Date) => {
    const key = toDateKey(date);
    const hasRecordingsOnDay = unlockedDateKeys.has(key);
    if (date.getMonth() !== monthIndex || date.getFullYear() !== year) {
      setCurrentMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    }
    setSelectedDateKey(hasRecordingsOnDay ? key : null);
  };

  return (
    <ScrollView
      style={[styles.container, embedded && styles.embeddedContainer]}
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {isKeyboardVisible ? (
        <Pressable
          style={styles.keyboardDismissOverlay}
          onPress={Keyboard.dismiss}
        />
      ) : null}
      {!embedded ? (
        <>
          <View style={styles.backWrap}>
            <Pressable
              onPress={() => {
                if (onPressRec) {
                  onPressRec();
                  return;
                }
                router.back();
              }}
              hitSlop={8}>
              <Text style={styles.backLabel}>back</Text>
              <Text style={styles.backArrow}>{"<"}</Text>
            </Pressable>
          </View>

          <View style={styles.segmentWrap}>
            <View style={styles.segmentTrack}>
              <Pressable
                style={styles.segmentHalf}
                onPress={() => {
                  if (onPressRec) {
                    onPressRec();
                  } else {
                    router.replace("/record/rec");
                  }
                }}>
                <Text style={styles.segmentText}>rec</Text>
              </Pressable>
              <View style={[styles.segmentActivePill, styles.segmentActiveRight]} />
              <View style={styles.segmentHalf} pointerEvents="none">
                <Text style={[styles.segmentText, styles.segmentTextActive]}>archive</Text>
              </View>
            </View>
          </View>
        </>
      ) : null}

      <View style={styles.searchWrap}>
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search"
          placeholderTextColor="rgba(255,255,255,0.75)"
          style={styles.searchInput}
        />
      </View>

      {!isSearching ? (
        <View
          style={[
            styles.calendarStack,
          ]}>
          <View style={styles.calendarCard}>
            <View style={styles.calendarHeader}>
              <Pressable style={styles.navArrowWrap} onPress={() => moveMonth(-1)}>
                <Image
                  source={require("../assets/images/miniArrow.png")}
                  style={styles.miniArrowLeft}
                  resizeMode="contain"
                />
              </Pressable>

              <Pressable style={styles.dropdownPill} onPress={() => setMonthPickerOpen(true)}>
                <Text style={styles.dropdownText}>{MONTHS[monthIndex]}</Text>
                <Image
                  source={require("../assets/images/miniArrow.png")}
                  style={styles.miniArrowDropdown}
                  resizeMode="contain"
                />
              </Pressable>

              <Pressable style={styles.dropdownPill} onPress={() => setYearPickerOpen(true)}>
                <Text style={styles.dropdownText}>{String(year)}</Text>
                <Image
                  source={require("../assets/images/miniArrow.png")}
                  style={styles.miniArrowDropdown}
                  resizeMode="contain"
                />
              </Pressable>

              <Pressable style={styles.navArrowWrap} onPress={() => moveMonth(1)}>
                <Image
                  source={require("../assets/images/miniArrow.png")}
                  style={styles.miniArrowRight}
                  resizeMode="contain"
                />
              </Pressable>
            </View>

            <View style={styles.weekRow}>
              {WEEKDAYS.map((w) => (
                <Text key={w} style={styles.weekText}>
                  {w}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map((date) => {
                const key = toDateKey(date);
                const inCurrentMonth =
                  date.getMonth() === monthIndex && date.getFullYear() === year;
                const hasDot = dotDateKeys.has(key);
                const hasUnopenedDot = unopenedDotDateKeys.has(key);
                const isSelected = selectedDateKey === key;
                return (
                  <Pressable key={key} style={styles.dayCell} onPress={() => onSelectDay(date)}>
                    <View style={[styles.dayNumberWrap, isSelected && styles.daySelected]}>
                      <Text style={[styles.dayNumber, !inCurrentMonth && styles.dayNumberMuted]}>
                        {date.getDate()}
                      </Text>
                    </View>
                    <View style={styles.dotArea}>
                      {hasUnopenedDot ? (
                        <Image source={GREEN_DOT_IMAGE} style={styles.unopenedDotImage} resizeMode="contain" />
                      ) : hasDot ? (
                        <View style={styles.dot} />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {selectedDateKey && selectedDateItems.length > 0 ? (
            <>
              <Pressable
                style={styles.deliveryModalBackdrop}
                onPress={() => setSelectedDateKey(null)}
              />
              <View style={styles.deliveryModalCard}>
                <Text style={styles.deliveryModalDate}>{formatDateJPWithWeekday(selectedDateKey)}</Text>
                <View style={styles.deliveryModalRow}>
                  <Text
                    style={styles.deliveryModalTitle}
                    numberOfLines={1}
                    onLongPress={() => showFullTitle(selectedDateItems[0].title)}>
                    {selectedDateItems[0].title}
                  </Text>
                  <Text style={styles.deliveryModalDuration}>
                    {formatDuration(selectedDateItems[0].durationSec)}
                  </Text>
                  <Pressable
                    style={styles.playButton}
                    onPress={() => openCassetteScreen(selectedDateItems[0])}
                    hitSlop={6}>
                    {isSvgReady ? (
                      <PlayCircleSvg width={18} height={18} />
                    ) : (
                      <Text style={styles.playIcon}>{">"}</Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => openTranscript(selectedDateItems[0])}
                    hitSlop={6}>
                    <Text
                      style={[
                        styles.transcript,
                        (!selectedDateItems[0].hasTranscript || selectedDateItems[0].isLocked) &&
                          styles.transcriptDisabled,
                      ]}>
                      T
                    </Text>
                  </Pressable>
                </View>
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      <View style={styles.sectionHead}>
        <Image
          source={require("../assets/images/miniArrow.png")}
          style={styles.miniArrowDown}
          resizeMode="contain"
        />
        <Text style={styles.sectionTitle}>{sectionTitle}</Text>
      </View>

      <View style={styles.listWrap}>
        {visibleList.map((item) => (
          <View key={item.id} style={styles.row}>
            {item.isUnopened && !item.isLocked ? (
              <Image source={GREEN_DOT_IMAGE} style={styles.rowMarkerImage} resizeMode="contain" />
            ) : null}
            <Text style={styles.duration}>{formatDuration(item.durationSec)}</Text>
            <Text
              style={styles.title}
              numberOfLines={1}
              onLongPress={() => showFullTitle(item.title)}>
              {item.title}
            </Text>
            <Text style={styles.date}>{formatDateJP(item.date)}</Text>

            <Pressable
              style={styles.playButton}
              onPress={() => openCassetteScreen(item)}
              hitSlop={6}>
              {isSvgReady ? (
                <PlayCircleSvg width={18} height={18} />
              ) : (
                <Text style={styles.playIcon}>{">"}</Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => openTranscript(item)}
              hitSlop={6}>
              <Text
                style={[
                  styles.transcript,
                  (!item.hasTranscript || item.isLocked) && styles.transcriptDisabled,
                ]}>
                T
              </Text>
            </Pressable>
          </View>
        ))}
        {visibleList.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>No recordings found.</Text>
          </View>
        ) : null}
      </View>

      <Modal
        visible={monthPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMonthPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setMonthPickerOpen(false)}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {MONTHS.map((m, idx) => (
                <Pressable
                  key={m}
                  style={styles.modalRow}
                  onPress={() => {
                    setCurrentMonth(new Date(year, idx, 1));
                    setMonthPickerOpen(false);
                  }}>
                  <Text style={[styles.modalRowText, idx === monthIndex && styles.modalRowTextActive]}>
                    {m}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={yearPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setYearPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setYearPickerOpen(false)}>
          <View style={styles.modalCard}>
            {[2023, 2024, 2025, 2026, 2027, 2028].map((y) => (
              <Pressable
                key={String(y)}
                style={styles.modalRow}
                onPress={() => {
                  setCurrentMonth(new Date(y, monthIndex, 1));
                  setYearPickerOpen(false);
                }}>
                <Text style={[styles.modalRowText, y === year && styles.modalRowTextActive]}>
                  {y}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 4,
  },
  pageContent: {
    paddingBottom: 22,
  },
  embeddedContainer: {
    paddingTop: 0,
  },
  backWrap: {
    marginTop: 2,
    marginBottom: 10,
  },
  backLabel: {
    fontSize: 12,
    color: "#222",
  },
  backArrow: {
    fontSize: 32,
    lineHeight: 32,
    color: "#222",
    marginTop: 2,
    marginLeft: 2,
  },
  segmentWrap: {
    alignItems: "center",
    marginTop: 8,
  },
  segmentTrack: {
    width: 190,
    height: 44,
    borderRadius: 999,
    backgroundColor: "rgba(178, 182, 184, 0.52)",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 3,
    position: "relative",
  },
  segmentHalf: {
    width: "50%",
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  segmentActivePill: {
    position: "absolute",
    top: 3,
    width: 93,
    height: 38,
    borderRadius: 999,
    backgroundColor: "rgba(219, 221, 223, 0.84)",
  },
  segmentActiveRight: {
    right: 3,
  },
  segmentText: {
    fontSize: 15,
    color: "#e9ebec",
    fontWeight: "500",
  },
  segmentTextActive: {
    color: "#ffffff",
  },
  searchWrap: {
    marginTop: 24,
    marginBottom: 22,
  },
  searchInput: {
    height: 54,
    borderRadius: 14,
    backgroundColor: "rgba(150, 140, 155, 0.4)",
    paddingHorizontal: 18,
    fontSize: 15,
    fontWeight: "600",
    color: "rgba(255,255,255,0.75)",
  },
  calendarCard: {
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  calendarStack: {
    position: "relative",
  },
  calendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 10,
    marginBottom: 12,
  },
  navArrowWrap: {
    width: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  navArrow: {
    fontSize: 28,
    color: "#8e9092",
    fontWeight: "500",
  },
  miniArrowRight: {
    width: 13,
    height: 13,
    tintColor: "#8e9092",
  },
  miniArrowLeft: {
    width: 13,
    height: 13,
    tintColor: "#8e9092",
    transform: [{ rotate: "180deg" }],
  },
  dropdownPill: {
    minWidth: 90,
    height: 32,
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    borderWidth: 1,
    borderColor: "rgba(170, 173, 176, 0.4)",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownText: {
    fontSize: 15,
    color: "#34373a",
  },
  dropdownChevron: {
    fontSize: 14,
    color: "#34373a",
  },
  miniArrowDropdown: {
    width: 9,
    height: 9,
    tintColor: "#34373a",
    transform: [{ rotate: "90deg" }],
  },
  weekRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  weekText: {
    width: "14.28%",
    textAlign: "center",
    color: "#6f7274",
    fontSize: 12,
    fontWeight: "500",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    width: "14.28%",
    alignItems: "center",
    paddingVertical: 4,
    minHeight: 50,
  },
  dayNumberWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  daySelected: {
    backgroundColor: "rgba(186, 190, 192, 0.36)",
  },
  dayNumber: {
    fontSize: 13,
    color: "#2e2f31",
  },
  dayNumberMuted: {
    color: "#b3b4b6",
  },
  dotArea: {
    marginTop: 2,
    height: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 5,
    backgroundColor: "rgba(163, 165, 167, 0.9)",
  },
  unopenedDotImage: {
    width: 8,
    height: 8,
  },
  deliveryModalBackdrop: {
    position: "absolute",
    left: -2000,
    right: -2000,
    top: -2000,
    bottom: -2000,
    zIndex: 2,
  },
  deliveryModalCard: {
    position: "absolute",
    left: 22,
    right: 22,
    top: 165,
    zIndex: 3,
    elevation: 3,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: "rgba(140, 143, 146, 0.5)",
    backgroundColor: "rgba(247, 247, 248, 0.95)",
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  deliveryModalDate: {
    textAlign: "center",
    color: "#141618",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 12,
  },
  deliveryModalRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
  },
  deliveryModalTitle: {
    flex: 1,
    color: "rgb(22, 24, 26)",
    fontSize: 14,
    fontWeight: LIST_TITLE_WEIGHT,
  },
  deliveryModalDuration: {
    width: 62,
    color: "#8e9092",
    fontSize: 14,
    textAlign: "right",
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 18,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  sectionArrow: {
    fontSize: 14,
    color: "#2d2f31",
    marginRight: 4,
  },
  miniArrowDown: {
    width: 11,
    height: 11,
    marginRight: 4,
    tintColor: "#2d2f31",
    transform: [{ rotate: "90deg" }],
  },
  sectionTitle: {
    fontSize: 18,
    color: "#181a1c",
  },
  listWrap: {
    width: "100%",
  },
  row: {
    minHeight: 46,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(139, 142, 145, 0.5)",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 2,
    columnGap: 10,
  },
  rowMarkerImage: {
    position: "absolute",
    left: -16,
    top: 18,
    width: 9,
    height: 9,
  },
  duration: {
    width: 44,
    color: "#8e9092",
    fontSize: 15,
  },
  title: {
    flex: 1,
    color: "#16181a",
    fontSize: 18,
    fontWeight: LIST_TITLE_WEIGHT,
    marginLeft: LIST_TITLE_NUDGE_X,
    marginTop: LIST_TITLE_NUDGE_Y,
  },
  date: {
    width: 80,
    color: "#8e9092",
    fontSize: 15,
    textAlign: "right",
  },
  playButton: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 2,
  },
  playCircleImage: {
    width: 18,
    height: 18,
  },
  playIcon: {
    color: "#2d2f31",
    fontSize: 10,
    marginLeft: 1,
  },
  transcript: {
    width: 14,
    textAlign: "center",
    color: "#1d2022",
    fontSize: 15,
    marginLeft: 2,
  },
  transcriptDisabled: {
    color: "#9a9da1",
  },
  emptyWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(139, 142, 145, 0.5)",
    paddingVertical: 14,
    alignItems: "center",
  },
  emptyText: {
    color: "#8e9092",
    fontSize: 13,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCard: {
    width: 180,
    maxHeight: 260,
    backgroundColor: "#f6f7f8",
    borderRadius: 14,
    paddingVertical: 6,
  },
  modalRow: {
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  modalRowText: {
    fontSize: 15,
    color: "#3a3c3f",
    textAlign: "center",
  },
  modalRowTextActive: {
    color: "#111315",
    fontWeight: "600",
  },
  keyboardDismissOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
  },
})


