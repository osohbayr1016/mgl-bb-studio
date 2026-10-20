/**
 * `/api/deadlines` — «Хугацаа» харагдацын API давхарга.
 *
 * Бүх дуудлага энд төвлөрнө; бичих үйлдэл бүр холбогдох түлхүүрүүдийг
 * invalidate хийнэ.  Дэд хугацаа өөрчлөгдвөл ГУРВАН газар хуучирна:
 *   · тухайн таскийн popover  (`/deadlines/tasks/:id`)
 *   · төслийн «Хугацаа» таб    (`/deadlines/project/:id`)
 *   · Dashboard-ийн жагсаалт   (`/deadlines/upcoming`)
 * Тиймээс `invalidateDeadlines` нь prefix түлхүүрээр гурвуулангийг зэрэг
 * шинэчилнэ — дуудагч тал аль нь хуучирсныг бодох шаардлагагүй.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import { apiFetch, type ApiError } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { useApiQuery } from '@/shared/api/useApi';
import type {
  CalendarDeadlineResponse,
  DeadlineChange,
  DeadlineHistoryResponse,
  DeadlineItem,
  DeadlineSummaryResponse,
  ExtensionInput,
  MilestoneInput,
  ProjectDeadlineResponse,
  UpcomingDeadlineResponse,
} from './types';

const BASE = '/deadlines';

/** Бүх хугацааны query-ийн нийтлэг угтвар — үүгээр бөөнөөр invalidate хийнэ. */
export const DEADLINES_KEY = ['/deadlines'] as const;

export const projectDeadlinesKey = (projectId: number) =>
  [...DEADLINES_KEY, 'project', projectId] as const;

/** ⚠️ `includeDone` нь ТҮЛХҮҮРИЙН ХЭСЭГ байх ёстой — Dashboard-ийн карт
 *  (зөвхөн нээлттэй) ба `/app/deadlines` (биелсэнийг ч оруулна) хоёр ижил
 *  scope/days-аар дууддаг тул түлхүүрт оруулахгүй бол хоёр өөр агуулгыг
 *  нэг нүдэнд бичиж, картад биелсэн мөр гэнэт гарч ирнэ. */
export const upcomingDeadlinesKey = (
  scope: 'mine' | 'all',
  days: number,
  includeDone = false,
) => [...DEADLINES_KEY, 'upcoming', scope, days, includeDone] as const;

export const calendarDeadlinesKey = (
  scope: 'mine' | 'all',
  from: string,
  to: string,
  includeDone = false,
) => [...DEADLINES_KEY, 'calendar', scope, from, to, includeDone] as const;

/** Төслийн жагсаалтын chip.  id-уудыг эрэмбэлж түлхүүр болгоно — ижил
 *  олонлогийг өөр дарааллаар хүсэхэд кэш дахин ашиглагдана. */
export const deadlineSummaryKey = (projectIds: number[]) =>
  [...DEADLINES_KEY, 'summary', [...projectIds].sort((a, b) => a - b).join(',')] as const;

/** Бичилтийн дараа бүх хугацааны жагсаалтыг шинэчилнэ.  Prefix таарал —
 *  TanStack Query нь `['/deadlines']`-аар эхэлсэн БҮХ түлхүүрийг барина. */
export async function invalidateDeadlines(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: DEADLINES_KEY });
}

/** Кэшлэгдсэн хугацааны хариу бүрийн нийтлэг хэлбэр — доорх засварлагч нь
 *  `/upcoming`, `/calendar`, `/project/:id` гурвуулангийн `items`-ыг ижил
 *  аргаар хөндөнө (гурвуулаа `{ items: DeadlineItem[] }` хэлбэртэй). */
interface ItemsEnvelope {
  items: DeadlineItem[];
}

