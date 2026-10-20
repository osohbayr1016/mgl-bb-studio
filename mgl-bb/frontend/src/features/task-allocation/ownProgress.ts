/**
 * ӨӨРИЙН ЯВЦЫН НООРГИЙН ЦЭВЭР ЗАГВАР (2026-10-02) — React, сүлжээгүй, `node`-оор шалгагдана (`check:task-units`).
 *
 * Хүн `−` / `+`-ыг олон дарна → юу ч бичигдэхгүй, ноорог (`desired`) л өөрчлөгдөнө.  «Хадгалах» дарахад нэг л бичилт явна
 * (автомат хадгалалт 2026-10-06-нд хасагдсан).  Ноорог ЯМАР Ч ҮЕД `[floor, target]`-ийн дотор (тэр хүрээнээс гарвал сервер ямар ч
 * тохиолдолд татгалзана — клиент урьдчилан хаадаг).
 *
 * Арифметик `units.ts` / `allocation.ts`-ийн ИЖИЛ функцүүд (сервертэй байт-ижил).  Энэ файл тэднийг ЗӨВХӨН ноорогт
 * холбодог: алхам, тоо бичих, урьдчилсан таамаг (QA хэрэгтэй юу), серверийн шинэ төлөвт «дахин суулгах».
 */
import { planOwnProgress, type OwnProgressPlan, type RootAllocState } from './allocation';
import { ROOT_TOTAL_UNITS, finishRemaining, parseUnits, remainingUnits, stepDown, stepUp, type StepMode } from './units';

/** Хүний хуваарилалтын серверээс мэдэгдэж буй төлөв (CAS-ийн суурь). */
export interface OwnBase {
  taskId: number;
  /** Нэвтэрсэн хэрэглэгч (хариунаас өөрийн мөрийг олоход). */
  userId: number;
  /** Root-ийн revision — бичилт бүр `expected_revision`-ээр явна. */
  revision: number;
  /** Үндсэн ажлын нийт хийгдсэн (Σ D + B), нэгжээр. */
  rootDone: number;
  /** D — миний хүчинтэй хийсэн. */
  done: number;
  /** L — түгжигдсэн доод хязгаар. */
  floor: number;
  /** T — миний нийт зорилт. */
  target: number;
}

export type DraftPhase = 'clean' | 'dirty' | 'saving' | 'error';

export interface DraftError {
  code: string;
  message: string;
  /** Ижил хүсэлтийг дахин илгээж болно (сүлжээний алдаа). */
  retryable: boolean;
}

export interface QaNeed {
  scopes: { own: boolean; root: boolean };
  /** Серверээс ирсэн асуултууд (400 `completion_qa required`); null = дуудагчийн мэддэг төслийн асуултууд. */
  questions: Array<{ id: string; text: string }> | null;
}

export interface Draft {
  base: OwnBase;
  /** Хэрэглэгчийн сонгосон ноорог D (нэгжээр). */
  desired: number;
  phase: DraftPhase;
  /** Одоогийн ноорогийн хүсэлтийн id — ижил ноорогт сүлжээний давталт ижил id хэрэглэнэ. */
  requestId: string | null;
  /** Дуусгах асуултын хариулт (ноорог зорилтод/100%-д хүрэх үед). */
  qa: Record<string, string> | null;
  /** Дуусгах асуултын цонх хүлээж буй (хариулт ирээгүй). */
  qaNeed: QaNeed | null;
  /** QA-д хүргэсэн өөрчлөлтийн ӨМНӨХ ноорог — цонхыг «болих» нь тийшээ буцаана (бүх ноорогийг биш). */
  beforeQa: number | null;
  error: DraftError | null;
  /** Сүүлийн амжилттай хадгалалт (харуулах «Хадгалагдлаа», дуусгасан мэдэгдэл) — шинэ ноорог эхлэхэд арилна. */
  lastSaved: SavedInfo | null;
}

export interface SavedInfo {
  /** Давтагдахгүй дугаар — UI мэдэгдлийг нэг л удаа гаргахад. */
  seq: number;
  at: number;
  kind: 'increase' | 'decrease' | 'none';
  reachedOwnCap: boolean;
  completedRoot: boolean;
  reopenedRoot: boolean;
  /** Олгосон (+) эсвэл буцаасан (−) оноо; байхгүй бол null. */
  amount: number | null;
}

export function newDraft(base: OwnBase): Draft {
  return {
    base,
    desired: base.done,
    phase: 'clean',
    requestId: null,
    qa: null,
    qaNeed: null,
    beforeQa: null,
    error: null,
    lastSaved: null,
  };
}

