import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { useApiMutation, useApiQuery } from '@/shared/api/useApi';
import type {
  AsrDetailResponse,
  AsrIssueSource,
  AsrListResponse,
  AsrRecording,
  AsrReport,
  AsrReportType,
  AsrVisitsResponse,
  AsrProjectSummary,
  AsrVisitPlan,
  AsrVisitPlanInput,
  AsrVisitPlansResponse,
  AsrSafetyContentResponse,
} from './types';
import { isAsrRecordingPending } from './types';

const BASE = '/author-supervision';

export const asrKeys = {
  list: (projectId: number) => ['asr', 'project', projectId] as const,
  one: (id: number) => ['asr', 'report', id] as const,
  visits: (projectId: number) => ['asr', 'visits', projectId] as const,
  recordings: (id: number) => ['asr', 'recordings', id] as const,
  /** Хяналтын хуваарь (0331) — `projectId` 0/undefined = бүх төсөл. */
  plans: (projectId?: number) => ['asr', 'plans', projectId ?? 0] as const,
  /** `/app/asr`-ийн төрлөөр шүүсэн хөндлөн жагсаалт — `type` null = шүүлтгүй (татахгүй). */
  byType: (type: AsrReportType | null, limit: number) => ['asr', 'by-type', type, limit] as const,
};

export function useAsrList(projectId: number, enabled = true) {
  return useApiQuery<AsrListResponse>(asrKeys.list(projectId), `${BASE}/projects/${projectId}`, {
    enabled,
  });
}

/**
 * Бүх төслийн тайлан НЭГ ТӨРЛӨӨР (`GET /author-supervision?report_type=`) —
 * `/app/asr`-ийн «Талбайн хяналт / Цахим уулзалт / …» товчны үр дүн.  Ноорог
 * нь үзэгчийн харах эрхээр орно (`DRAFT_VISIBILITY`).  `limit`-ийг нэмэхэд
 * өмнөх мөрүүд алга болж гялсхийхгүй (`keepPreviousData`).
 */
export function useAsrReportsByType(type: AsrReportType | null, limit: number) {
  // Хөндлөн жагсаалтын мөр `project_name`-тэй (ЗХ-д харагдах нэр, 0358).
  return useApiQuery<{ entries: (AsrReport & { project_name?: string | null })[]; has_more: boolean }>(
    asrKeys.byType(type, limit),
    `${BASE}?report_type=${type ?? ''}&limit=${limit}`,
    { enabled: type != null, staleTime: 30_000, placeholderData: keepPreviousData },
  );
}

export function useAsrDetail(id: number | null) {
  return useApiQuery<AsrDetailResponse>(asrKeys.one(id ?? 0), `${BASE}/${id}`, {
    enabled: id != null,
  });
}

/** Жагсаалт + дэлгэрэнгүйг хамтад нь шинэчлэх (мутаци бүрийн дараа). */
export function useAsrInvalidate(projectId: number) {
  const qc = useQueryClient();
  return (id?: number) => {
    void qc.invalidateQueries({ queryKey: asrKeys.list(projectId) });
    // Илгээх / батлах / устгах бүр очилтын тоог хөдөлгөнө (сервер зөвхөн
    // `submitted|approved`-ыг тоолдог тул ноорог хадгалахад өөрчлөгдөхгүй,
    // гэхдээ энд ялгаж мэдэхгүй тул үргэлж дахин татна — хариу нь жижиг).
    void qc.invalidateQueries({ queryKey: asrKeys.visits(projectId) });
    // Төрлөөр шүүсэн хөндлөн жагсаалт (`/app/asr?type=`) — тайлан үүсэх/өөрчлөгдөх бүрд.
    void qc.invalidateQueries({ queryKey: ['asr', 'by-type'] });
    if (id != null) void qc.invalidateQueries({ queryKey: asrKeys.one(id) });
  };
}

export function useAsrCreate(projectId: number) {
  return useApiMutation<{ entry: AsrReport }, { client_uuid: string; report_date?: string }>(
    `${BASE}/projects/${projectId}`,
    { method: 'POST' },
  );
}

