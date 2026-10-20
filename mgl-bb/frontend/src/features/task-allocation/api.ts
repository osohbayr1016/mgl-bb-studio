/**
 * ТАСКИЙН ХУВААРИЛАЛТ — HTTP клиент (backend: `routes/taskAllocations.ts`).
 *
 * Бичих бүр `request_id` (идемпотент) + `expected_revision` (CAS) авна.  Ижил `request_id`-тай дахин илгээх НЬ
 * АЮУЛГҮЙ (сервер анхны үр дүнг буцаана) тул сүлжээний алдаанд `attempts` тавьж автоматаар давтана — энэ нь
 * `apiFetch`-ийн «POST давтахгүй» дүрмийн цорын ганц зориудын үл хамаарах тохиолдол.
 */
import { ApiError, ApiNetworkError, apiFetch } from '@/shared/api/client';

import type {
  AllocationErrorExtra,
  AllocationOverview,
  CandidateUser,
  CorrectResult,
  OwnRecords,
  ProgressResult,
  ProjectContributors,
  ReleaseResult,
  RestoreResult,
  RetakeResult,
  RootSplitInfo,
  RootSplitResult,
  RootSplitUndoResult,
  SplitResult,
} from './types';

/* ------------------------------------------------------------------ */
/*  Түлхүүр                                                              */
/* ------------------------------------------------------------------ */

export const allocationKey = (taskId: number) => ['/tasks/allocation', taskId] as const;
export const ownRecordsKey = (taskId: number) => ['/tasks/allocation', 'records', taskId] as const;
export const contributorsKey = (projectId: number) => ['/tasks/contributors', projectId] as const;
/** Бүх төслийн хувь нэмэрчийг цэвэрлэх угтвар. */
export const CONTRIBUTORS_PREFIX = ['/tasks/contributors'] as const;
export const ALLOCATION_PREFIX = ['/tasks/allocation'] as const;
export const CANDIDATES_KEY = ['/tasks/allocation-candidates'] as const;

/* ------------------------------------------------------------------ */
/*  request_id                                                           */
/* ------------------------------------------------------------------ */

