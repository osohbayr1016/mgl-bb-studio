/**
 * ӨӨРИЙН ЯВЦЫН НООРОГ + ХАДГАЛАЛТ (2026-10-02) — модулийн түвшний ГАНЦ эх сурвалж.
 * 2026-10-06 (эзэн): автомат хадгалалт БАЙХГҮЙ — ноорог зөвхөн «Хадгалах» товчоор (`saveNow`) бичигдэнэ.  Хадгалаагүй
 * ноорог төслийн хуудасны явцын bar-д урьдчилан харагдана (`useOwnDraftPreview`).
 *
 * Төслийн хуудасны мөр, «Миний ажлууд»-ын мөр хоёр ИЖИЛ таскийг харуулж болно — хоёр нь нэг ноорог (`Draft`)-ыг
 * хуваалцана (`useSyncExternalStore`).  Компонент unmount болсон ч (хуудас солих) ноорог санах ойд үлдэнэ (сонсогчгүй
 * clean ноорог л `gc`-ээр чөлөөлөгдөнө).
 *
 * Бичилтийн дүрэм (`ownProgress.ts` цэвэр загвар, сервер `POST /tasks/:id/allocation/progress`):
 *   • `−`/`+` бүр ноорог л өөрчилнө; «Хадгалах» (`saveNow`) дарахад ГАНЦ бичилт.
 *   • Ноорог зорилтод хүрэх / үндсэн ажлыг 100% болгох бол ЭХЛЭЭД дуусгах асуулт (`qaNeed`) — хариулах хүртэл
 *     автомат хадгалалт ЯВАХГҮЙ; хариулсны дараа ШУУД хадгална (цонх нь өөрөө баталгаажуулалт).
 *   • Хадгалалт явж байхад ноорог өөрчлөгдөхгүй (UI товч түгжигдэнэ).
 *   • 409 `STALE_REVISION` → серверийн шинэ төлөвт «дахин суугаад» ӨӨРИЙН ноорогийг (хүрээнд хавчуулж) НЭГ удаа
 *     автоматаар дахин илгээнэ; дахин ч зөрвөл алдаа.  `request_id` нь ижил ноорогт ижил — сүлжээний давталт
 *     давхар бичилт үүсгэхгүй (сервер идемпотент).
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { invalidateAttendanceStatus } from '@/features/attendance/attendanceStatus';
import { queryClient } from '@/shared/api/queryClient';

import {
  ALLOCATION_PREFIX,
  CONTRIBUTORS_PREFIX,
  newRequestId,
  postProgress,
  toFailure,
  type AllocationFailure,
} from './api';
import {
  ROOT_TOTAL_UNITS,
  applyStep,
  applyTyped,
  attachQa,
  baseFromRoot,
  cancelQa as cancelQaOn,
  newDraft,
  rebase,
  revert as revertOn,
  setDesired,
  type Draft,
  type OwnBase,
  type SavedInfo,
  type StepKind,
  type TypedResult,
} from './ownProgress';
import type { StepMode } from './units';
import { OFFICIAL_TIMER_STATE_KEY, OFFICIAL_TIMER_WORKING_KEY } from '@/features/task-timer/officialTimer';
import { MY_TASKS_KEY } from '@/features/tasks/myTaskList';

interface Entry {
  draft: Draft;
  /** 409-ийн дараа автоматаар дахин илгээсэн эсэх (давталтыг хязгаарлана). */
  rebased: boolean;
  /** Бичилтэд хавсаргах тэмдэглэл, хавсралт (сонголттой) — ноорогтой хамт. */
  notes: string | null;
  attachments: unknown[];
}

const entries = new Map<number, Entry>();
/** Сонсогчид ноорогоос ТУСДАА: hook эхлээд subscribe хийж, дараа нь (effect-д) `sync` хийдэг. */
const listeners = new Map<number, Set<() => void>>();
let savedSeq = 0;
let globalHooksInstalled = false;

/* ------------------------------------------------------------------ */
/*  Дотоод                                                               */
/* ------------------------------------------------------------------ */

function notify(taskId: number): void {
  const set = listeners.get(taskId);
  if (set) for (const fn of [...set]) fn();
}

function setDraft(taskId: number, e: Entry, draft: Draft): void {
  if (draft === e.draft) return;
  e.draft = draft;
  notify(taskId);
}