/* ------------------------------------------------------------------ */
/*  Төслийн сонголт — «Шинэ тайлан» товчны цонх                        */
/* ------------------------------------------------------------------ */

export interface AsrProjectOption {
  id: number;
  name: string;
  status: string | null;
  category: string | null;
  shifr: string | null;
  asr_only?: number | null;
}

/**
 * ЗХ тайлан бүртгэж болох төслүүд.
 *
 * ⚠️ `useAsrCrossList`-ийн хариун дахь `projects`-ыг ЭНД хэрэглэж
 *    БОЛОХГҮЙ — тэр нь «аль хэдийн тайлантай» төслүүдийн ШҮҮЛТҮҮР бөгөөд
 *    анхны тайланг хэзээ ч үүсгүүлэхгүй тахиа-өндөгний мухардал үүсгэнэ.
 *
 * `staleTime` нь өндөр: төслийн жагсаалт хормын дотор өөрчлөгддөггүй ба
 * цонх нээх бүрд дахин татах нь утгагүй.
 */
export function useAsrProjectOptions(enabled: boolean) {
  return useApiQuery<{ projects: AsrProjectOption[] }>(
    ['asr', 'project-options'],
    `${BASE}/projects`,
    { enabled, staleTime: 5 * 60_000 },
  );
}

/**
 * Аль ч төсөл дээр ноорог үүсгэнэ (төслийн id нь ХУВЬСАГЧААС ирнэ).
 *
 * `useAsrCreate` нь тогтмол `projectId`-д уягдсан тул төслийн таб-д л
 * тохирно.  `/app/asr` хуудсанд төслийг цонхон дотор сонгодог учир URL
 * нь хувьсагчийн функц байх ёстой.
 *
 * ⚠️ `useApiMutation` нь хувьсагчийн объектыг БҮХЭЛД НЬ биет болгодог тул
 *    `project_id` нь биетэд ч явна — сервер зөвхөн `client_uuid`,
 *    `report_date`, `shifr`-ыг уншдаг тул хор хөнөөлгүй
 *    (`useAsrPatch`-ийн яг тэр конвенц).
 */
export function useAsrCreateIn() {
  return useApiMutation<
    { entry: AsrReport },
    {
      project_id: number;
      client_uuid: string;
      report_date?: string;
      /** ХАБ-ын танилцсан баталгаа — серверийн хаалт (`routes/asrSafety.ts`). */
      safety_ack_id?: number | null;
      /**
       * Тайлангийн төрөл (0362).  Хаалт үүгээр шийдэгдэнэ: зөвхөн `site`
       * (Талбайн хяналт) ХАБ-ын баталгаа шаардана.
       */
      report_type?: AsrReportType;
    }
  >((v) => `${BASE}/projects/${v.project_id}`, { method: 'POST' });
}

/* ------------------------------------------------------------------ */
/*  ХАБ-ын мэдээлэл + танилцсан баталгаа (тайлан үүсгэхийн өмнөх алхам)  */
/* ------------------------------------------------------------------ */

export const ASR_SAFETY_KEY = ['asr', 'safety'] as const;

