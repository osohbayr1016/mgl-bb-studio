/**
 * MGL AI · ЛОКАЛ УРТ ХУГАЦААНЫ САНАМЖ — ХӨТЧИЙН ХАДГАЛАЛТЫН ADAPTER (§34–36, §90).
 *
 * ⚠️ ЛОГИК ЭНД БАЙХГҮЙ.  Санамжийн сонголт, дохионоос шинэчлэх, хуучирсныг хасах,
 *    утас руу хөрвүүлэх — бүгд `@mgl/mglai-common/turn` (memory.ts) — хөтөч · ажилтны
 *    runtime · Revit ИЖИЛ хэрэгжүүлэлт.  Энэ файл зөвхөн `localStorage`-ийг `MemoryStorage`
 *    болгон өгч, хуучин гарын үсгийг (`loadMemories(ns)`, `saveMemories(ns, items)`) хадгална.
 *
 * ⚠️ ГУРВАН ТҮВШИН, ЭНЭ НЬ ГУРАВ ДАХЬ: ээлж (сервер `turn.ts`) · яриа (сервер `convState.ts`,
 *    клиентээр дамждаг) · ХУВИЙН — ажилтны PC, хөтчийн localStorage, `memory_namespace`-аар
 *    тусгаарлагдсан.  Cloudflare руу ХЭЗЭЭ Ч хадгалагдахгүй (§36).
 *
 * ⚠️ localStorage нь try/catch — private горим, хаагдсан хадгалалт, `globalThis.localStorage`
 *    огт байхгүй (тест) үед ч чат ажилласаар: санамжгүй = хоосон, алдаа биш.
 */
import {
  loadMemories as loadFrom,
  saveMemories as saveTo,
  type MemoryItem,
  type MemoryStorage,
} from '@mgl/mglai-common/turn';

export {
  upsertFromHint,
  isStandingHint,
  selectMemories,
  markUsed,
  removeMemory,
  toWire,
  type MemoryType,
  type MemoryItem,
  type MemoryHint,
  type MemoryStorage,
} from '@mgl/mglai-common/turn';

/** Хөтчийн `localStorage` — байхгүй/хаалттай бол `null`/no-op. */
export const browserMemoryStorage: MemoryStorage = {
  getItem(k) {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem(k, v) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
    } catch {
      // хадгалалт хаалттай — чат ажилласаар
    }
  },
};

export function loadMemories(namespace: string): MemoryItem[] {
  return loadFrom(namespace, browserMemoryStorage);
}

export function saveMemories(namespace: string, items: readonly MemoryItem[]): void {
  saveTo(namespace, items, browserMemoryStorage);
}