/** Идэвхгүй (clean, сонсогчгүй) мөрийг санах ойгоос чөлөөлнө. */
function gc(taskId: number, e: Entry): void {
  if ((listeners.get(taskId)?.size ?? 0) === 0 && e.draft.phase === 'clean') {
    entries.delete(taskId);
  }
}

function installGlobalHooks(): void {
  if (globalHooksInstalled || typeof document === 'undefined') return;
  globalHooksInstalled = true;
  // Хадгалагдаагүй өөрчлөлттэй хуудас хаагдах гэж байвал анхааруулна.
  window.addEventListener('beforeunload', (ev) => {
    for (const e of entries.values()) {
      if (e.draft.phase === 'dirty' || e.draft.phase === 'saving' || e.draft.phase === 'error') {
        ev.preventDefault();
        ev.returnValue = '';
        return;
      }
    }
  });
}

function errorOf(f: AllocationFailure): { code: string; message: string; retryable: boolean } {
  return { code: f.code, message: f.message, retryable: f.network };
}

/** Бичилтийн дараа хамаарах query-нуудыг шинэчилнэ (мөр тус бүрийн props шинэчлэгдэнэ). */
export function invalidateAfterProgress(): void {
  void queryClient.invalidateQueries({ queryKey: MY_TASKS_KEY });
  void queryClient.invalidateQueries({ queryKey: CONTRIBUTORS_PREFIX });
  void queryClient.invalidateQueries({ queryKey: ALLOCATION_PREFIX });
  void queryClient.invalidateQueries({
    predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/progress/my-recent'),
  });
  // 100% хаалт / өөрийн хэсэг дуусах нь албан таймерыг сервер дээр зогсооно.
  void queryClient.invalidateQueries({ queryKey: OFFICIAL_TIMER_STATE_KEY });
  void queryClient.invalidateQueries({ queryKey: [OFFICIAL_TIMER_WORKING_KEY] });
  // Явц = «Гарах»-ын нөхцөл (`progress_logged_today`) — ирцийн төлвийг ч шинэчилнэ.
  invalidateAttendanceStatus();
  // Төслийн хуудас, самбарууд `progress:submitted`-ийг сонсдог (`useProjectDetail`).
  window.dispatchEvent(new CustomEvent('progress:submitted'));
}

/* ------------------------------------------------------------------ */
/*  Хадгалах                                                            */
/* ------------------------------------------------------------------ */

async function commit(taskId: number): Promise<void> {
  const e = entries.get(taskId);
  if (!e) return;
  let d = e.draft;
  if (d.phase === 'saving') return;
  if (d.desired === d.base.done) {
    setDraft(taskId, e, revertOn(d));
    return;
  }
  // QA шаардсан ноорог хариултгүйгээр явахгүй — цонх хүлээж байна.
  if (d.qaNeed && !d.qa) return;

  const requestId = d.requestId ?? newRequestId();
  d = { ...d, phase: 'saving', requestId, error: null };
  setDraft(taskId, e, d);

  try {
    const res = await postProgress(
      taskId,
      { requestId, expectedRevision: d.base.revision },
      {
        done_units: d.desired,
        ...(e.notes ? { notes: e.notes } : {}),
        ...(e.attachments.length > 0 ? { attachments: e.attachments } : {}),
        completion_qa: d.qa,
      },
    );
    const nb = baseFromRoot(res.root, d.base.userId);
    e.rebased = false;
    e.notes = null;
    e.attachments = [];
    savedSeq += 1;
    const saved: SavedInfo = {
      seq: savedSeq,
      at: Date.now(),
      kind: res.kind,
      reachedOwnCap: res.reached_own_cap,
      completedRoot: res.completed_root,
      reopenedRoot: res.reopened_root,
      amount: res.points ? res.points.amount : res.reversed ? -res.reversed.amount : null,
    };
    // Хариунд миний хуваарилалт байхгүй (хассан) бол өмнөх суурийг л шинэчилнэ.
    const fresh = nb ? newDraft(nb) : newDraft({ ...d.base, revision: res.root.revision, done: d.desired });
    setDraft(taskId, e, { ...fresh, lastSaved: saved });
    invalidateAfterProgress();
    gc(taskId, e);
  } catch (err) {
    const f = toFailure(err);
    handleFailure(taskId, e, d, f);
  }
}