/** `GET /safety` — харуулах бичвэр; `hash` нь баталгаанд буцаж явна. */
export function useAsrSafetyContent(enabled: boolean) {
  return useApiQuery<AsrSafetyContentResponse>(ASR_SAFETY_KEY, `${BASE}/safety`, {
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useAsrSafetyAcknowledge() {
  return useApiMutation<
    { acknowledgement: { id: number; acknowledged_at: string; content_version: string } },
    {
      project_id?: number | null;
      content_version: string;
      content_hash: string;
      signature_url: string;
      confirmed: true;
    }
  >(`${BASE}/safety/acknowledgements`, { method: 'POST' });
}

/**
 * ⚠️ `useApiMutation` нь variables объектыг БҮХЭЛД НЬ JSON биет болгодог
 *    тул талбаруудыг хавтгай дамжуулна ({id, body:{…}} гэвэл сервер
 *    танил талбар олохгүй «No fields to update» 400 буцаана).  Нэмэлт
 *    `id` талбарыг сервер зүгээр л үл тоомсорлоно — PATCH нь зөвхөн
 *    өөрийн мэдэх багануудыг л SET-д оруулдаг.
 */
export function useAsrPatch() {
  return useApiMutation<{ entry: AsrReport }, { id: number } & Record<string, unknown>>(
    (v) => `${BASE}/${v.id}`,
    { method: 'PATCH' },
  );
}

export function useAsrSubmit() {
  return useApiMutation<{ entry: AsrReport }, { id: number }>((v) => `${BASE}/${v.id}/submit`, {
    method: 'POST',
  });
}

export function useAsrApprove() {
  return useApiMutation<{ entry: AsrReport }, { id: number; review_note?: string }>(
    (v) => `${BASE}/${v.id}/approve`,
    { method: 'PATCH' },
  );
}

export function useAsrReject() {
  return useApiMutation<{ entry: AsrReport }, { id: number; review_note: string }>(
    (v) => `${BASE}/${v.id}/reject`,
    { method: 'PATCH' },
  );
}

/* ------------------------------------------------------------------ */
/*  Улаан дэвтэр (0279)                                                */
/* ------------------------------------------------------------------ */

/**
 * Улаан дэвтрийн зургийг хавсаргах / хасах (`photo_url: null`).
 *
 * ⚠️ `useAsrPatch`-аар БИШ: тэр зам зохиогчид `draft|rejected`-ээс гадуур
 *    409 өгдөг, харин улаан дэвтрийн гарын үсэг тайлан илгээгдсэний ДАРАА
 *    нөхөгддөг.  Сервер баталгаажсан дэвтэр дээр 409 өгнө.
 */
export function useAsrRedBookPhoto() {
  return useApiMutation<{ entry: AsrReport }, { id: number; photo_url: string | null }>(
    (v) => `${BASE}/${v.id}/red-book`,
    { method: 'PATCH' },
  );
}

/**
 * «Талбай дээр улаан дэвтэр байгаагүй» (0366) — зурагтай ижил эрх, ижил
 * хөлдөлтгүй зам.  Зураг хавсаргасан эсвэл баталгаажсан бол 409.
 */
export function useAsrRedBookAbsent() {
  return useApiMutation<{ entry: AsrReport }, { id: number; absent: boolean }>(
    (v) => `${BASE}/${v.id}/red-book/absent`,
    { method: 'PATCH' },
  );
}

/** Эрх бүхий хүн (= `can_review`) баталгаажуулна. */
export function useAsrRedBookVerify() {
  return useApiMutation<{ entry: AsrReport }, { id: number }>(
    (v) => `${BASE}/${v.id}/red-book/verify`,
    { method: 'POST' },
  );
}

export function useAsrRedBookRevoke() {
  return useApiMutation<{ entry: AsrReport }, { id: number }>(
    (v) => `${BASE}/${v.id}/red-book/verify`,
    { method: 'DELETE' },
  );
}

/** Сонгох боломжтой хүн — `lib/asrCompanionStore.ts` `listCompanionCandidates`. */
export interface AsrCandidateUser {
  id: number;
  full_name: string;
  username?: string | null;
  position?: string | null;
  profile_image?: string | null;
  team_codes: string | null;
}

/**
 * `scope = 'team'` — талбайн «хамт явсан» (өөрийн багаас); `'all'` — оффис
 * уулзалтын «Оролцсон» (бүх идэвхтэй ажилтан, 0367).
 */
export function useAsrCompanionCandidates(
  reportId: number | null,
  enabled: boolean,
  scope: 'team' | 'all' = 'team',
) {
  const base =
    reportId != null ? `${BASE}/${reportId}/companion-candidates` : `${BASE}/companion-candidates`;
  return useApiQuery<{ users: AsrCandidateUser[] }>(
    ['asr', 'companion-candidates', reportId ?? 0, scope],
    scope === 'all' ? `${base}?scope=all` : base,
    { enabled },
  );
}

export function useAsrCompanionRedBook() {
  return useApiMutation<{ entry: AsrReport }, { id: number; user_id: number; photo_url: string | null }>(
    (v) => `${BASE}/${v.id}/companions/${v.user_id}/red-book`,
    { method: 'PATCH' },
  );
}

export function useAsrCompanionRedBookVerify() {
  return useApiMutation<{ entry: AsrReport }, { id: number; user_id: number }>(
    (v) => `${BASE}/${v.id}/companions/${v.user_id}/red-book/verify`,
    { method: 'POST' },
  );
}

export function useAsrCompanionRedBookRevoke() {
  return useApiMutation<{ entry: AsrReport }, { id: number; user_id: number }>(
    (v) => `${BASE}/${v.id}/companions/${v.user_id}/red-book/verify`,
    { method: 'DELETE' },
  );
}

export function useAsrDelete() {
  return useApiMutation<{ ok: true }, { id: number }>((v) => `${BASE}/${v.id}`, {
    method: 'DELETE',
  });
}

/* ------------------------------------------------------------------ */
/*  Очилтын тойм                                                       */
/* ------------------------------------------------------------------ */

/**
 * «Хэн / аль баг энэ төсөл дээр хэдэн удаа очив».  Ноорог тооцоонд
 * ОРДОГГҮЙ (сервер `submitted|approved`-оор шүүдэг) тул үзэгч бүр ижил
 * тоо харна.
 */
export function useAsrVisits(projectId: number, enabled = true) {
  return useApiQuery<AsrVisitsResponse>(
    asrKeys.visits(projectId),
    `${BASE}/projects/${projectId}/visits`,
    { enabled },
  );
}

/**
 * Өмнөх тайлангийн асуудлын сонголт (0336) — тухайн төслийн илгээгдсэн /
 * батлагдсан тайлангууд «Алдаа дутагдал» бичвэрийнх нь хамт.  Засварлагч
 * нээгдэх бүрт татахгүй (`enabled`): зөвхөн «Өмнөх тайлан холбох» дарахад.
 */
export function useAsrPreviousIssues(projectId: number, enabled: boolean) {
  return useApiQuery<{ reports: AsrIssueSource[] }>(
    ['asr', 'issues', projectId],
    `${BASE}/projects/${projectId}/issues`,
    { enabled, staleTime: 30_000 },
  );
}

/** `/app/asr` хуудсын төслийн жагсаалт — очилтын тоотой. */
export function useAsrProjectSummaries(enabled = true) {
  return useApiQuery<{ projects: AsrProjectSummary[] }>(
    ['asr', 'project-summaries'],
    `${BASE}/project-summaries`,
    { enabled, staleTime: 60_000 },
  );
}

/* ------------------------------------------------------------------ */
/*  Хяналтын хуваарь (миграц 0331)                                     */
/* ------------------------------------------------------------------ */

/**
 * Ирэх хуваарь (сервер `from` өгөгдмөл = өнөөдөр).  `projectId` өгвөл нэг
 * төслийнх; үгүй бол `/app/asr`-ийн эхний давхаргад бүх төслийнх.
 */
export function useAsrVisitPlans(projectId?: number, enabled = true) {
  const qs = projectId ? `?project_id=${projectId}` : '';
  return useApiQuery<AsrVisitPlansResponse>(asrKeys.plans(projectId), `${BASE}/plans${qs}`, {
    enabled,
    staleTime: 30_000,
  });
}

/** Нэг хуваарь — мэдэгдлийн `?plan=` холбоосоор нээхэд. */
export function useAsrVisitPlan(id: number | null) {
  return useApiQuery<{ plan: AsrVisitPlan; can_manage: boolean }>(
    ['asr', 'plan', id ?? 0],
    `${BASE}/plans/${id}`,
    { enabled: id != null },
  );
}

/** Бүх хуваарийн жагсаалтыг (бүх төслийн + төсөл бүрийн) шинэчилнэ. */
export function useAsrVisitPlansInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['asr', 'plans'] });
    void qc.invalidateQueries({ queryKey: ['asr', 'plan'] });
  };
}

