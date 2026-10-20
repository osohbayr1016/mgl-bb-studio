import { useCallback, useEffect, useMemo, useState } from 'react';
import { EMPTY_DRAFT, sanitizeDraft, type DailyDraft } from './types';

/**
 * Өдөр тутмын тайлангийн ноорогийг localStorage-д цуваадаг hook.
 *
 * Урьд нь ноорог зөвхөн `useState`-д байсан: хуудсаа сэргээх, утас
 * түгжигдэх, эсвэл PWA-г background-аас унших бүрд бичсэн тэмдэглэл
 * ор мөргүй алга болдог байв.  Ажилтан 10 мөр бөглөөд алдвал тэр
 * өдрийн тайлагнал бүхэлдээ дахин бичигдэнэ.
 *
 * Гэрээ:
 *  • Түлхүүр нь ХЭРЭГЛЭГЧ тус бүрд (`…:<userId>`) — нэг компьютер дээр
 *    хоёр хүн ээлжлэн ороход нөгөөгийнх нь ноорог харагдахгүй.
 *  • Хадгалсан огноо ӨНӨӨДРИЙНХӨӨС өөр бол бүхэлд нь хаяна — өчигдрийн
 *    хагас бөглөсөн % өнөөдрийн тайланд санамсаргүй орохоос сэргийлнэ.
 *  • Бичилт debounce-той (250 мс): товчлуур бүр дээр localStorage
 *    бичих нь утсан дээр мэдэгдэхүйц удаашруулдаг.
 *  • Бүх localStorage хандалт try/catch дотор — Safari private mode,
 *    квот дүүрсэн, эсвэл гэмтсэн JSON нь тайлагналыг ЗОГСООХ ЁСГҮЙ.
 */

const STORAGE_PREFIX = 'mgl:mytasks:drafts:v1';

interface StoredShape {
  date: string;
  drafts: Record<string, unknown>;
}

function keyFor(userId: number | null | undefined): string | null {
  return userId ? `${STORAGE_PREFIX}:${userId}` : null;
}

function readStored(storageKey: string, today: string): Record<number, DailyDraft> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredShape | null;
    if (!parsed || typeof parsed !== 'object') return {};
    // Өчигдрийн ноорог — хаяна (дээрх гэрээг үз).
    if (parsed.date !== today) {
      localStorage.removeItem(storageKey);
      return {};
    }
    const out: Record<number, DailyDraft> = {};
    for (const [id, value] of Object.entries(parsed.drafts ?? {})) {
      const taskId = Number(id);
      if (!Number.isInteger(taskId)) continue;
      const draft = sanitizeDraft(value);
      if (draft) out[taskId] = draft;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStored(storageKey: string, today: string, drafts: Record<number, DailyDraft>) {
  try {
    // Хоосон ноорогийг хадгалахгүй — түлхүүрийг цэвэрлэнэ.
    const meaningful = Object.entries(drafts).filter(
      ([, d]) => d.value.trim() !== '' || d.notes.trim() !== '' || d.attachments.length > 0,
    );
    if (meaningful.length === 0) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(
      storageKey,
      JSON.stringify({ date: today, drafts: Object.fromEntries(meaningful) } satisfies StoredShape),
    );
  } catch {
    // Квот/private mode — чимээгүй өнгөрнө.  Ноорог санах ойд хэвээр.
  }
}

export interface DailyDraftsApi {
  drafts: Record<number, DailyDraft>;
  /** Тухайн мөрийн ноорог; хараахан хөндөөгүй бол `fallbackValue`-тэй шинэ. */
  getDraft: (taskId: number, fallbackValue: number) => DailyDraft;
  updateDraft: (taskId: number, patch: Partial<DailyDraft>) => void;
  /** Илгээгдсэн мөрүүдийг ноорогоос хасна. */
  clearDrafts: (taskIds: number[]) => void;
  /** Олон мөрийн хувийг нэг дор өөрчилнө («бүгдийг +10%»). */
  bumpValues: (taskIds: number[], delta: number, currentOf: (id: number) => number) => void;
  /** Хадгалагдаагүй утга агуулсан мөрийн тоо — самбарт харуулна. */
  dirtyCount: number;
}

export function useDailyDrafts(
  userId: number | null | undefined,
  today: string,
): DailyDraftsApi {
  const storageKey = keyFor(userId);

  // Эхний render дээр шууд уншина — хуудас сэргээхэд ноорог "анивчихгүй".
  const [drafts, setDrafts] = useState<Record<number, DailyDraft>>(() =>
    storageKey ? readStored(storageKey, today) : {},
  );

  // Auth хожуу ирж `storageKey` null → id болж өөрчлөгдвөл нэг удаа дүүргэнэ.
  // Энэ нь React-ийн «props өөрчлөгдөхөд төлөвөө зэрэгцүүлэх» загвар —
  // effect дотор setState хийвэл нэмэлт render цуврал үүсгэнэ.
  const [hydratedKey, setHydratedKey] = useState<string | null>(storageKey);
  if (storageKey && storageKey !== hydratedKey) {
    setHydratedKey(storageKey);
    setDrafts(readStored(storageKey, today));
  }

  useEffect(() => {
    if (!storageKey) return;
    const timer = setTimeout(() => writeStored(storageKey, today, drafts), 250);
    return () => clearTimeout(timer);
  }, [storageKey, today, drafts]);

  const getDraft = useCallback(
    (taskId: number, fallbackValue: number): DailyDraft => {
      const existing = drafts[taskId];
      if (existing) return existing;
      return { ...EMPTY_DRAFT, value: fallbackValue > 0 ? String(fallbackValue) : '' };
    },
    [drafts],
  );

  const updateDraft = useCallback((taskId: number, patch: Partial<DailyDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [taskId]: { ...(prev[taskId] ?? EMPTY_DRAFT), ...patch },
    }));
  }, []);

  const clearDrafts = useCallback((taskIds: number[]) => {
    if (taskIds.length === 0) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const id of taskIds) delete next[id];
      return next;
    });
  }, []);

  const bumpValues = useCallback(
    (taskIds: number[], delta: number, currentOf: (id: number) => number) => {
      if (taskIds.length === 0) return;
      setDrafts((prev) => {
        const next = { ...prev };
        for (const id of taskIds) {
          const base = next[id] ?? { ...EMPTY_DRAFT };
          // Ноорогт бичигдсэн утга байвал түүнээс, эс бөгөөс хадгалагдсан
          // одоогийн явцаас нэмнэ — «+10%» нь ҮРГЭЛЖ харагдаж буй тооноос.
          const parsed = parseFloat(base.value);
          const from = Number.isFinite(parsed) ? parsed : currentOf(id);
          const raised = Math.min(100, Math.max(0, Math.round((from + delta) * 10) / 10));
          next[id] = { ...base, value: String(raised) };
        }
        return next;
      });
    },
    [],
  );

  const dirtyCount = useMemo(
    () =>
      Object.values(drafts).filter(
        (d) => d.value.trim() !== '' || d.notes.trim() !== '' || d.attachments.length > 0,
      ).length,
    [drafts],
  );

  return { drafts, getDraft, updateDraft, clearDrafts, bumpValues, dirtyCount };
}