/** Бичилтийн хариу / 409 `current` дахь root-оос миний суурь (миний хуваарилалт байхгүй бол null). */
export function baseFromRoot(
  root: {
    task_id: number;
    revision: number;
    root_done_units: number;
    participants: Array<{ user_id: number; target_units: number; done_units: number; floor_units: number }>;
  },
  userId: number,
): OwnBase | null {
  const me = root.participants.find((p) => p.user_id === userId);
  if (!me) return null;
  return {
    taskId: root.task_id,
    userId,
    revision: root.revision,
    rootDone: root.root_done_units,
    done: me.done_units,
    floor: me.floor_units,
    target: me.target_units,
  };
}

/* ------------------------------------------------------------------ */
/*  Таамаг                                                              */
/* ------------------------------------------------------------------ */

/** `planOwnProgress`-ийн оролт: миний мөр + бусдын нийлбэр (зөвхөн root нийлбэр л хэрэгтэй). */
function stateOf(base: OwnBase): RootAllocState {
  const others = Math.max(0, base.rootDone - base.done);
  return {
    unattributedUnits: 0,
    unallocatedUnits: 0,
    rows: [
      { userId: 1, doneUnits: base.done, floorUnits: base.floor, targetUnits: base.target },
      { userId: 2, doneUnits: others, floorUnits: others, targetUnits: others },
    ],
  };
}

/** Серверийн дүрмээр (`planOwnProgress`) тухайн ноорог юу болохыг урьдчилна. */
export function forecast(base: OwnBase, next: number): OwnProgressPlan {
  return planOwnProgress(stateOf(base), 1, next);
}

/** Ноорог QA (дуусгах асуулт) шаардах уу — өөрийн хэсэг зорилтод хүрнэ ЭСВЭЛ үндсэн ажил 100% болно. */
export function needsCompletionQa(base: OwnBase, next: number): QaNeed | null {
  const f = forecast(base, next);
  if (!f.ok) return null;
  if (!f.reachesOwnCap && !f.completesRoot) return null;
  return { scopes: { own: f.reachesOwnCap, root: f.completesRoot }, questions: null };
}

/* ------------------------------------------------------------------ */
/*  Ноорог өөрчлөх                                                       */
/* ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Ноорогийг `next` болгоно (хүрээнд хавчуулна).  Анхны (серверийн) утга руу буцвал `clean`.  Ноорог ӨӨРЧЛӨГДВӨЛ
 * хүсэлтийн id, QA хариулт, алдаа цэвэрлэгдэнэ — өөр ачаалал (payload) өөр id авна.
 */
export function setDesired(d: Draft, next: number): Draft {
  // Хадгалалт явж байхад ноорог өөрчлөгдөхгүй (UI товчийг түгжинэ) — явж буй хүсэлтийн утга алдагдахгүй.
  if (d.phase === 'saving') return d;
  const v = clamp(Math.round(next), d.base.floor, d.base.target);
  if (v === d.desired && d.phase !== 'error') return d;
  if (v === d.base.done) return revert(d);
  const need = needsCompletionQa(d.base, v);
  return {
    ...d,
    desired: v,
    phase: 'dirty',
    requestId: null,
    // Өмнөх хариулт ӨӨР ноорогт өгөгдсөн байж болно — ижил утга хэвээр байвал л хадгална.
    qa: need && d.qa && d.desired === v ? d.qa : null,
    qaNeed: need,
    beforeQa: need ? (d.qaNeed ? d.beforeQa : d.desired) : null,
    error: null,
    lastSaved: null,
  };
}

export type StepKind = 'up' | 'down' | 'finish';

/** `−` / `+` / «Үлдсэн ажлаа дуусгах» — алхам нь НИЙТ зорилтын `mode`% (`units.stepUnits`). */
export function applyStep(d: Draft, kind: StepKind, mode: StepMode): Draft {
  const { base } = d;
  if (kind === 'finish') return setDesired(d, finishRemaining(d.desired, base.target).next);
  if (kind === 'up') return setDesired(d, stepUp(d.desired, base.target, mode).next);
  return setDesired(d, stepDown(d.desired, base.floor, base.target, mode).next);
}

/** Тоо бичих — ХАТУУ задлалт (`parseUnits`); хүрээнээс гарсан/буруу бол ноорог ӨӨРЧЛӨГДӨХГҮЙ, алдаа буцна. */
export type TypedResult =
  | { ok: true; draft: Draft }
  | { ok: false; code: 'EMPTY' | 'FORMAT' | 'PRECISION' | 'NEGATIVE' | 'RANGE' | 'BELOW_FLOOR' };