export function useAsrVisitPlanCreate() {
  return useApiMutation<{ plan: AsrVisitPlan; notified: number }, AsrVisitPlanInput>(
    `${BASE}/plans`,
    { method: 'POST' },
  );
}

/** ⚠️ `useAsrPatch`-ийн ижил конвенц: `id` биетэд явна, сервер үл тоомсорлоно. */
export function useAsrVisitPlanPatch() {
  return useApiMutation<
    { plan: AsrVisitPlan; notified: number },
    { id: number } & Partial<AsrVisitPlanInput>
  >((v) => `${BASE}/plans/${v.id}`, { method: 'PATCH' });
}

/** Цуцлах — мөр устахгүй, `status = cancelled`; гишүүдэд мэдэгдэл очно. */
export function useAsrVisitPlanCancel() {
  return useApiMutation<{ plan: AsrVisitPlan; notified: number }, { id: number }>(
    (v) => `${BASE}/plans/${v.id}`,
    { method: 'DELETE' },
  );
}

/* ------------------------------------------------------------------ */
/*  Дуу бичлэг → текст                                                 */
/* ------------------------------------------------------------------ */

/** Транскрипц хүлээх poll-ийн давтамж. */
const RECORDING_POLL_MS = 5000;

/**
 * Тайлангийн бичлэгүүд.  Дэлгэрэнгүй хариунд ч ирдэг тул эхний
 * ачаалалтад ЭНЭ query хэрэггүй — гэхдээ транскрипц хүлээж байх үед
 * бүтэн тайланг дахин татахын оронд энэ хөнгөн endpoint-ыг л цохино.
 *
 * `refetchInterval` нь дуусаагүй мөр байхад л асна: бүгд дууссан бол
 * функц `false` буцааж, poll өөрөө унтарна.
 */
