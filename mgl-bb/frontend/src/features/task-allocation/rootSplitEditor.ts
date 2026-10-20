/* ҮНДСЭН ТАСКУУД БОЛГОН ХУВААХ ЦОНХНЫ ЦЭВЭР ЗАГВАР (✂, эзэн 2026-10-09).  Цонх: `RootSplitDialog.tsx`.
 *
 * Мөр бүр = нэг ШИНЭ үндсэн таск: нэр + хувь.  Хувь нь хуваагдах ажлын хувь (явцгүй бол бүх таск, явцтай бол ҮЛДСЭН
 * хэсэг) — бүхэл нэгж (1% = 10 000), нийлбэр ЯГ 100% (1 000 000).
 *   • Гараар засаагүй («зөөлөн») мөрүүд үлдэгдлийг одоогийн харьцаагаараа дахин хуваана.
 *   • Хуулах = мөрийг доор нь давхардуулж (нэр ижил), хувийг ХОЁР хуваана (нийлбэр хэвээр) — дараа нь нэрийг сольно.
 *   • Нэмэх = таскийн нэртэй шинэ мөр, зөөлөн мөрүүд тэнцүү хуваагдана.  Устгах = хувь нь зөөлөн мөрүүдэд очно.
 * Сервер эцсийн шалгалтыг дахин хийнэ (`backend/src/lib/taskRootSplit.ts` `planRootSplit`). */
import { equalUnits, largestRemainder, ROOT_TOTAL_UNITS } from './units';

export const MAX_ROOT_SPLIT_PARTS = 20;
export const MAX_ROOT_SPLIT_NAME = 200;

export interface SplitRow {
  key: string;
  name: string;
  units: number;
  /** Хэрэглэгч энэ цонхонд гараар бичсэн хувь (дахин хуваахад хөдлөхгүй). */
  fixed: boolean;
}

export interface SplitModel {
  rows: SplitRow[];
  seq: number;
  /** Шинэ мөрийн өгөгдмөл нэр = таскийн нэр. */
  defaultName: string;
}

const squash = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Урьдчилан бөглөх мөрүүдээс (хүнгүй хэсгүүд), эсвэл таскийн нэртэй НЭГ мөрөөр эхэлнэ — дараа нь хуулж, нэрийг солино. */
export function initSplit(taskName: string, prefill: ReadonlyArray<{ name: string; share_units: number }> = []): SplitModel {
  if (prefill.length > 0) {
    return {
      rows: prefill.map((p, i) => ({ key: `n${i}`, name: p.name, units: p.share_units, fixed: false })),
      seq: prefill.length,
      defaultName: taskName,
    };
  }
  return { rows: [{ key: 'n0', name: taskName, units: ROOT_TOTAL_UNITS, fixed: false }], seq: 1, defaultName: taskName };
}

export const sumOf = (m: SplitModel): number => m.rows.reduce((s, r) => s + r.units, 0);

function rebalance(m: SplitModel, equal = false): SplitModel {
  const soft = m.rows.filter((r) => !r.fixed);
  if (soft.length === 0) return m;
  const rest = Math.max(0, ROOT_TOTAL_UNITS - m.rows.filter((r) => r.fixed).reduce((s, r) => s + r.units, 0));
  const weights = soft.map((r) => r.units);
  const shares = !equal && weights.some((w) => w > 0) ? largestRemainder(rest, weights) : equalUnits(rest, soft.length);
  let k = 0;
  return { ...m, rows: m.rows.map((r) => (r.fixed ? r : { ...r, units: shares[k++] ?? 0 })) };
}

export function setName(m: SplitModel, key: string, name: string): SplitModel {
  return { ...m, rows: m.rows.map((r) => (r.key === key ? { ...r, name } : r)) };
}

