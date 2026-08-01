/**
 * アプリ全体の設定値。
 *
 * 同じ値が複数の画面に散らばると仕様がずれるため、
 * 録音・開封に関わる数値はここに集約する。
 */

/** 1回の録音の上限。これを超えたら自動で停止する。 */
export const MAX_RECORDING_MS = 180 * 1000;

/**
 * デモ・展示用の設定。
 *
 * カプセルは本来1年後に開封できるようになるが、展示やデモでは
 * その場で「録る → 届く → 開封する」まで見せる必要があるため、
 * 待ち時間を短縮できるようにしてある。
 *
 * 以前は `__DEV__` で分岐していたが、それだと EAS build した本番アプリで
 * デモが一切再現できなくなる。実行形態に左右されないよう、
 * ビルド種別から切り離した設定値にしている。
 *
 * 本番リリース時は DEMO_MODE を false にする。
 */

/** true の間、開封までの待ち時間を DEMO_UNLOCK_DELAY_MS に短縮する。 */
export const DEMO_MODE = true;

/** デモ時、録音してから開封できるようになるまでの待ち時間。 */
export const DEMO_UNLOCK_DELAY_MS = 30 * 1000;

/** 本来の開封までの年数。 */
export const UNLOCK_AFTER_YEARS = 1;

/**
 * 保管した時刻から、そのカプセルが開封可能になる時刻を求める。
 *
 * 起点は「録音した時刻」ではなく「保管した時刻」。
 * 録り終えてから聞き直して決めるまでの時間も待ち時間に含めてしまうと、
 * 保管した直後に届いてしまう。
 *
 * 保存処理は rec 画面とカセット画面の2箇所にあるため、
 * 計算がずれないよう必ずこの関数を通すこと。
 */
export function computeUnlockAtMs(storedAtMs: number): number {
  if (DEMO_MODE) {
    return storedAtMs + DEMO_UNLOCK_DELAY_MS;
  }
  const unlockDate = new Date(storedAtMs);
  unlockDate.setFullYear(unlockDate.getFullYear() + UNLOCK_AFTER_YEARS);
  return unlockDate.getTime();
}