/**
 * БҮХ хугацааны кэш дэх нэг мөрийг ШУУД засна (optimistic update).
 *
 * ЯАГААД ХЭРЭГТЭЙ ВЭ: сүлжээний хариу ирэх хүртэл 300-800мс чагт нь
 * хөдөлдөггүй байсан тул эзэн «дарагдсангүй» гэж бодоод дахин дардаг —
 * улмаар хоёр PATCH явж, төлөв нь буцаад эргэдэг.  Одоо чагт нь ТУХАЙН
 * АГШИНД эргэж, сервер зөрвөл `invalidateDeadlines` үнэнийг нь буцаана.
 *
 * ⚠️ Мөрийг ХАСАХГҮЙ, зөвхөн `done`-ыг сэлгэнэ.  Хасах нь яг тэр «алга
 *    болох» алдааг optimistic давхаргад дахин бүтээнэ.
 */
export function patchDeadlineDoneInCache(key: string, done: boolean): void {
  queryClient.setQueriesData<ItemsEnvelope>({ queryKey: DEADLINES_KEY }, (old) => {
    if (!old || !Array.isArray(old.items)) return old;
    let hit = false;
    const items = old.items.map((it) => {
      if (it.key !== key) return it;
      hit = true;
      // `risk_state`-ыг мөн шинэчилнэ — эс бөгөөс биелсэн мөр улаан
      // «хэтэрсэн» chip-тэйгээ үлдэж, чагттай нүдэн дээр зөрчилдөнө.
      // `done_at`-ыг тэмдэглэгээ АВАХАД цэвэрлэнэ: үлдээвэл «Биелсэн
      // огноо» хөзөр, зураас дээрх ногоон чагт хоёр хэвээр үлдэнэ.
      return {
        ...it,
        done,
        risk_state: done ? 'done' : guessRiskState(it.days_left),
        done_at: done ? it.done_at : null,
      };
    });
    return hit ? { ...old, items } : old;
  });
}

/** Тэмдэглэгээг АВАХ үеийн түр зуурын эрсдэлийн төлөв.  Серверийн
 *  `computeDeadlineRisk`-ийн энгийшүүлсэн хувилбар — хэдхэн зуун мс амьдарна
 *  (`invalidateDeadlines` жинхэнэ утгыг нь дараа нь буулгана).  Тиймээс
 *  `stale`/`not_started` зэрэг явцаас хамаарах төлөвүүдийг оролдохгүй. */
export function guessRiskState(daysLeft: number | null): DeadlineItem['risk_state'] {
  if (daysLeft == null) return 'unscheduled';
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= 1) return 'due_1';
  if (daysLeft <= 3) return 'due_3';
  if (daysLeft <= 7) return 'due_7';
  return 'on_track';
}

/* ------------------------------- Уншилт ------------------------------- */

/** Нэг төслийн бүх хугацаа — «Хугацаа» таб болон hero дээрх chip. */
export function useProjectDeadlines(
  projectId: number,
  enabled = true,
): UseQueryResult<ProjectDeadlineResponse, ApiError> {
  return useApiQuery<ProjectDeadlineResponse>(
    projectDeadlinesKey(projectId),
    `${BASE}/project/${projectId}`,
    { enabled: enabled && Number.isFinite(projectId) && projectId > 0 },
  );
}

/** Dashboard-ийн «Ойрын хугацаанууд».  `scope='all'` нь admin+senior л
 *  зөвшөөрөгдөнө — бусад дүр 403 авна, тиймээс дуудагч тал дүрээ шалгаж
 *  байж дамжуулна (UX; жинхэнэ хаалт нь сервер). */
export function useUpcomingDeadlines(
  scope: 'mine' | 'all' = 'mine',
  days = 30,
  enabled = true,
  /** Биелсэн мөрийг ч авах уу.  Үндсэн утга нь `false` — Dashboard-ийн
   *  карт зэрэг «дараа юу хийх вэ» гэсэн харагдацууд хэвээр үлдэнэ.
   *  `/app/deadlines` нь `true`-гээр дуудаж, биелсэнийг ёроолд харуулна. */
  includeDone = false,
): UseQueryResult<UpcomingDeadlineResponse, ApiError> {
  return useApiQuery<UpcomingDeadlineResponse>(
    upcomingDeadlinesKey(scope, days, includeDone),
    `${BASE}/upcoming?scope=${scope}&days=${days}${includeDone ? '&include_done=1' : ''}`,
    { enabled },
  );
}

