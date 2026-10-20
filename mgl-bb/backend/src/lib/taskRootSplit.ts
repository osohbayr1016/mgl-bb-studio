/**
 * ТАСКИЙГ ҮНДСЭН ТАСКУУД БОЛГОН ХУВААХ — цэвэр дүрэм (эзэн 2026-10-09, migration 0395).  D1 уншихгүй.
 *
 * Хэрэглэгч хэсэг бүрт НЭР + ХУВЬ бичнэ.  Хувь нь хуваагдах ажлын (явцгүй бол бүх таск, явцтай бол ҮЛДСЭН хэсэг)
 * хувь — нэгжээр (1% = 10 000, нийлбэр ЯГ 1 000 000).  Сервер үүнийг таскийн жин (`weight_percent`, 0.01-ийн
 * нарийвчлал) болгож хувиргаад `planSplit`-аар (2026-09-25-ны дүрэм, `taskSplit.ts`) шалгана:
 *   • явцгүй таск ('whole')     — эх таск = эхний хэсэг (id хэвээр), бусад нь шинэ таск;
 *   • явцтай таск ('remainder') — эх таск «хийгдсэн хэсэг» болж W × p / 100 жинтэйгээр 100%-иар хаагдана, бүх
 *     хэсэг ШИНЭ таск — төслийн явц ЯГ хэвээр.
 * Хадгалалт, буцаалт: `taskRootSplitStore.ts`.
 */
import { MAX_SPLIT_PARTS, planSplit } from './taskSplit';

export const ROOT_SPLIT_TOTAL_UNITS = 1_000_000;
export const MAX_ROOT_SPLIT_PARTS = MAX_SPLIT_PARTS;
export const MAX_ROOT_SPLIT_NAME = 200;

export interface RootSplitPartInput {
  name: string;
  /** Хуваагдах ажлын хувь (нэгжээр, 1% = 10 000). */
  share_units: number;
}

export type RootSplitPlan =
  | {
      ok: true;
      mode: 'whole' | 'remainder';
      /** remainder: эх таскийн шинэ жин (хийгдсэн хэсэг); whole: 0. */
      doneWeight: number;
      /** Хэсэг бүрийн нэр, жин (дарааллаараа).  whole: [0] = эх таск. */
      names: string[];
      weights: number[];
    }
  | { ok: false; code: RootSplitPlanError; message: string };

export type RootSplitPlanError = 'BAD_PARTS' | 'EMPTY_NAME' | 'LONG_NAME' | 'BAD_SHARE' | 'SUM_MISMATCH' | 'TOO_FEW' | 'TOO_MANY' | 'TOO_SMALL' | 'BAD_WEIGHT';

export const squashName = (s: string): string => s.trim().replace(/\s+/g, ' ');

/** Хувийг (нэгж) жинд хувиргана: нийт жингийн центийг (0.01) хамгийн их үлдэгдлийн аргаар хуваана — нийлбэр ЯГ хадгалагдана. */
export function sharesToWeights(total: number, shares: readonly number[]): number[] {
  const totalCents = Math.round(total * 100);
  const sum = shares.reduce((s, x) => s + x, 0);
  if (sum <= 0) return shares.map(() => 0);
  const raw = shares.map((s) => (totalCents * s) / sum);
  const base = raw.map((r) => Math.floor(r));
  let rest = totalCents - base.reduce((s, x) => s + x, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) {
    if (rest <= 0) break;
    base[o.i]! += 1;
    rest -= 1;
  }
  return base.map((c) => c / 100);
}

/** Хийгдсэн хэсгийн нэр (явцтай хуваалтад эх таск). */
export function doneTaskName(name: string, progress: number): string {
  const pct = Math.round(progress * 100) / 100;
  const suffix = ` (хийгдсэн ${pct}%)`;
  const base = squashName(name);
  return (base.length + suffix.length > MAX_ROOT_SPLIT_NAME ? base.slice(0, MAX_ROOT_SPLIT_NAME - suffix.length) : base) + suffix;
}