function handleFailure(taskId: number, e: Entry, sent: Draft, f: AllocationFailure): void {
  const dirty: Draft = { ...e.draft, phase: 'dirty' };

  // Сүлжээ — ижил `request_id`-тай дараа нь дахин оролдоно (сервер идемпотент).
  if (f.network) {
    setDraft(taskId, e, { ...dirty, phase: 'error', error: errorOf(f) });
    return;
  }

  // Идэвхжүүлэлтийн хаалга (423 түр түгжээ / 426 хуучирсан хуудас): сервер хүсэлтийг ХҮЛЭЭН АВААГҮЙ (юу ч бичигдээгүй) тул ноорог
  // хэвээр, дараа нь (удирдлага нээсний дараа / хуудсаа шинэчилсний дараа) «Дахин оролдох»-оор илгээж болно.
  if (f.status === 423 || f.status === 426) {
    setDraft(taskId, e, { ...dirty, phase: 'error', requestId: null, error: { code: f.code, message: f.message, retryable: true } });
    return;
  }

  // Дуусгах асуулт шаардлагатай (клиентийн таамаг зөрсөн) — цонх нээгдэнэ, хариулсны дараа дахин илгээнэ.
  if (f.code === 'completion_qa required') {
    setDraft(taskId, e, {
      ...dirty,
      qa: null,
      requestId: null,
      qaNeed: { scopes: f.extra.scopes ?? { own: true, root: false }, questions: f.extra.questions ?? null },
      beforeQa: dirty.beforeQa ?? sent.base.done,
      error: null,
    });
    return;
  }

  // Зэрэг өөрчлөлт — серверийн шинэ төлөвт суугаад ӨӨРИЙН ноорогийг НЭГ удаа автоматаар дахин илгээнэ.
  if (f.code === 'STALE_REVISION') {
    const nb = f.extra.current ? baseFromRoot(f.extra.current, sent.base.userId) : null;
    if (!nb) {
      setDraft(taskId, e, { ...dirty, phase: 'error', error: { code: 'NO_ALLOCATION', message: f.message, retryable: false } });
      invalidateAfterProgress();
      return;
    }
    const rebased = rebase({ ...dirty, requestId: null }, nb);
    if (!e.rebased && rebased.phase === 'dirty' && !rebased.qaNeed) {
      e.rebased = true;
      setDraft(taskId, e, rebased);
      void commit(taskId);
      return;
    }
    e.rebased = false;
    setDraft(
      taskId,
      e,
      rebased.phase === 'clean'
        ? rebased
        : { ...rebased, phase: rebased.qaNeed ? 'dirty' : 'error', error: rebased.qaNeed ? null : errorOf(f) },
    );
    invalidateAfterProgress();
    return;
  }

  // Бусад (BELOW_FLOOR, OVER_TARGET, TAKE_REQUIRED, PROJECT_INACTIVE …) — ноорог хэвээр, алдаа харагдана.
  setDraft(taskId, e, { ...dirty, phase: 'error', requestId: null, error: errorOf(f) });
  if (f.code === 'BELOW_FLOOR' || f.code === 'OVER_TARGET' || f.code === 'NO_ALLOCATION') {
    // Клиентийн хүрээ хуучирсан — шинэ төлөв татаж props-оор дахин суулгана.
    invalidateAfterProgress();
  }
}

/* ------------------------------------------------------------------ */
/*  Нийтийн API                                                          */
/* ------------------------------------------------------------------ */

function ensure(base: OwnBase): Entry {
  let e = entries.get(base.taskId);
  if (!e) {
    e = { draft: newDraft(base), rebased: false, notes: null, attachments: [] };
    entries.set(base.taskId, e);
    installGlobalHooks();
  }
  return e;
}