/** Хуанлийн муж — `/app/deadlines` хуудасны сарын сүлжээ.  `from`/`to` нь
 *  ISO огноо; сервер тал 92 хоногийн дээд хязгаартай. */
export function useCalendarDeadlines(
  scope: 'mine' | 'all',
  from: string,
  to: string,
  enabled = true,
  includeDone = false,
): UseQueryResult<CalendarDeadlineResponse, ApiError> {
  return useApiQuery<CalendarDeadlineResponse>(
    calendarDeadlinesKey(scope, from, to, includeDone),
    `${BASE}/calendar?scope=${scope}&from=${from}&to=${to}${includeDone ? '&include_done=1' : ''}`,
    { enabled: enabled && Boolean(from) && Boolean(to) },
  );
}

/**
 * Төслийн жагсаалтын хугацааны chip / баарны тэмдэглэгээ — олон төслийг
 * НЭГ хүсэлтээр.  Хоосон жагсаалт ирвэл огт дуудахгүй.
 *
 * ⚠️ `placeholderData` нь ЗААВАЛ.  Түлхүүрт id-уудын жагсаалт орсон тул
 *    хэрэглэгч хайлтын талбарт нэг үсэг бичихэд шүүлт нарийсаж, ХЭЗЭЭ Ч
 *    татаж байгаагүй шинэ түлхүүр үүснэ — `data` нь бүтэн round trip-ийн
 *    турш `undefined` болно.  Тэр агшинд `/app/projects` дээр баар бүрийн
 *    хугацааны зураас, доорх chip мөр хоёулаа АЛГА болж, карт намсаж,
 *    hover хөзөр ажиллахаа болиод дараа нь буцаж гарч ирнэ — үсэг бүр дээр.
 *    Өмнөх хариуг байрандаа үлдээвэл энэ анивчилт арилна (`users/api.ts`,
 *    `LeaderboardPage`, `MailInboxPage`-тай ижил хэв маяг).
 *
 *    Оронд нь «шүүлтгүй бүтэн жагсаалтаар түлхүүрлэх» шийдэл БУРУУ:
 *    сервер тал id-г эрэмбэлсний ДАРАА 60-аар тасалдаг (`SUMMARY_MAX_PROJECTS`)
 *    тул 60-аас олон төсөлтэй үед сүүлийн (шинэ) төслүүдийн хугацаа зөвхөн
 *    хайлтаар нарийсгаж байж татагддаг — түлхүүрийг царцаавал тэд мөнхөд
 *    хоосон үлдэнэ.
 */
export function useDeadlineSummary(
  projectIds: number[],
  enabled = true,
): UseQueryResult<DeadlineSummaryResponse, ApiError> {
  const ids = [...projectIds].sort((a, b) => a - b);
  return useApiQuery<DeadlineSummaryResponse>(
    deadlineSummaryKey(ids),
    `${BASE}/summary?project_ids=${ids.join(',')}`,
    { enabled: enabled && ids.length > 0, placeholderData: (prev) => prev },
  );
}

/* ------------------------------- Бичилт ------------------------------- */

/* ------------------------- Milestone-ийн бичилт ----------------------- */
/*  Бүгд admin/senior-т л зөвшөөрөгдөнө (сервер тал шалгана).  Дуудагч UI
 *  нь `can_edit`-ийг дагаж товчоо нуух ёстой — дүрээ өөрөө шалгах биш.   */

export async function createMilestone(
  input: MilestoneInput & { project_id: number; title: string; due_date: string },
): Promise<{ success: boolean; id: number | null }> {
  const res = await apiFetch<{ success: boolean; id: number | null }>(
    `${BASE}/milestones`,
    { method: 'POST', data: input },
  );
  await invalidateDeadlines();
  return res;
}

export async function updateMilestone(id: number, input: MilestoneInput): Promise<void> {
  await apiFetch(`${BASE}/milestones/${id}`, { method: 'PUT', data: input });
  await invalidateDeadlines();
}