export function applyTyped(d: Draft, text: string): TypedResult {
  const parsed = parseUnits(text, d.base.target);
  if (!parsed.ok) return { ok: false, code: parsed.code };
  if (parsed.units < d.base.floor) return { ok: false, code: 'BELOW_FLOOR' };
  return { ok: true, draft: setDesired(d, parsed.units) };
}

/** «Өөрчлөлт буцаах» — ноорог серверийн утга руу. */
export function revert(d: Draft): Draft {
  if (d.phase === 'saving') return d;
  return {
    ...d,
    desired: d.base.done,
    phase: 'clean',
    requestId: null,
    qa: null,
    qaNeed: null,
    beforeQa: null,
    error: null,
  };
}

/** Дуусгах асуултын цонхыг «болих» — QA-д хүргэсэн өөрчлөлтийг л буцаана (өмнөх ноорог хэвээр). */
export function cancelQa(d: Draft): Draft {
  if (d.phase === 'saving' || !d.qaNeed) return d;
  const back = d.beforeQa ?? d.base.done;
  return setDesired({ ...d, qaNeed: null, qa: null, beforeQa: null }, back);
}

/** Дуусгах асуултын хариулт ирсэн — ноорог хэвээр, QA хавсарна. */
export function attachQa(d: Draft, qa: Record<string, string>): Draft {
  return { ...d, qa, qaNeed: null, beforeQa: null };
}

/**
 * Серверийн шинэ төлөвт «дахин суулгах» (бичилтийн хариу, 409 `current`, дахин уншсан жагсаалт).
 *  • Ноорог аль хэдийн серверийн утгатай тэнцүү → clean.
 *  • Үгүй бол ноорог хэвээр, ГЭХДЭЭ шинэ `[floor, target]`-д хавчигдана (хуваалт өөрчлөгдсөн байж болно).
 *  • Хуучин revision (түрүүлж ирсэн хариу)-аар ХЭЗЭЭ Ч дахин суухгүй.
 */
export function rebase(d: Draft, next: OwnBase): Draft {
  if (d.phase === 'saving') return d;
  if (next.revision < d.base.revision) return d;
  // Саяхны «Хадгалагдлаа» тэмдэглэгээг серверийн төлөв шинэчлэгдсэн ч хадгална (UI өөрөө түр харуулна).
  if (d.phase === 'clean') return { ...newDraft(next), lastSaved: d.lastSaved };
  const v = clamp(d.desired, next.floor, next.target);
  if (v === next.done) return newDraft(next);
  if (v !== d.desired) {
    // Хуваалт өөрчлөгдсөнөөс болж ноорог хүрээнээс гарсан — өөр ноорог болсон тул id, QA шинэчлэгдэнэ.
    return setDesired({ ...d, base: next, desired: next.done, phase: 'clean', qa: null, qaNeed: null, beforeQa: null }, v);
  }
  // Ноорог хэвээр; үндсэн ажлын нийт өөрчлөгдсөн (өөр хүн ажилласан) тул QA хэрэгцээг дахин тооцоолно.
  const need = needsCompletionQa(next, v);
  return {
    ...d,
    base: next,
    requestId: next.revision === d.base.revision ? d.requestId : null,
    qaNeed: need && !d.qa ? (d.qaNeed ?? need) : null,
    qa: need ? d.qa : null,
    beforeQa: need && !d.qa ? d.beforeQa : null,
  };
}

/* ------------------------------------------------------------------ */
/*  Харагдац                                                            */
/* ------------------------------------------------------------------ */

export interface OwnView {
  done: number;
  target: number;
  /** T − ноорог — «Үлдсэн ажлаа дуусгах» товчны шошго. */
  remaining: number;
  atCap: boolean;
  atFloor: boolean;
  dirty: boolean;
  /** Хувь (0–100) — өөрийн явцын bar. */
  ratioPct: number;
}

export function viewOf(d: Draft): OwnView {
  const { base } = d;
  return {
    done: d.desired,
    target: base.target,
    remaining: remainingUnits(d.desired, base.target),
    atCap: d.desired >= base.target,
    atFloor: d.desired <= base.floor,
    dirty: d.phase === 'dirty' || d.phase === 'saving' || d.phase === 'error',
    ratioPct: base.target > 0 ? Math.min(100, (d.desired / base.target) * 100) : 0,
  };
}

export { ROOT_TOTAL_UNITS };
