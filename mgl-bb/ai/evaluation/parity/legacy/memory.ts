/**
 * MGL AI · ЛОКАЛ УРТ ХУГАЦААНЫ САНАМЖ (§34–36, §90).
 *
 * ⚠️ ГУРВАН ТҮВШИН, ЭНЭ НЬ ГУРАВ ДАХЬ:
 *      1. ээлж          — серверийн `turn.ts`
 *      2. яриа          — серверийн `convState.ts` (клиентээр дамждаг)
 *      3. ХУВИЙН        — ЭНЭ ФАЙЛ: ажилтны PC, хөтчийн localStorage,
 *                         `memory_namespace`-аар тусгаарлагдсан.  Cloudflare
 *                         руу ХЭЗЭЭ Ч хадгалагдахгүй (§36).
 *
 * ⚠️ ЮУ САНАХ ВЭ — ЗӨВХӨН ХЭВ МАЯГ, ИЛ баталсан тохиргоо: хариултын урт,
 *    хэл, хүснэгт хэлбэр, «намайг X гэж дууд», нэр томьёо.  Санамсаргүй
 *    баримт («өнөөдөр хурал») ХЭЗЭЭ Ч санахгүй.  Дохиог СЕРВЕР танина
 *    (`/plan` → `memory_hints`), хадгалахыг ЭНД шийднэ.
 *
 * ⚠️ САНАМЖ БҮР PROMPT-Д ОРОХГҮЙ (§35).  `selectMemories` нь ээлжийн
 *    санаа, асуултаар ШҮҮНЭ: хэв маягийн тохиргоо ≤3, нэр томьёо зөвхөн
 *    асуултад тэр үг байвал, хуучирсан (`expiresAt`) ба удаан хэрэглээгүй
 *    (90 хоног) нь орохгүй.  Identity ЭНД ХЭЗЭЭ Ч БАЙХГҮЙ.
 *
 * ⚠️ localStorage нь try/catch — private горим, хаагдсан хадгалалтад чат
 *    ажилласаар байх ёстой; санамжгүй = хоосон, алдаа биш.
 */

export type MemoryType = 'answer_length' | 'response_language' | 'address_as' | 'terminology' | 'format';

export interface MemoryItem {
  id: string;
  type: MemoryType;
  value: string;
  /** Prompt-д орох мөр — сервер бичсэн. */
  text: string;
  /** Хэрэглэгчид харагдах шошго. */
  label: string;
  importance: 1 | 2 | 3;
  confidence: number;
  createdAt: string;
  lastUsedAt: string | null;
  lastConfirmedAt: string;
  /** ISO огноо — хуучирсан санамж орохгүй. */
  expiresAt: string | null;
  useCount: number;
}

export interface MemoryHint {
  type: MemoryType;
  value: string;
  text: string;
  label: string;
  reason: string;
}

const STORAGE_PREFIX = 'mglai.memory.';
const MAX_ITEMS = 24;
/** 90 хоног хэрэглээгүй санамж prompt-д орохгүй (хадгалагдсан хэвээр). */
const STALE_DAYS = 90;
/** Хэв маягийн тохиргооны дээд тоо нэг ээлжид. */
const MAX_STYLE_LINES = 3;

function key(namespace: string): string {
  return `${STORAGE_PREFIX}${namespace}`;
}