/**
 * Биелсэн эсэхийг сэлгэнэ.
 *
 * ⚠️ Ажилтай холбогдсон milestone дээр сервер 400 буцаана — түүний төлөв
 *    явцаас гардаг.  Дуудагч UI нь холбоостой мөрөнд чагт огт үзүүлэхгүй.
 *
 * ⚠️ Эцгийг тэмдэглэхэд дэд хугацаанууд нь ДАГАЖ хаагдана; хэдэн мөр
 *    хаагдсаныг `children_marked` буцаана — дуудагч тал үүнийг хэрэглэгчид
 *    ИЛ хэлэх ёстой (чимээгүй бөөнөөр өөрчлөх нь гайхшруулна).
 */
export async function toggleMilestoneDone(
  id: number,
  done: boolean,
): Promise<{ success: boolean; done: boolean; children_marked: number }> {
  const res = await apiFetch<{ success: boolean; done: boolean; children_marked: number }>(
    `${BASE}/milestones/${id}/done`,
    { method: 'PATCH', data: { done } },
  );
  await invalidateDeadlines();
  return res;
}

export async function deleteMilestone(id: number): Promise<void> {
  await apiFetch(`${BASE}/milestones/${id}`, { method: 'DELETE' });
  await invalidateDeadlines();
}

/* ------------------------------------------------------------------ */
/*  Төслийн дуусах хугацааны СУНГАЛТ + түүх (migration 0337)            */
/* ------------------------------------------------------------------ */

export const deadlineHistoryKey = (projectId: number) =>
  [...DEADLINES_KEY, 'history', projectId] as const;

/** Сунгалт нь `finish_date` баганыг өөрчилдөг тул хугацааны жагсаалтаас гадна
 *  Timeline, төслийн жагсаалт, төслийн дэлгэрэнгүй бүгд хуучирна. */
async function invalidateAfterDeadlineChange(projectId: number): Promise<void> {
  await Promise.all([
    invalidateDeadlines(),
    queryClient.invalidateQueries({ queryKey: ['/timeline'] }),
    queryClient.invalidateQueries({ queryKey: ['/projects'] }),
    queryClient.invalidateQueries({ queryKey: [`/projects/${projectId}`] }),
    // `ProjectInfoTab`-ийн паспортын түлхүүр (['/projects/passport', id]) — 1.3
    // хүснэгтэд шинэ «Сунгалт» мөр гарах ёстой.
    queryClient.invalidateQueries({ queryKey: ['/projects/passport', projectId] }),
  ]);
}

export function useDeadlineHistory(
  projectId: number,
  enabled = true,
): UseQueryResult<DeadlineHistoryResponse, ApiError> {
  return useApiQuery<DeadlineHistoryResponse>(
    deadlineHistoryKey(projectId),
    `${BASE}/project/${projectId}/extensions`,
    { enabled: enabled && projectId > 0 },
  );
}

export interface ExtensionResult extends Omit<DeadlineHistoryResponse, 'today' | 'can_manage' | 'can_revert' | 'raw_finish_date' | 'items'> {
  success: true;
  finish_date: string;
  item: DeadlineChange | null;
}

/** Хугацаа сунгах — сервер `finish_date`-ыг шинэчилж, түүхийн мөр бичнэ.
 *  400 (`NOT_LATER`, `NO_CURRENT_DEADLINE`…) нь `ApiError.message`-д монголоор. */
export async function createExtension(projectId: number, body: ExtensionInput): Promise<ExtensionResult> {
  const res = await apiFetch<ExtensionResult>(`${BASE}/project/${projectId}/extensions`, {
    method: 'POST',
    data: body,
  });
  await invalidateAfterDeadlineChange(projectId);
  return res;
}

/** Сүүлийн сунгалтыг буцаах (admin) — зөвхөн хамгийн сүүлийн мөр, `finish_date`
 *  хөндөгдөөгүй үед (409 `NOT_LATEST` / `STALE`). */
export async function revertExtension(projectId: number, changeId: number): Promise<void> {
  await apiFetch(`${BASE}/project/${projectId}/extensions/${changeId}`, { method: 'DELETE' });
  await invalidateAfterDeadlineChange(projectId);
}