/** 8–80 тэмдэгт, `[A-Za-z0-9._:-]` (сервер `validRequestId`).  UUID = 36 тэмдэгт. */
export function newRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Нийтийн бус контекст (http) — санамсаргүй хэлбэр хангалттай: дахин ашиглагдахгүй байх л чухал.
  const rnd = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rnd()}-${rnd()}-${rnd()}`;
}

/* ------------------------------------------------------------------ */
/*  Алдаа                                                                */
/* ------------------------------------------------------------------ */

export interface AllocationFailure {
  /** HTTP төлөв; сүлжээний алдаанд 0. */
  status: number;
  /** Серверийн код (`STALE_REVISION`, `BELOW_FLOOR`, `completion_qa required` …) — сүлжээний алдаанд `NETWORK`. */
  code: string;
  /** Серверийн хүнд уншигдах тайлбар (байхгүй бол хоосон). */
  message: string;
  extra: AllocationErrorExtra;
  /** Сүлжээний алдаа/timeout — ижил `request_id`-тай ДАХИН оролдож болно. */
  network: boolean;
}

export function toFailure(err: unknown): AllocationFailure {
  if (err instanceof ApiError) {
    const p = err.payload as AllocationErrorExtra & { error?: unknown; message?: unknown };
    return {
      status: err.status,
      code: typeof p.error === 'string' ? p.error : err.message,
      message: typeof p.message === 'string' ? p.message : '',
      extra: {
        ...(p.current !== undefined ? { current: p.current } : {}),
        ...(p.questions !== undefined ? { questions: p.questions } : {}),
        ...(p.missing !== undefined ? { missing: p.missing } : {}),
        ...(p.scopes !== undefined ? { scopes: p.scopes } : {}),
        ...(p.available_units !== undefined ? { available_units: p.available_units } : {}),
      },
      network: false,
    };
  }
  if (err instanceof ApiNetworkError) {
    return { status: 0, code: 'NETWORK', message: err.message, extra: {}, network: true };
  }
  return {
    status: 0,
    code: 'UNKNOWN',
    message: err instanceof Error ? err.message : '',
    extra: {},
    network: false,
  };
}

/* ------------------------------------------------------------------ */
/*  Унших                                                                */
/* ------------------------------------------------------------------ */

export const fetchAllocation = (taskId: number) => apiFetch<AllocationOverview>(`/tasks/${taskId}/allocation`);

export const fetchOwnRecords = (taskId: number) => apiFetch<OwnRecords>(`/tasks/${taskId}/allocation/records`);

export const fetchCandidates = () =>
  apiFetch<{ users: CandidateUser[] }>('/tasks/allocation-candidates').then((r) => r.users ?? []);

export const fetchContributors = (projectId: number) =>
  apiFetch<ProjectContributors>(`/tasks/contributors?project_id=${projectId}`);

/* ------------------------------------------------------------------ */
/*  Бичих                                                                */
/* ------------------------------------------------------------------ */

const WRITE_ATTEMPTS = 3;

export interface WriteMeta {
  requestId: string;
  /** Одоо мэдэгдэж буй root revision (managed болоогүй таскт null). */
  expectedRevision: number | null;
}

export interface SplitTarget {
  user_id: number;
  target_units: number;
}

export const postSplit = (
  taskId: number,
  meta: WriteMeta,
  body: { mode: 'total' | 'remainder'; targets: SplitTarget[] },
) =>
  apiFetch<SplitResult>(`/tasks/${taskId}/allocation/split`, {
    method: 'POST',
    attempts: WRITE_ATTEMPTS,
    data: { request_id: meta.requestId, expected_revision: meta.expectedRevision, ...body },
  });

export interface ProgressBody {
  done_units: number;
  notes?: string | null;
  attachments?: unknown[];
  completion_qa?: Record<string, string> | null;
}

export const postProgress = (taskId: number, meta: WriteMeta & { expectedRevision: number }, body: ProgressBody) =>
  apiFetch<ProgressResult>(`/tasks/${taskId}/allocation/progress`, {
    method: 'POST',
    attempts: WRITE_ATTEMPTS,
    data: {
      request_id: meta.requestId,
      expected_revision: meta.expectedRevision,
      done_units: body.done_units,
      ...(body.notes ? { notes: body.notes } : {}),
      ...(body.attachments && body.attachments.length > 0 ? { attachments: body.attachments } : {}),
      ...(body.completion_qa ? { completion_qa: body.completion_qa } : {}),
    },
  });

export const postRelease = (taskId: number, meta: WriteMeta & { expectedRevision: number }, toUserId: number | null) =>
  apiFetch<ReleaseResult>(`/tasks/${taskId}/allocation/release`, {
    method: 'POST',
    attempts: WRITE_ATTEMPTS,
    data: {
      request_id: meta.requestId,
      expected_revision: meta.expectedRevision,
      ...(toUserId !== null ? { to_user_id: toUserId } : {}),
    },
  });

export interface UnsplitResult {
  ok: true;
  task_id: number;
  replayed: boolean;
  removed_allocations: number;
  removed_points: number;
  removed_entries: number;
  timers_stopped: number;
  progress_before: number;
  progress_after: number;
}

/** Хуваалтыг бүхэлд нь цуцалж таскийг «огт хуваагаагүй» анхны байдалд буцаана (2026-10-06, сервер `lib/taskUnsplit.ts`). */
export const postUnsplit = (taskId: number, requestId: string) =>
  apiFetch<UnsplitResult>(`/tasks/${taskId}/allocation/unsplit`, {
    method: 'POST',
    attempts: WRITE_ATTEMPTS,
    data: { request_id: requestId },
  });

export const postRetake = (taskId: number, meta: WriteMeta & { expectedRevision: number }, units: number | null) =>
  apiFetch<RetakeResult>(`/tasks/${taskId}/allocation/retake`, {
    method: 'POST',
    attempts: WRITE_ATTEMPTS,
    data: {
      request_id: meta.requestId,
      expected_revision: meta.expectedRevision,
      ...(units !== null ? { units } : {}),
    },
  });

export const postCorrect = (
  taskId: number,
  meta: WriteMeta & { expectedRevision: number },
  items: Array<{ slice_id: number; units?: number }>,
) =>
  apiFetch<CorrectResult>(`/tasks/${taskId}/allocation/correct`, {
    method: 'POST',
    attempts: WRITE_ATTEMPTS,
    data: { request_id: meta.requestId, expected_revision: meta.expectedRevision, items },
  });

export const postRestore = (
  taskId: number,
  meta: WriteMeta & { expectedRevision: number },
  body: { correction_request_id: string; completion_qa?: Record<string, string> | null },
) =>
  apiFetch<RestoreResult>(`/tasks/${taskId}/allocation/restore`, {
    method: 'POST',
    attempts: WRITE_ATTEMPTS,
    data: {
      request_id: meta.requestId,
      expected_revision: meta.expectedRevision,
      correction_request_id: body.correction_request_id,
      ...(body.completion_qa ? { completion_qa: body.completion_qa } : {}),
    },
  });

/* ------------------------------------------------------------------ */
/*  Хүнгүй хэсэг (0394, 2026-10-09)                                     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Үндсэн таскууд болгон хуваах (✂, 0395, 2026-10-09)                    */
/* ------------------------------------------------------------------ */

export const rootSplitKey = (taskId: number) => ['/tasks/root-split', taskId] as const;

export const fetchRootSplit = (taskId: number) => apiFetch<RootSplitInfo>(`/tasks/${taskId}/root-split`);

/** Таскийг нэр + хувиар (хуваагдах ажлын %, нийлбэр 1 000 000) ЖИНХЭНЭ шинэ таскууд болгоно. */
export const postRootSplit = (taskId: number, requestId: string, parts: Array<{ name: string; share_units: number }>) =>
  apiFetch<RootSplitResult>(`/tasks/${taskId}/root-split`, {
    method: 'POST',
    attempts: WRITE_ATTEMPTS,
    data: { request_id: requestId, parts },
  });

/** Хуваалтыг буцаана — шинэ таскууд устаж, эх таск анхны нэр/жин/явцдаа. */
export const postRootSplitUndo = (splitId: number, requestId: string) =>
  apiFetch<RootSplitUndoResult>(`/tasks/root-splits/${splitId}/undo`, {
    method: 'POST',
    attempts: WRITE_ATTEMPTS,
    data: { request_id: requestId },
  });

/** Хуваарилалтын мөрийн (дэд таскийн) нэр — хоосон бол үндсэн ажлын нэр рүү буцна (0393). */
export const putAllocationLabel = (taskId: number, userId: number, label: string | null) =>
  apiFetch<{ ok: true; label: string | null }>(`/tasks/${taskId}/allocation-label`, {
    method: 'PUT',
    data: { user_id: userId, label },
  });

/** Хэсгийн нэрийг засна (зөвхөн харагдац, revision хөдлөхгүй). */
export const putPartLabel = (taskId: number, partId: number, label: string) =>
  apiFetch<{ ok: true; label: string }>(`/tasks/${taskId}/part-label`, {
    method: 'PUT',
    data: { part_id: partId, label },
  });