export const ownProgressStore = {
  /** Серверийн (props) төлөвийг ноороготой тулгана — хуучин revision, явж буй хадгалалтыг ХЭЗЭЭ Ч дарахгүй. */
  sync(base: OwnBase): void {
    const e = ensure(base);
    if (e.draft.phase === 'saving') return;
    const next = rebase(e.draft, base);
    setDraft(base.taskId, e, next);
  },

  snapshot(taskId: number): Draft | null {
    return entries.get(taskId)?.draft ?? null;
  },

  subscribe(taskId: number, fn: () => void): () => void {
    let set = listeners.get(taskId);
    if (!set) listeners.set(taskId, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) listeners.delete(taskId);
      const e = entries.get(taskId);
      if (e) gc(taskId, e);
    };
  },

  /** `−` / `+` / «Үлдсэн ажлаа дуусгах». */
  step(taskId: number, kind: StepKind, mode: StepMode): void {
    const e = entries.get(taskId);
    if (!e) return;
    e.rebased = false;
    setDraft(taskId, e, applyStep(e.draft, kind, mode));
  },

  /** Тоо бичих (ХАТУУ задлалт) — буруу бол ноорог өөрчлөгдөхгүй, алдаа буцна. */
  typed(taskId: number, text: string): TypedResult | null {
    const e = entries.get(taskId);
    if (!e) return null;
    const r = applyTyped(e.draft, text);
    if (r.ok) {
      e.rebased = false;
      setDraft(taskId, e, r.draft);
    }
    return r;
  },

  /** Бичилтэд хавсаргах тэмдэглэл, хавсралт (дуудагчийн ноорог) — ноорог өөрчлөгдөхгүй. */
  setReport(taskId: number, notes: string | null, attachments: unknown[]): void {
    const e = entries.get(taskId);
    if (!e) return;
    e.notes = notes && notes.trim() ? notes : null;
    e.attachments = attachments;
  },

  /** Ноорогийг шууд нэгжээр тогтооно (жишээ нь checklist «3/5 → 60%»); [floor, target]-д хавчигдана. */
  setUnits(taskId: number, units: number): void {
    const e = entries.get(taskId);
    if (!e) return;
    e.rebased = false;
    setDraft(taskId, e, setDesired(e.draft, units));
  },

  /** «Өөрчлөлт буцаах». */
  revert(taskId: number): void {
    const e = entries.get(taskId);
    if (!e) return;
    setDraft(taskId, e, revertOn(e.draft));
  },

  /** «Одоо хадгалах». */
  saveNow(taskId: number): Promise<void> {
    return commit(taskId);
  },

  /** Алдаанаас дахин оролдох (ижил ноорог, ижил `request_id`). */
  retry(taskId: number): Promise<void> {
    const e = entries.get(taskId);
    if (!e) return Promise.resolve();
    e.draft = { ...e.draft, phase: 'dirty', error: null };
    return commit(taskId);
  },

  /** Дуусгах асуултад хариулсан — ноорогт хавсаргаад ШУУД хадгална. */
  confirmQa(taskId: number, qa: Record<string, string>): Promise<void> {
    const e = entries.get(taskId);
    if (!e) return Promise.resolve();
    setDraft(taskId, e, attachQa(e.draft, qa));
    return commit(taskId);
  },

  /** Дуусгах асуултын цонхыг «болих» — QA-д хүргэсэн өөрчлөлтийг л буцаана. */
  cancelQa(taskId: number): void {
    const e = entries.get(taskId);
    if (!e) return;
    setDraft(taskId, e, cancelQaOn(e.draft));
  },
} as const;

/** Хадгалаагүй ноорогийн урьдчилсан харагдац — үндсэн мөрийн bar «хэрэв хадгалвал» хаана очихыг харуулна.
 *  Ноорог байхгүй / clean бол null. */
export interface OwnDraftPreview {
  /** Хадгалаагүй өөрчлөлт (нэгжээр, + / −). */
  deltaUnits: number;
  desired: number;
  target: number;
}

export function useOwnDraftPreview(taskId: number): OwnDraftPreview | null {
  const subscribe = useCallback((fn: () => void) => ownProgressStore.subscribe(taskId, fn), [taskId]);
  const getSnapshot = useCallback(() => ownProgressStore.snapshot(taskId), [taskId]);
  const d = useSyncExternalStore(subscribe, getSnapshot, () => null);
  return useMemo(() => {
    if (!d || d.phase === 'clean' || d.desired === d.base.done) return null;
    return { deltaUnits: d.desired - d.base.done, desired: d.desired, target: d.base.target };
  }, [d]);
}

/** Үндсэн ажлын харагдах явц (%): серверийн утга + миний хадгалаагүй өөрчлөлт (1% = ROOT_TOTAL_UNITS / 100 нэгж). */
export function previewProgress(progress: number, preview: OwnDraftPreview | null): number {
  if (!preview) return progress;
  return Math.max(0, Math.min(100, progress + (preview.deltaUnits / ROOT_TOTAL_UNITS) * 100));
}

/** Тестэд/хуудас солиход: бүх ноорогийг цэвэрлэнэ. */
export function resetOwnProgressStore(): void {
  entries.clear();
  listeners.clear();
}

