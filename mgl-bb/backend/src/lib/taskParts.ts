/**
 * ХҮНГҮЙ ХЭСЭГ — цэвэр дүрэм (migration 0394, эзэн 2026-10-09).
 *
 * Хэсэг = үндсэн ажлын хуваарилагдаагүй ирээдүйн ажлын (`U`) НЭРЛЭСЭН нөөц.  Хэсэгт хүн, хийсэн (D), оноо БАЙХГҮЙ.
 *
 *   Σ хэсэг ≤ U          чөлөөт (нэргүй) ажил = U − Σ хэсэг
 *
 * Хэсгийг ажилтан АВАХАД (`claim`) түүний хуваарилалт болж (T += units) хэсэг устна, U −= units.
 * Хуваарилалтын инвариант (`taskAllocation.ts` `checkRootInvariants`: Σ T + B + U = 100) хэвээр — хэсэг нь U-ийн ДОТОР.
 *
 * Энэ файл ЦЭВЭР — D1 уншихгүй.
 */
import { ROOT_TOTAL_UNITS, isUnits } from './taskUnits';

/** Нэг таскийн хэсгийн дээд тоо (хуваарилалтын `MAX_ACTIVE_ALLOCATIONS`-тай ижил). */
export const MAX_TASK_PARTS = 20;
/** Хэсгийн нэрийн урт (хуваарилалтын мөрийн нэртэй ижил, 0393). */
export const MAX_PART_LABEL = 120;

export interface PartRecord {
  id: number;
  ordinal: number;
  label: string;
  units: number;
}

/** Засварлагчийн илгээх хэсэг: `id` байвал одоо байгаа хэсэг (нэр/хувь засна), үгүй бол шинэ. */
export interface PartInput {
  id?: number | null;
  label: string;
  units: number;
}

export const squashLabel = (s: string): string => s.trim().replace(/\s+/g, ' ');

export const reservedUnitsOf = (parts: readonly { units: number }[]): number =>
  parts.reduce((s, p) => s + p.units, 0);

export type PartsPlanError = 'TOO_MANY' | 'BAD_LABEL' | 'BAD_VALUE' | 'UNKNOWN_PART' | 'OVER_FREE';

export interface PlannedPart {
  /** Одоо байгаа хэсгийн id; шинэ бол null. */
  id: number | null;
  ordinal: number;
  label: string;
  units: number;
}

export type PartsPlan =
  | {
      ok: true;
      parts: PlannedPart[];
      /** Устгах хэсгүүдийн id (жагсаалтаас хасагдсан). */
      removed: number[];
      nextOrdinal: number;
    }
  | { ok: false; code: PartsPlanError; message: string; index?: number };

/**
 * Хэсгүүдийн шинэ БҮРЭН жагсаалтыг шалгаж төлөвлөнө.  `available` = хэсгүүдэд хуваарилж болох нийт (одоогийн U — хуучин
 * хэсгүүд нь U-ийн дотор тул тэднийг оруулсан хэмжээ).  Хоосон жагсаалт = бүх хэсгийг устгах (ажил чөлөөт U болж үлдэнэ).
 * Шинэ хэсэг `nextOrdinal`-оос дугаар авна (хуваарилалттай НЭГ тоолуур, дахин ашиглагдахгүй).
 */
export function planParts(
  existing: readonly PartRecord[],
  input: readonly PartInput[],
  available: number,
  nextOrdinal: number,
): PartsPlan {
  if (input.length > MAX_TASK_PARTS) {
    return { ok: false, code: 'TOO_MANY', message: `Хамгийн ихдээ ${MAX_TASK_PARTS} хэсэг` };
  }
  const byId = new Map(existing.map((p) => [p.id, p]));
  const seen = new Set<number>();
  const parts: PlannedPart[] = [];
  let next = nextOrdinal;
  let sum = 0;
  for (const [index, p] of input.entries()) {
    const label = typeof p.label === 'string' ? squashLabel(p.label) : '';
    if (label === '' || label.length > MAX_PART_LABEL) {
      return { ok: false, code: 'BAD_LABEL', message: `Хэсгийн нэр хоосон эсвэл ${MAX_PART_LABEL}-аас урт байна`, index };
    }
    if (!isUnits(p.units) || p.units <= 0 || p.units > ROOT_TOTAL_UNITS) {
      return { ok: false, code: 'BAD_VALUE', message: 'Хэсгийн хувь эерэг байх ёстой', index };
    }
    sum += p.units;
    if (p.id !== undefined && p.id !== null) {
      const prev = byId.get(p.id);
      if (!prev || seen.has(p.id)) {
        return { ok: false, code: 'UNKNOWN_PART', message: 'Хэсэг олдсонгүй (өөр хүн өөрчилсөн байж магадгүй)', index };
      }
      seen.add(p.id);
      parts.push({ id: p.id, ordinal: prev.ordinal, label, units: p.units });
    } else {
      parts.push({ id: null, ordinal: next++, label, units: p.units });
    }
  }
  if (sum > available) {
    return {
      ok: false,
      code: 'OVER_FREE',
      message: `Хэсгүүдийн нийлбэр хуваарилагдаагүй ажлаас (${available / 10_000}%) их байна`,
    };
  }
  const removed = existing.filter((p) => !seen.has(p.id)).map((p) => p.id);
  return { ok: true, parts, removed, nextOrdinal: next };
}

/** Хэсгийг авсан хүний хуваарилалтын шинэ нэр.  Өмнө нь ажил эзэлж байсан (эсвэл хийсэн) бол хоёр нэрийг холбоно. */
export function mergedLabel(prev: { label: string | null; doneUnits: number; targetUnits: number } | null, rootName: string, partLabel: string): string {
  if (!prev || (prev.targetUnits <= 0 && prev.doneUnits <= 0)) return partLabel;
  const base = prev.label && prev.label.trim() !== '' ? prev.label.trim() : rootName.trim();
  if (base === partLabel) return partLabel;
  const joined = `${base} · ${partLabel}`;
  return joined.length > MAX_PART_LABEL ? `${joined.slice(0, MAX_PART_LABEL - 1)}…` : joined;
}