export function planRootSplit(weight: number, progress: number, raw: unknown): RootSplitPlan {
  const W = Number(weight);
  if (!Number.isFinite(W) || W <= 0) return { ok: false, code: 'BAD_WEIGHT', message: 'Жингүй таскийг хуваах боломжгүй' };
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, code: 'BAD_PARTS', message: 'Хэсгүүд байхгүй байна' };
  if (raw.length > MAX_ROOT_SPLIT_PARTS) {
    return { ok: false, code: 'TOO_MANY', message: `Хамгийн ихдээ ${MAX_ROOT_SPLIT_PARTS} хэсэг` };
  }
  const remainder = Number(progress) > 0;
  const minParts = remainder ? 1 : 2;
  if (raw.length < minParts) return { ok: false, code: 'TOO_FEW', message: `Дор хаяж ${minParts} хэсэг` };
  const names: string[] = [];
  const shares: number[] = [];
  for (const item of raw) {
    const o = (item ?? {}) as { name?: unknown; share_units?: unknown };
    if (typeof o.name !== 'string') return { ok: false, code: 'BAD_PARTS', message: 'Хэсэг бүр нэртэй байна' };
    const name = squashName(o.name);
    if (name === '') return { ok: false, code: 'EMPTY_NAME', message: 'Хэсэг бүрт нэр бичнэ үү' };
    if (name.length > MAX_ROOT_SPLIT_NAME) {
      return { ok: false, code: 'LONG_NAME', message: `Нэр ${MAX_ROOT_SPLIT_NAME} тэмдэгтээс урт байна` };
    }
    const s = o.share_units;
    if (typeof s !== 'number' || !Number.isInteger(s) || s <= 0 || s > ROOT_SPLIT_TOTAL_UNITS) {
      return { ok: false, code: 'BAD_SHARE', message: 'Хэсэг бүрийн хувь 0-ээс их байна' };
    }
    names.push(name);
    shares.push(s);
  }
  const sum = shares.reduce((a, b) => a + b, 0);
  if (sum !== ROOT_SPLIT_TOTAL_UNITS) {
    return { ok: false, code: 'SUM_MISMATCH', message: 'Хэсгүүдийн хувийн нийлбэр 100% байх ёстой' };
  }
  const doneWeight = remainder ? (W * Number(progress)) / 100 : 0;
  const weights = sharesToWeights(W - doneWeight, shares);
  if (weights.some((w) => w <= 0)) {
    return { ok: false, code: 'TOO_SMALL', message: 'Хэсэг хэт жижиг байна (таскийн жингийн 0.01%-иас бага)' };
  }
  const plan = planSplit(W, Number(progress), weights);
  if (!plan.ok) return { ok: false, code: 'BAD_PARTS', message: plan.error };
  return { ok: true, mode: plan.mode, doneWeight: plan.doneWeight, names, weights: plan.parts };
}

/* ------------------------------------------------------------------ */
/*  Буцаах                                                              */
/* ------------------------------------------------------------------ */

export type UndoBlockerCode =
  | 'MISSING'
  | 'WEIGHT_CHANGED'
  | 'HAS_PROGRESS'
  | 'HAS_POINTS'
  | 'HAS_ALLOCATION'
  | 'HAS_DEADLINE'
  | 'HAS_MILESTONE'
  | 'HAS_REPAIR'
  | 'HAS_SHARES'
  | 'SPLIT_AGAIN'
  | 'ORIGINAL_PROGRESS';

export interface UndoBlocker {
  task_id: number;
  name: string;
  code: UndoBlockerCode;
}

const BLOCKER_TEXT: Record<UndoBlockerCode, string> = {
  MISSING: 'устгагдсан байна',
  WEIGHT_CHANGED: 'жин нь хуваасны дараа өөрчлөгдсөн',
  HAS_PROGRESS: 'дээр хувь оруулсан',
  HAS_POINTS: 'оноо олгогдсон',
  HAS_ALLOCATION: 'хүмүүст хуваарилагдсан (эхлээд «Хуваалтыг цуцлах»)',
  HAS_DEADLINE: 'дэд хугацаатай',
  HAS_MILESTONE: 'гол үе шаттай холбогдсон',
  HAS_REPAIR: 'засварын цаг бүртгэгдсэн',
  HAS_SHARES: 'хамтарсан хуваалттай',
  SPLIT_AGAIN: 'дахин хуваагдсан (эхлээд тэр хуваалтыг буцаа)',
  ORIGINAL_PROGRESS: 'дээр хуваасны дараа хувь оруулсан',
};

export function undoBlockerText(b: UndoBlocker): string {
  return `«${b.name}» ${BLOCKER_TEXT[b.code]}`;
}

/** Хэрэглэгчид харуулах нэг мөрт тайлбар. */
export function undoBlockedMessage(list: readonly UndoBlocker[]): string {
  const head = list.slice(0, 3).map(undoBlockerText).join('; ');
  const more = list.length > 3 ? ` (+${list.length - 3})` : '';
  return `Хуваалтыг буцаах боломжгүй: ${head}${more}.`;
}
