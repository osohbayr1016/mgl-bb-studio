/**
 * ТАСКИЙН ХУВААРИЛАЛТ — МЕНЕЖЕРИЙН API (backend: `routes/taskAllocAdmin.ts`, `/api/tasks/alloc-admin/*`).
 *
 * Бүх бичих үйлдэл `request_id` авна (хөрвүүлэлт/буцаалт идемпотент) — дахин оролдох аюулгүй.  Энэ нь админ гаргуун тул
 * `apiFetch`-ийн POST-ыг давтахгүй дүрмийг тойрохгүй: сүлжээний алдаанд хэрэглэгч ӨӨРӨӨ «Дахин оролдох» дарж ижил request_id-г
 * (state-д хадгалсан) дахин илгээнэ.
 */
import { apiFetch } from '@/shared/api/client';

export type AllocState = 'enabled' | 'paused' | 'disabled';

export interface StateLogRow {
  id: number;
  from_state: string | null;
  to_state: string;
  actor_id: number | null;
  reason: string | null;
  contract: number;
  at: string;
}

export interface StateOverview {
  state: AllocState;
  configured: boolean;
  updated_at: string | null;
  updated_by: number | null;
  contract: number;
  min_contract: number;
  counts: {
    roots: number;
    active_roots: number;
    complete_roots: number;
    participants: number;
    pending_post_commit: number;
    /** 0402 — хуучин worker-т байхгүй. */
    pending_reconcile?: number;
    failed_reconcile?: number;
  };
  history: StateLogRow[];
}

export interface RootRow {
  task_id: number;
  task_name: string;
  project_id: number;
  project_name: string;
  project_status: string | null;
  revision: number;
  unattributed_units: number;
  unallocated_units: number;
  completed_at: string | null;
  seed_attribution: string | null;
  participants: number;
  active_participants: number;
  sum_done_units: number;
  sum_target_units: number;
  updated_at: string;
}

export interface AuditFinding {
  severity: 'error' | 'warn';
  code: string;
  task_id: number | null;
  user_id?: number | null;
  message: string;
  detail?: Record<string, unknown>;
}

export interface AuditReport {
  ok: boolean;
  generated_at: string;
  scope: { task_id: number | null; project_id: number | null; deep: boolean; limit: number };
  roots_checked: number;
  errors: number;
  warnings: number;
  counts: Record<string, number>;
  findings: AuditFinding[];
  truncated: boolean;
}

export type GroupClass = 'proven_split' | 'ambiguous' | 'organizational' | 'already_managed';
export type Evidence = 'declared_group' | 'name_pattern' | 'manual';

export interface Classification {
  classification: GroupClass;
  convertible: boolean;
  blockers: string[];
  warnings: string[];
}

export interface GroupMember {
  task_id: number;
  name: string;
  weight: number;
  latest_pct: number;
  drawing_id: number;
  managed: boolean;
  retired: boolean;
}

export interface CandidateGroup {
  key: string;
  evidence: Evidence;
  task_ids: number[];
  project_id: number | null;
  classification: Classification;
  members: GroupMember[];
  suggested_root_task_id: number;
}

export interface Candidates {
  groups: CandidateGroup[];
  counts: Record<string, number>;
  truncated: boolean;
  declared_groups_supported: boolean;
}

export interface PlannedMember {
  taskId: number;
  name: string;
  role: 'root' | 'retired';
  weightBefore: number;
  weightAfter: number;
  latestPct: number;
  targetUnits: number;
  doneUnits: number;
  attribution: 'empty' | 'clean' | 'uncertain';
  reasons: string[];
  slackUnits: number;
  unattributedUnits: number;
  futureOwner: number | null;
}

export interface ConversionPlan {
  rootTaskId: number;
  rootNameBefore: string;
  rootNameAfter: string;
  weight: number;
  members: PlannedMember[];
  allocations: Array<{ userId: number; ordinal: number; doneUnits: number; floorUnits: number; targetUnits: number }>;
  unattributedUnits: number;
  unallocatedUnits: number;
  slackUnits: number;
  rootDoneUnits: number;
  seedAttribution: 'empty' | 'clean' | 'uncertain';
  slices: unknown[];
  backfill: Array<{ date: string; units: number }>;
  rollup: { before: number; after: number; delta: number; toleranceUnits: number };
  warnings: string[];
}

export interface ConversionPreview {
  evidence: Evidence;
  classification: Classification;
  root_task_id: number;
  members: GroupMember[];
  plan: ConversionPlan | null;
  plan_failure: { code: string; message: string } | null;
  plan_hash: string | null;
  needs_confirmation: boolean;
}

