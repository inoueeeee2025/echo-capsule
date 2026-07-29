import AsyncStorage from "@react-native-async-storage/async-storage";

export const CAPSULES_STORAGE_KEY = "echoCapsules";

export type CapsuleRecord = {
  id: string;
  title: string;
  audioUri: string;
  durationSec: number;
  recordedAtMs: number;
  unlockAtMs: number;
  openedAtMs: number | null;
  /**
   * 文字起こしを持つか。
   * 文字起こし機能は今回スコープ外なので、常に false が入る。
   * 保存済みデータとの互換のためフィールドは残してある。
   */
  hasTranscript: boolean;
};

export function toDateKeyFromMs(ms: number): string {
  const date = new Date(ms);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function loadCapsules(): Promise<CapsuleRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(CAPSULES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean) as CapsuleRecord[];
  } catch {
    return [];
  }
}

export async function saveCapsules(items: CapsuleRecord[]): Promise<void> {
  await AsyncStorage.setItem(CAPSULES_STORAGE_KEY, JSON.stringify(items));
}

export async function addCapsule(item: CapsuleRecord): Promise<void> {
  const current = await loadCapsules();
  current.unshift(item);
  await saveCapsules(current);
}

export async function updateCapsule(
  id: string,
  patch: Partial<CapsuleRecord>,
): Promise<CapsuleRecord | null> {
  const current = await loadCapsules();
  const index = current.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const nextItem = { ...current[index], ...patch };
  current[index] = nextItem;
  await saveCapsules(current);
  return nextItem;
}

export async function removeCapsule(id: string): Promise<boolean> {
  const current = await loadCapsules();
  const next = current.filter((item) => item.id !== id);
  if (next.length === current.length) return false;
  await saveCapsules(next);
  return true;
}

export function isCapsuleUnlocked(item: CapsuleRecord, nowMs = Date.now()): boolean {
  return nowMs >= item.unlockAtMs;
}

/**
 * テープ名が未入力のときに使う既定のタイトルを作る。
 *
 * 同じ日に複数録ると一覧で見分けがつかなくなるため、
 * 既存と重なる場合は「2026/7/30 (1)」のように連番を付ける。
 *
 * 書式は rec 画面とカセット画面で揃えること。以前は片方が
 * ゼロ埋めありで、同じ日でも別の文字列になっていた。
 */
export async function buildDefaultTitle(recordedAtMs: number): Promise<string> {
  const d = new Date(recordedAtMs);
  const base = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;

  const existing = await loadCapsules();
  const taken = new Set(existing.map((item) => item.title));
  if (!taken.has(base)) return base;

  let suffix = 1;
  while (taken.has(`${base} (${suffix})`)) {
    suffix += 1;
  }
  return `${base} (${suffix})`;
}
