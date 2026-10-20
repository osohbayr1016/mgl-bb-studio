import { useInfiniteQuery, useQueryClient, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import { useApiQuery, useApiMutation } from '@/shared/api/useApi';
import { apiFetch, apiFetchBlob, type ApiError } from '@/shared/api/client';
import { resolveApiHost } from '@/shared/api/apiHost';
import type {
  ContractKind,
  EmployeeDetailResponse,
  EmployeeHr,
  EmployeeHrPatch,
  EmployeeHrResponse,
  MgmtMemberResponse,
  MgmtTeamResponse,
  NonProjectReviewFilter,
  NonProjectReviewItem,
  NonProjectReviewResponse,
  OverviewResponse,
  RepairProjectDetailResponse,
  RepairProjectEntriesPage,
  RepairProjectsResponse,
  ReportWindow,
  SnapshotStatus,
  SnapshotsResponse,
  TeamDetailResponse,
  TeamsResponse,
} from './types';

/** Түлхүүрийн конвенц: `['/endpoint', ...params]` — хажуугийн виджетүүд кэш хуваалцана. */

function q(window: ReportWindow, anchor: string): string {
  return `window=${window}&anchor=${anchor}`;
}

export function useReportsOverview(window: ReportWindow, anchor: string) {
  return useApiQuery<OverviewResponse>(
    ['/reports/overview', window, anchor],
    `/reports/overview?${q(window, anchor)}`,
    { placeholderData: (prev) => prev, staleTime: 60_000 },
  );
}

export function useEmployeeReport(userId: number | null, window: ReportWindow, anchor: string) {
  return useApiQuery<EmployeeDetailResponse>(
    ['/reports/employees', userId, window, anchor],
    `/reports/employees/${userId}?${q(window, anchor)}`,
    { enabled: userId != null, placeholderData: (prev) => prev, staleTime: 60_000 },
  );
}

export function useEmployeeHr(userId: number | null) {
  return useApiQuery<EmployeeHrResponse>(
    ['/reports/employees', userId, 'hr'],
    `/reports/employees/${userId}/hr`,
    { enabled: userId != null },
  );
}

export function useEmployeeSnapshots(userId: number | null, from: string, to: string) {
  return useApiQuery<SnapshotsResponse>(
    ['/reports/employees', userId, 'snapshots', from, to],
    `/reports/employees/${userId}/snapshots?from=${from}&to=${to}`,
    { enabled: userId != null, placeholderData: (prev) => prev },
  );
}

export function useTeamReports(window: ReportWindow, anchor: string) {
  return useApiQuery<TeamsResponse>(['/reports/teams', window, anchor], `/reports/teams?${q(window, anchor)}`, {
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });
}

export function useTeamReport(teamId: number | null, window: ReportWindow, anchor: string) {
  return useApiQuery<TeamDetailResponse>(
    ['/reports/teams', teamId, window, anchor],
    `/reports/teams/${teamId}?${q(window, anchor)}`,
    { enabled: teamId != null, placeholderData: (prev) => prev, staleTime: 60_000 },
  );
}

export function useSnapshotStatus() {
  return useApiQuery<SnapshotStatus>(['/reports/snapshots/status'], '/reports/snapshots/status');
}

export function useSaveHr(userId: number) {
  const qc = useQueryClient();
  return useApiMutation<{ hr: EmployeeHr }, EmployeeHrPatch>(`/reports/employees/${userId}/hr`, { method: 'PUT' }, {
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/reports/employees', userId, 'hr'] }),
  });
}

/** `kind` = employment (Хөдөлмөрийн гэрээ) | nda (Нууцлалын гэрээ) — хоёр тусдаа файл. */
export function useDeleteContractFile(userId: number, kind: ContractKind) {
  const qc = useQueryClient();
  return useApiMutation<{ hr: EmployeeHr }, void>(`/reports/employees/${userId}/contract-file/${kind}`, { method: 'DELETE' }, {
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/reports/employees', userId, 'hr'] }),
  });
}

/** multipart — `apiFetch` JSON л явуулдаг тул энд шууд fetch. */
export async function uploadContractFile(userId: number, kind: ContractKind, file: File): Promise<{ hr: EmployeeHr }> {
  const token = localStorage.getItem('auth_token');
  const fd = new FormData();
  fd.append('file', file, file.name);
  const res = await fetch(`${resolveApiHost()}/api/reports/employees/${userId}/contract-file/${kind}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    body: fd,
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; hr?: EmployeeHr };
  if (!res.ok || !body.hr) throw new Error(body.error ?? `Upload failed (${res.status})`);
  return { hr: body.hr };
}

/** COEP-ийн улмаас PDF-ийг HTTP-ээр iframe-д өгч болохгүй — blob URL (AttachmentPreviews.tsx-ийн дүрэм). */
export async function fetchContractBlobUrl(userId: number, kind: ContractKind): Promise<string> {
  const blob = await apiFetchBlob(`/reports/employees/${userId}/contract-file/${kind}`);
  return URL.createObjectURL(blob);
}

/**
 * Хөтөч дээр угссан .xlsx-ийг Google Sheets болгоно — сервер Drive руу
 * хөрвүүлж, домэйнд хуваалцаад холбоос буцаана.  multipart тул шууд fetch.
 */
export async function createGoogleSheet(
  userId: number,
  bytes: ArrayBuffer,
  name: string,
): Promise<{ id: string; name: string; url: string; shared: 'domain' | 'link' | null }> {
  const token = localStorage.getItem('auth_token');
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: XLSX_MIME }), `${name}.xlsx`);
  fd.append('name', name);
  const res = await fetch(`${resolveApiHost()}/api/reports/employees/${userId}/export/google-sheet`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    body: fd,
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    id?: string;
    name?: string;
    url?: string;
    shared?: 'domain' | 'link' | null;
  };
  if (!res.ok || !body.id || !body.url) throw new Error(body.error ?? `Export failed (${res.status})`);
  return { id: body.id, name: body.name ?? name, url: body.url, shared: body.shared ?? null };
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function runBackfill(from: string, to: string): Promise<{ from: string; to: string; days: number; users_per_day: number }> {
  return apiFetch(`/reports/snapshots/backfill`, { method: 'POST', data: { from, to } });
}

export async function runSnapshotNow(): Promise<{ date: string; users: number; members: number }> {
  return apiFetch(`/reports/snapshots/run`, { method: 'POST', data: {} });
}

/* ---- Засварын төслийн тайлан ---- */

export const REPAIR_PROJECTS_KEY = ['/reports/repair-projects'] as const;

export function useRepairProjectReports() {
  return useApiQuery<RepairProjectsResponse>(REPAIR_PROJECTS_KEY, '/reports/repair-projects', {
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

/** `key` = `p:<id>` | `r:<id>` (RepairProjectReportRow.key). */
export function useRepairProjectReport(key: string | null) {
  return useApiQuery<RepairProjectDetailResponse>(
    ['/reports/repair-projects', key],
    `/reports/repair-projects/${key}`,
    { enabled: key != null, placeholderData: (prev) => prev, staleTime: 30_000 },
  );
}

/**
 * Бүртгэлийн жагсаалт — `id` буурах cursor.  «Өмнөхийг татах» нь дараагийн
 * хуудсыг доор нь залгана (`fetchNextPage`); хүн сонговол зөвхөн түүнийх.
 */
export function useRepairProjectEntries(key: string | null, userId: number | null) {
  return useInfiniteQuery<RepairProjectEntriesPage, ApiError, InfiniteData<RepairProjectEntriesPage>, QueryKey, number | null>({
    queryKey: ['/reports/repair-projects', key, 'entries', userId],
    initialPageParam: null,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (pageParam != null) qs.set('before', String(pageParam));
      if (userId != null) qs.set('user_id', String(userId));
      const s = qs.toString();
      return apiFetch<RepairProjectEntriesPage>(`/reports/repair-projects/${key}/entries${s ? `?${s}` : ''}`);
    },
    getNextPageParam: (last) => last.next_before,
    enabled: key != null,
    staleTime: 30_000,
  });
}

/** Засварын төслийн CRUD нь `routes/repair.ts`-ийн одоо байгаа замууд — энд ДАВХАРДУУЛАХГҮЙ. */
export async function createRepairProject(name: string): Promise<{ project: { id: number } }> {
  return apiFetch('/repair/projects', { method: 'POST', data: { name } });
}

export async function patchRepairProject(
  rid: number,
  body: { name?: string; description?: string | null; status?: 'active' | 'archived' },
): Promise<void> {
  await apiFetch(`/repair/projects/${rid}`, { method: 'PATCH', data: body });
}

export async function deleteRepairProject(rid: number): Promise<void> {
  await apiFetch(`/repair/projects/${rid}`, { method: 'DELETE' });
}

/* ---- Төслийн бус ажлын тайлан (шалгах / батлах) ---- */

export const NON_PROJECT_REVIEW_KEY = ['/reports/non-project-work'] as const;

export function useNonProjectReview(stage: NonProjectReviewFilter) {
  return useApiQuery<NonProjectReviewResponse>(
    [...NON_PROJECT_REVIEW_KEY, stage],
    `/reports/non-project-work?stage=${stage}`,
    { placeholderData: (prev) => prev, staleTime: 15_000 },
  );
}

/**
 * Батлах / татгалзах.  Батлахад сервер оноог (засвартай ижил томьёо) бичдэг
 * тул Бүтээмжийн тоонууд (тойм, ажилтан, баг) хуучирна — хамт цэвэрлэнэ.
 */
export function useDecideNonProjectWork() {
  const qc = useQueryClient();
  return async (id: number, action: 'approve' | 'reject', note: string | null): Promise<NonProjectReviewItem | null> => {
    const res = await apiFetch<{ item: NonProjectReviewItem | null }>(`/reports/non-project-work/${id}/${action}`, {
      method: 'POST',
      data: { note },
    });
    await Promise.all([
      qc.invalidateQueries({ queryKey: NON_PROJECT_REVIEW_KEY }),
      ...(action === 'approve'
        ? [
            qc.invalidateQueries({ queryKey: ['/reports/overview'] }),
            qc.invalidateQueries({ queryKey: ['/reports/employees'] }),
            qc.invalidateQueries({ queryKey: ['/reports/teams'] }),
          ]
        : []),
    ]);
    return res.item;
  };
}

/* ---- Менежментийн багийн тайлан ---- */

export const MGMT_LOGS_KEY = ['/reports/management-logs'] as const;

export function useManagementLogs(window: ReportWindow, anchor: string, enabled = true) {
  return useApiQuery<MgmtTeamResponse>(
    ['/reports/management-logs', window, anchor],
    `/reports/management-logs?${q(window, anchor)}`,
    { enabled, placeholderData: (prev) => prev, staleTime: 60_000 },
  );
}

export function useManagementMember(userId: number | null, window: ReportWindow, anchor: string) {
  return useApiQuery<MgmtMemberResponse>(
    ['/reports/management-logs', userId, window, anchor],
    `/reports/management-logs/${userId}?${q(window, anchor)}`,
    {
      enabled: userId != null,
      // Хугацаа солигдоход хуучин дүнг харуулна, гэхдээ ӨӨР хүнийхийг хэзээ ч биш.
      placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === userId ? prev : undefined),
      staleTime: 60_000,
    },
  );
}