function newId(): string {
  return `mem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function loadMemories(namespace: string): MemoryItem[] {
  try {
    const raw = localStorage.getItem(key(namespace));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMemoryItem);
  } catch {
    return [];
  }
}

export function saveMemories(namespace: string, items: readonly MemoryItem[]): void {
  try {
    localStorage.setItem(key(namespace), JSON.stringify(items.slice(-MAX_ITEMS)));
  } catch {
    // хадгалалт хаалттай — чат ажилласаар
  }
}

function isMemoryItem(v: unknown): v is MemoryItem {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.type === 'string' &&
    typeof r.text === 'string' &&
    typeof r.label === 'string' &&
    typeof r.createdAt === 'string'
  );
}

/**
 * Дохиог санамж болгон нэгтгэнэ.  Ижил төрөл (нэр томьёоноос бусад) → ШИНЭ
 * нь хуучныг СОЛИНО — «богино» гэснийг «дэлгэрэнгүй» гэж засах нь хамгийн
 * түгээмэл засвар (§14: сүүлийн ил засвар ялна).
 */
export function upsertFromHint(
  items: readonly MemoryItem[],
  hint: MemoryHint,
  now = new Date(),
): { items: MemoryItem[]; item: MemoryItem; replaced: boolean } {
  const iso = now.toISOString();
  const existingIdx = items.findIndex(
    (m) => m.type === hint.type && (hint.type === 'terminology' ? m.value === hint.value : true),
  );
  const same = existingIdx >= 0 && items[existingIdx]!.value === hint.value;
  const item: MemoryItem = {
    id: same ? items[existingIdx]!.id : newId(),
    type: hint.type,
    value: hint.value,
    text: hint.text,
    label: hint.label,
    importance: hint.type === 'response_language' ? 3 : 2,
    confidence: 1,
    createdAt: same ? items[existingIdx]!.createdAt : iso,
    lastUsedAt: same ? items[existingIdx]!.lastUsedAt : null,
    lastConfirmedAt: iso,
    expiresAt: null,
    useCount: same ? items[existingIdx]!.useCount : 0,
  };
  const next = items.filter((_, i) => i !== existingIdx);
  next.push(item);
  return { items: next, item, replaced: existingIdx >= 0 && !same };
}

/** Дохио ХАДГАЛАГДАХ ёстой юу — зөвхөн БАЙНГЫН («нэг удаагийн» биш). */
export function isStandingHint(hint: MemoryHint): boolean {
  return !hint.reason.includes('нэг удаагийн');
}

function daysBetween(aIso: string, b: Date): number {
  const a = Date.parse(aIso);
  if (!Number.isFinite(a)) return Infinity;
  return (b.getTime() - a) / 86_400_000;
}

/**
 * ⚠️ ГОЛ ФУНКЦ.  Энэ ээлжид ХАМААРАЛТАЙ санамжийг сонгоно.
 *
 * Дүрэм:
 *   · хуучирсан (`expiresAt` өнгөрсөн), 90 хоног хэрэглээгүй → орохгүй
 *   · `terminology` → ЗӨВХӨН асуултад тэр үг байвал
 *   · `address_as` → зөвхөн мэндчилгээ/мета/өөрийнх нь тухай ээлжид
 *     (identity-ийн ижил бодлого: төслийн асуултад нэр хэрэггүй)
 *   · хэв маяг (урт, хэл, хэлбэр) → үргэлж, гэхдээ ≤3
 */
export function selectMemories(
  items: readonly MemoryItem[],
  ctx: { question: string; intent: string | null },
  now = new Date(),
): MemoryItem[] {
  const q = ctx.question.toLowerCase();
  const selfish = ctx.intent === 'CASUAL' || ctx.intent === 'META';
  const fresh = items.filter((m) => {
    if (m.expiresAt && Date.parse(m.expiresAt) < now.getTime()) return false;
    const lastTouch = m.lastUsedAt ?? m.lastConfirmedAt;
    if (daysBetween(lastTouch, now) > STALE_DAYS) return false;
    return true;
  });
  const out: MemoryItem[] = [];
  for (const m of fresh.sort((a, b) => b.importance - a.importance)) {
    if (m.type === 'terminology') {
      if (q.includes(m.value.toLowerCase())) out.push(m);
      continue;
    }
    if (m.type === 'address_as') {
      if (selfish) out.push(m);
      continue;
    }
    if (out.filter((x) => x.type !== 'terminology' && x.type !== 'address_as').length < MAX_STYLE_LINES) out.push(m);
  }
  return out;
}

/** Хэрэглэсэн санамжийн `lastUsedAt`-ыг шинэчилнэ (хуучралтын тоолуур). */
export function markUsed(items: readonly MemoryItem[], usedIds: readonly string[], now = new Date()): MemoryItem[] {
  const iso = now.toISOString();
  const set = new Set(usedIds);
  return items.map((m) => (set.has(m.id) ? { ...m, lastUsedAt: iso, useCount: m.useCount + 1 } : m));
}

export function removeMemory(items: readonly MemoryItem[], id: string): MemoryItem[] {
  return items.filter((m) => m.id !== id);
}

/** Серверт илгээх хэлбэр — ЗӨВХӨН төрөл ба мөр. */
export function toWire(items: readonly MemoryItem[]): { type: MemoryType; text: string; value: string }[] {
  // `value` нь серверт бүтэцтэй шийдвэрт (хариултын хэл) хэрэгтэй; prompt-д ОРОХГҮЙ.
  return items.map((m) => ({ type: m.type, text: m.text, value: m.value }));
}