export function useAsrRecordings(id: number | null, initial?: AsrRecording[]) {
  return useApiQuery<{ recordings: AsrRecording[] }>(
    asrKeys.recordings(id ?? 0),
    `${BASE}/${id}/recordings`,
    {
      enabled: id != null,
      initialData: initial ? { recordings: initial } : undefined,
      refetchInterval: (query) =>
        (query.state.data?.recordings ?? []).some(isAsrRecordingPending)
          ? RECORDING_POLL_MS
          : false,
    },
  );
}

/**
 * Байршуулсан аудиог тайланд хавсаргаж, STT-д илгээнэ.
 *
 * ⚠️ `audio_key` нь `uploadMeetingAudio()`-ийн буцаадаг PRIVATE bucket-ийн
 *    түлхүүр.  `uploadFile()` (public `/media`) ХЭРЭГЛЭЖ БОЛОХГҮЙ — тэр нь
 *    талбайн дуу бичлэгийг түлхүүрээр нь баталгаажуулалтгүй уншигддаг
 *    болгоно.
 */
export function useAsrAddRecording() {
  return useApiMutation<
    { recordings: AsrRecording[] },
    {
      id: number;
      audio_key: string;
      content_type?: string;
      size_bytes?: number;
      duration_seconds?: number;
      sort_order?: number;
    }
  >((v) => `${BASE}/${v.id}/recordings`, { method: 'POST' });
}

/**
 * Транскриптийг ГАРААР засах.
 *
 * Speechmatics нь талбайн чимээ, барилгын нэр томьёо, овог нэрийг тогтмол
 * буруу сонсдог тул инженер «Тайлбар» руу оруулахын өмнө текстээ шууд
 * засварлана.  Хариу нь БҮХ бичлэгийг буцаадаг (POST/DELETE-тэй ижил
 * хэлбэр) тул `refresh()`-ийн зам огт өөрчлөгдөхгүй.
 *
 * ⚠️ `useApiMutation` нь variables объектыг БҮХЭЛД НЬ биет болгодог —
 *    `id`/`recordingId` нь URL-д ордог ч биетэд бас явна.  Сервер зөвхөн
 *    `transcript_text`-ийг уншдаг тул хор хөнөөлгүй (`useAsrPatch`-ийн
 *    яг тэр конвенц).
 */
export function useAsrUpdateRecording() {
  return useApiMutation<
    { recordings: AsrRecording[] },
    { id: number; recordingId: number; transcript_text: string }
  >((v) => `${BASE}/${v.id}/recordings/${v.recordingId}`, { method: 'PATCH' });
}

export function useAsrDeleteRecording() {
  return useApiMutation<{ recordings: AsrRecording[] }, { id: number; recordingId: number }>(
    (v) => `${BASE}/${v.id}/recordings/${v.recordingId}`,
    { method: 'DELETE' },
  );
}