export interface ConversionRow {
  id: string;
  root_task_id: number;
  project_id: number;
  status: 'applied' | 'reverted';
  evidence: string;
  classification: string;
  reason: string | null;
  actor_id: number | null;
  rollup_before: number;
  rollup_after: number;
  created_at: string;
  reverted_at: string | null;
}

export interface ReweightPreview {
  tasks: number;
  drifting: number;
  amount_delta: number;
  /** Төслийн хүрээнд эхний 200 таскийг л харуулсан (apply хаалттай — таскаар нэг нэгээр). */
  truncated?: boolean;
  previews: Array<{ task_id: number; project_id: number; coef: number; complexity_pct: number; items: number; totals: { amountDelta: number; deltaPctDelta: number; slices: number; users: number } }>;
}

const base = '/tasks/alloc-admin';

export const adminKeys = {
  all: ['/tasks/alloc-admin'] as const,
  state: ['/tasks/alloc-admin', 'state'] as const,
  roots: (offset: number, onlyOpen: boolean) => ['/tasks/alloc-admin', 'roots', offset, onlyOpen] as const,
  candidates: ['/tasks/alloc-admin', 'candidates'] as const,
  history: ['/tasks/alloc-admin', 'conversion-history'] as const,
};

export const fetchState = () => apiFetch<StateOverview>(`${base}/state`);
export const putState = (body: { state: AllocState; reason: string; expected_state: AllocState }) =>
  apiFetch<StateOverview & { changed: boolean }>(`${base}/state`, { method: 'PUT', data: body });
export const fetchRoots = (offset: number, onlyOpen: boolean) =>
  apiFetch<{ total: number; rows: RootRow[] }>(`${base}/roots?limit=25&offset=${offset}${onlyOpen ? '&only_open=1' : ''}`);

export const fetchAudit = (p: { deep: boolean; projectId: number | null }) =>
  apiFetch<AuditReport>(`${base}/audit?limit=300${p.deep ? '&deep=1' : ''}${p.projectId ? `&project_id=${p.projectId}` : ''}`, { timeoutMs: 60_000 });

export const fetchCandidates = () => apiFetch<Candidates>(`${base}/conversion/candidates?limit=100`, { timeoutMs: 60_000 });
export const previewConversion = (body: { task_ids: number[]; root_task_id?: number; root_name?: string; future_owners?: Record<number, number> }) =>
  apiFetch<ConversionPreview>(`${base}/conversion/preview`, { data: body, timeoutMs: 60_000 });
export const applyConversion = (body: {
  task_ids: number[];
  root_task_id: number;
  root_name?: string;
  future_owners?: Record<number, number>;
  request_id: string;
  plan_hash: string;
  reason: string;
  confirm_ambiguous: boolean;
}) => apiFetch<{ conversion_id: string; root_task_id: number; replayed: boolean; warnings: string[] }>(`${base}/conversion/apply`, { data: body, timeoutMs: 60_000 });
export const revertConversion = (id: string, body: { request_id: string; reason: string }) =>
  apiFetch<{ conversion_id: string; replayed: boolean }>(`${base}/conversion/${encodeURIComponent(id)}/revert`, { data: body, timeoutMs: 60_000 });
export const fetchConversionHistory = () => apiFetch<{ conversions: ConversionRow[] }>(`${base}/conversion/history`);

export const fetchReweightPreview = (scope: { taskId?: number; projectId?: number }) =>
  apiFetch<ReweightPreview>(`${base}/credit/reweight?${scope.taskId ? `task_id=${scope.taskId}` : `project_id=${scope.projectId}`}`, { timeoutMs: 60_000 });
export const applyReweight = (scope: { taskId?: number; projectId?: number }) =>
  apiFetch<{ scope: string; result: unknown }>(`${base}/credit/reweight`, {
    data: scope.taskId ? { task_id: scope.taskId } : { project_id: scope.projectId },
    timeoutMs: 60_000,
  });

/** Серверийн алдааны код/тайлбар → хэрэглэгчид харуулах мөр. */
export function adminErrorText(err: unknown, fallback: string): string {
  const e = err as { payload?: { message?: unknown; error?: unknown }; message?: unknown };
  const msg = e?.payload?.message;
  if (typeof msg === 'string' && msg !== '') return msg;
  const code = e?.payload?.error;
  if (typeof code === 'string' && code !== '') return code;
  return typeof e?.message === 'string' && e.message !== '' ? e.message : fallback;
}