export function setUnits(m: SplitModel, key: string, units: number): SplitModel {
  // Бүх мөр гараар засагдсан бол нийлбэр 100 биш байж болно — «Тэнцүү хуваах» эсвэл нийлбэрийн алдаа харагдана.
  return rebalance({ ...m, rows: m.rows.map((r) => (r.key === key ? { ...r, units, fixed: true } : r)) });
}

/** Мөрийг доор нь хуулна: нэр ЯГ ижил, хувь хоёр хуваагдана — нийлбэр өөрчлөгдөхгүй. */
export function duplicateRow(m: SplitModel, key: string): SplitModel {
  if (m.rows.length >= MAX_ROOT_SPLIT_PARTS) return m;
  const i = m.rows.findIndex((r) => r.key === key);
  const src = m.rows[i];
  if (!src) return m;
  const [a = 0, b = 0] = equalUnits(src.units, 2);
  const copy: SplitRow = { key: `n${m.seq}`, name: squash(src.name) !== '' ? src.name : m.defaultName, units: b, fixed: src.fixed };
  const rows = [...m.rows];
  rows.splice(i, 1, { ...src, units: a }, copy);
  return { ...m, rows, seq: m.seq + 1 };
}

export function addRow(m: SplitModel): SplitModel {
  if (m.rows.length >= MAX_ROOT_SPLIT_PARTS) return m;
  const row: SplitRow = { key: `n${m.seq}`, name: m.defaultName, units: 0, fixed: false };
  return rebalance({ ...m, rows: [...m.rows, row], seq: m.seq + 1 }, true);
}

export function removeRow(m: SplitModel, key: string): SplitModel {
  if (m.rows.length <= 1) return m;
  return rebalance({ ...m, rows: m.rows.filter((r) => r.key !== key) });
}

export function equalize(m: SplitModel): SplitModel {
  return rebalance({ ...m, rows: m.rows.map((r) => ({ ...r, fixed: false })) }, true);
}

export type SplitError = 'EMPTY_NAME' | 'LONG_NAME' | 'ZERO' | 'SUM' | 'TOO_FEW' | 'TOO_MANY';

export interface SplitCheck {
  ok: boolean;
  rowErrors: Record<string, SplitError>;
  error: SplitError | null;
  sum: number;
}

/** `minParts`: явцгүй таскт 2 (эх таск + дор хаяж нэг шинэ), явцтайд 1. */
export function checkSplit(m: SplitModel, minParts: number): SplitCheck {
  const rowErrors: Record<string, SplitError> = {};
  for (const r of m.rows) {
    const name = squash(r.name);
    if (name === '') rowErrors[r.key] = 'EMPTY_NAME';
    else if (name.length > MAX_ROOT_SPLIT_NAME) rowErrors[r.key] = 'LONG_NAME';
    else if (!(r.units > 0)) rowErrors[r.key] = 'ZERO';
  }
  const sum = sumOf(m);
  let error: SplitError | null = null;
  if (m.rows.length > MAX_ROOT_SPLIT_PARTS) error = 'TOO_MANY';
  else if (m.rows.length < minParts) error = 'TOO_FEW';
  else if (sum !== ROOT_TOTAL_UNITS) error = 'SUM';
  else error = Object.values(rowErrors)[0] ?? null;
  return { ok: error === null, rowErrors, error, sum };
}

export function toSplitBody(m: SplitModel): Array<{ name: string; share_units: number }> {
  return m.rows.map((r) => ({ name: squash(r.name), share_units: r.units }));
}

/** Хувийг таскийн жинд (0.01-ийн нарийвчлалтай) — сервертэй ижил хамгийн их үлдэгдлийн арга, урьдчилсан харагдацад. */
export function previewWeights(total: number, m: SplitModel): number[] {
  const cents = Math.round(total * 100);
  const units = m.rows.map((r) => Math.max(0, r.units));
  if (units.every((u) => u === 0)) return units.map(() => 0);
  return largestRemainder(cents, units).map((c) => c / 100);
}
