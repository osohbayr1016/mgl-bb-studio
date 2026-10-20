/**
 * `/api/assessments` — Ур чадвар / зан чанарын үнэлгээний API давхарга.
 *
 * Бүх endpoint энд төвлөрнө: бөглөх wizard, senior-ийн жагсаалт, админы
 * удирдлага, Word import бүгд эндээс дуудна (компонент бүр өөрийн fetch
 * бичихгүй). Query key-үүд мөн энд — invalidate хийхэд ижил түлхүүр хэрэглэнэ.
 */

import { apiFetch } from '@/shared/api/client';
import type {
  AssessmentAnswers,
  AssessmentAssignment,
  AssessmentLevelBand,
  AssessmentResponseDetail,
  AssessmentRoundDetail,
  AssessmentRoundSummary,
  AssessmentSchema,
  AssessmentTemplateDetail,
  AssessmentTemplateSummary,
  RoundStatus,
} from './types';

export const BASE = '/assessments';

/** TanStack Query түлхүүрүүд — invalidate хийхэд эндээс авна. */
export const assessmentKeys = {
  my: ['/assessments/my'] as const,
  myResults: ['/assessments/my/results'] as const,
  myReviews: ['/assessments/my/reviews'] as const,
  response: (id: number) => ['/assessments/responses', id] as const,
  templates: ['/assessments/templates'] as const,
  template: (id: number) => ['/assessments/templates', id] as const,
  rounds: ['/assessments/rounds'] as const,
  round: (id: number) => ['/assessments/rounds', id] as const,
  roundResults: (id: number) => ['/assessments/rounds', id, 'results'] as const,
  /** Ростер аудит — нэмэх/хасах ёстой хүмүүс (`RosterPanel`). */
  candidates: (id: number) => ['/assessments/rounds', id, 'candidates'] as const,
  participantResult: (roundId: number, userId: number) =>
    ['/assessments/rounds', roundId, 'results', userId] as const,
};

// ---------------------------------------------------------------------------
// Ажилтан / senior
// ---------------------------------------------------------------------------

/** Надад оногдсон бөглөх маягтууд (өөрийн үнэлгээ). */
export const fetchMyAssignments = () =>
  apiFetch<{ assignments: AssessmentAssignment[] }>(`${BASE}/my`);

/** Миний үнэлэх ёстой хүмүүс (багийн ахлагчийн жагсаалт). */
export const fetchMyReviews = () =>
  apiFetch<{ assignments: AssessmentAssignment[] }>(`${BASE}/my/reviews`);

/**
 * Ажилтны ӨӨРИЙН үр дүн — түвшин, ӨӨРИЙН хувь, дараагийн түвшин хүртэлх зөрүү,
 * мөн жингээр эрэмбэлсэн сул/хүчтэй 3 хэсэг (`weakest` / `strongest`).
 *
 * ⚠️ 2026-08: өөрийн хувь НЭЭЛТТЭЙ болсон (эзний шийдвэр). Хил нь арилаагүй,
 *    зөвхөн нарийссан — **зөвхөн өөрийн**. Энэ хэлбэрт бусад хүнтэй
 *    харьцуулах ямар ч талбар (rank / percentile / багийн дундаж) БАЙХГҮЙ
 *    бөгөөд нэмж БОЛОХГҮЙ. Бүрэн жагсаалтыг backend `routes/assessments.ts`
 *    → `/my/results`-ийн I1–I5 инвариантаас үз (`weakest`/`strongest` нь
 *    ЗӨВХӨН өөрийн хэсгүүдийг эрэмбэлдэг тул I2-ыг зөрчихгүй).
 */
// ---------------------------------------------------------------------------
// «Түвшин ахих зам» (backend `lib/assessmentGap.ts`)
// ---------------------------------------------------------------------------

/**
 * ⚠️ Эдгээр төрөл нь ЗӨВХӨН хэлбэрийн тодорхойлолт — тооцоолол бүхэлдээ
 *    СЕРВЕР талд (`backend/src/lib/assessmentGap.ts`) хийгдэнэ.  Клиент дээр
 *    дахин бодох twin ЗОРИУДААР үүсгээгүй: `score.ts`/`behaviorScale.ts` шиг
 *    хоёр талд давхардуулбал хөшүүргийн томьёо чимээгүйхэн салж, ажилтан
 *    админаас ӨӨР зөвлөмж хардаг болно.  Шинэ талбар хэрэгтэй бол серверт
 *    нэмээд эндээ тусга.
 */
export interface LevelUpScaleStop {
  /** Шатлалын оноо. `0` = «хариулаагүй» (шатлалд байхгүй утга). */
  value: number;
  /** `scale.options[].label` — схемээс. Утга шатлалд байхгүй бол null. */
  label: string | null;
  /** `scale.options[].caption` — «10-19 хүртлэх төсөлд…». Схемээс. */
  caption: string | null;
}
/** «Энэ хэсгийн N мөрийг X-ээс Y болго» гэсэн нэг зөвлөмж. */
export interface LevelUpStep {
  section_id: string;
  code: string;
  title: string;
  weight: number | null;
  from: LevelUpScaleStop;
  to: LevelUpScaleStop;
  item_count: number;
  /** Энэ бүлгийг биелүүлбэл нэмэгдэх хэмжээ (`unit`-ийн нэгжээр). */
  gain: number;
  examples: string[];
}
export interface LevelUpTarget {
  /** `pct` — ур чадвар (0..100). `mean` — зан чанар (1..scale.max). */
  unit: 'pct' | 'mean';
  current: number | null;
  current_level: MyResultLevel | null;
  /** Дээд түвшинд байгаа хүнд null. */
  next_level: (MyResultLevel & { threshold: number }) | null;
  /** true бол дараагийн түвшин БАЙХГҮЙ — «0% дутуу» гэж харуулж БОЛОХГҮЙ. */
  at_top_level: boolean;
  gap: number | null;
  total_gain: number;
  /** `steps` нь зөрүүг бүрэн нөхөж чадаж байна уу. */
  covered: boolean;
  steps: LevelUpStep[];
}
export interface LevelUpSection extends LevelUpTarget {
  section_id: string;
  code: string;
  title: string;
  weight: number | null;
  item_count: number;
  /** Энэ хэсгийн НЭГ мөрийг +1 болгоход нийт хувь хэдээр өсөх вэ. */
  leverage: number;
}
export interface LevelUpPart {
  part_id: string;
  title: string;
  weighted: boolean;
  /** Зан чанарын part-д null (тэнд нийт түвшин гэж байхгүй — I5). */
  overall: LevelUpTarget | null;
  sections: LevelUpSection[];
}

/** Одоогийн шатлал (өнгө нь график/шошгонд хэрэгтэй). */
export interface MyResultLevel {
  code: string;
  label: string;
  color: string;
}
/** Дараагийн шатлал — `min_pct` нь «хүрэхэд хэдэн хувь хэрэгтэй». */
export interface MyResultNextLevel extends MyResultLevel {
  min_pct: number;
}
export interface MyResultSection {
  section_id: string;
  code: string;
  title: string;
  /** Ур чадварын хэсэгт өөрийн хувь; зан чанарын хэсэгт ҮРГЭЛЖ null (I5). */
  pct: number | null;
  level_code: string | null;
  level_label: string | null;
  level_color: string | null;
  /** Хэсгийн жин. Зан чанарын (weighted: false) part-д null. */
  weight: number | null;
  next_level_code: string | null;
  next_level_label: string | null;
  next_level_color: string | null;
  next_level_min_pct: number | null;
  /** Дараагийн түвшинд хүрэхэд дутуу хувь. Дээд түвшинд байвал null. */
  pct_to_next: number | null;
  /** Зан чанарын хэсэгт л ирнэ — 1.0–5.0 дундаж (хувь БИШ). */
  mean?: number | null;
  scale_max?: number | null;
  next_band_min_mean?: number | null;
  mean_to_next?: number | null;
}
/** Сул / хүчтэй хэсгийн мөр. `shortfall = (100 − pct) × weight` (жингээр эрэмбэлсэн). */
export interface MyResultRankedSection {
  section_id: string;
  code: string;
  title: string;
  pct: number | null;
  weight: number;
  level_code: string | null;
  level_label: string | null;
  level_color: string | null;
  shortfall: number | null;
}
export interface MyResultPart {
  part_id: string;
  title: string;
  chart: 'scatter' | 'radar';
  weighted: boolean;
  /** Зөвхөн weighted part-д — Σ(pct × weight) / Σ(weight). */
  overall_pct: number | null;
  overall_level_code: string | null;
  overall_level_label: string | null;
  overall_level_color: string | null;
  overall_next_level_label: string | null;
  overall_next_level_min_pct: number | null;
  overall_pct_to_next: number | null;
  sections: MyResultSection[];
}
export interface MyResultRound {
  round_id: number;
  round_name: string;
  round_period: string;
  round_status: 'draft' | 'open' | 'closed';
  submitted_at: string | null;
  senior_submitted: boolean;
  /** Раундын нийт хувь — weighted part-уудын дундаж. */
  overall_pct: number | null;
  overall_level_code: string | null;
  overall_level_label: string | null;
  overall_level_color: string | null;
  overall_next_level_code: string | null;
  overall_next_level_label: string | null;
  overall_next_level_min_pct: number | null;
  overall_pct_to_next: number | null;
  /** Жингээр эрэмбэлсэн хамгийн сул 3 хэсэг (юуг түрүүлж засах вэ). */
  weakest?: MyResultRankedSection[];
  /** Хамгийн өндөр хувьтай 3 хэсэг. */
  strongest?: MyResultRankedSection[];
  /** Хуучин UI-ийн хэрэглэдэг, weighted-only хавтгай жагсаалт. */
  sections: MyResultSection[];
  levels: AssessmentLevelBand[];
  parts: MyResultPart[];
  /** Дараагийн түвшинд хүрэхэд ЯГ ЮУ ХИЙХ ВЭ (`lib/assessmentGap.ts`). */
  level_up?: LevelUpPart[];
}
export const fetchMyResults = () => apiFetch<{ rounds: MyResultRound[] }>(`${BASE}/my/results`);

/** Нэг маягтын бүрэн агуулга (схем + хариулт). Эзэн эсвэл admin. */
export const fetchResponse = (id: number) =>
  apiFetch<{ response: AssessmentResponseDetail }>(`${BASE}/responses/${id}`);

/** Autosave — хариултын хэсэгчилсэн (эсвэл бүтэн) map илгээнэ. */
export const saveResponse = (id: number, answers: AssessmentAnswers) =>
  apiFetch<{ ok: true; updated_at: string; answered_count: number }>(
    `${BASE}/responses/${id}`,
    { method: 'PUT', data: { answers } },
  );

/** Эцэслэн илгээх — дараа нь засагдахгүй. */
export const submitResponse = (id: number) =>
  apiFetch<{ ok: true; submitted_at: string }>(`${BASE}/responses/${id}/submit`, {
    method: 'POST',
  });

// ---------------------------------------------------------------------------
// Админ — template
// ---------------------------------------------------------------------------

export const fetchTemplates = () =>
  apiFetch<{ templates: AssessmentTemplateSummary[] }>(`${BASE}/templates`);

export const fetchTemplate = (id: number) =>
  apiFetch<{ template: AssessmentTemplateDetail }>(`${BASE}/templates/${id}`);

export interface TemplateInput {
  code: string;
  title_mn: string;
  title_en?: string | null;
  description?: string | null;
  status?: 'draft' | 'active' | 'archived';
  /** Анхдагч баг ('BB') — раунд үүсгэх алхамд урьдчилан бөглөгдөнө. */
  team_codes?: string[];
  /** Анхдагч үнэлэгчид — мөн адил урьдчилан бөглөгдөнө. */
  senior_user_ids?: number[];
  schema: AssessmentSchema;
}

export const createTemplate = (input: TemplateInput) =>
  apiFetch<{ template: AssessmentTemplateDetail }>(`${BASE}/templates`, {
    method: 'POST',
    data: input,
  });

export const updateTemplate = (id: number, input: Partial<TemplateInput>) =>
  apiFetch<{ template: AssessmentTemplateDetail }>(`${BASE}/templates/${id}`, {
    method: 'PUT',
    data: input,
  });

export const deleteTemplate = (id: number) =>
  apiFetch<{ ok: true }>(`${BASE}/templates/${id}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Админ — round (судалгааны ээлж)
// ---------------------------------------------------------------------------

export const fetchRounds = () => apiFetch<{ rounds: AssessmentRoundSummary[] }>(`${BASE}/rounds`);

export const fetchRound = (id: number) =>
  apiFetch<{ round: AssessmentRoundDetail }>(`${BASE}/rounds/${id}`);

export interface RoundInput {
  template_id: number;
  name: string;
  period: string;
  /** Оролцогчид. Хоосон бол багаар/ролиор сонгоно (доорх талбарууд). */
  user_ids?: number[];
  /** Багийн код (жишээ 'BA') — тухайн багийн бүх гишүүнийг оруулна. */
  team_codes?: string[];
  roles?: string[];
  /**
   * Раунд ДАЯАР үнэлэх senior-ууд — сонгосон хүн бүр бүх оролцогчийг үнэлнэ
   * (өөрийгөө үнэлэхээс бусад).  Илгээгээгүй бол сервер хуучин зам руу
   * шилжиж, хүн тус бүрийн үндсэн багийн ахлагчийг оноодог.
   */
  senior_user_ids?: number[];
  opens_at?: string | null;
  closes_at?: string | null;
  /** 'draft' бол мэдэгдэл ЯВАХГҮЙ — дараа нь PATCH-аар нээхэд явна. */
  status?: 'draft' | 'open';
}

export const createRound = (input: RoundInput) =>
  apiFetch<{ round: AssessmentRoundDetail }>(`${BASE}/rounds`, { method: 'POST', data: input });

/**
 * Ээлжийн нэр / хугацаа / төлөв засах.
 *
 * ⚠️ Ээлжийн `name` нь ЗАГВАРЫН гарчгаас ТУСДАА хадгалагддаг: нэг загвараар
 *    олон ээлж явуулдаг тул загварыг сольсон ч энд автоматаар дамжихгүй.
 *    Тиймээс жагсаалтын харандаа товч ЭНЭ гарцыг дуудна.
 */
export const updateRound = (
  id: number,
  input: {
    name?: string;
    period?: string;
    status?: RoundStatus;
    opens_at?: string | null;
    closes_at?: string | null;
  },
) => apiFetch<{ round: AssessmentRoundSummary }>(`${BASE}/rounds/${id}`, {
  method: 'PATCH',
  data: input,
});

export const deleteRound = (id: number) =>
  apiFetch<{ ok: true }>(`${BASE}/rounds/${id}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Админ — оролцогчийн жагсаалт (roster)
//
// ⚠️ Бүхэл жагсаалтыг солидог `PUT /rounds/:id/participants` гарц сервер дээр
//    БАЙГАА ч эндээс ЗОРИУД гаргаагүй.  Нэг мөрийн товчинд тэр нь аюултай:
//    `participants` талбаргүй дуудвал бүх жагсаалт арилна, `senior_user_ids:
//    []` дамжуулбал бүх үнэлэгч цэвэрлэгдэнэ, мөн түүний `status='active'`
//    шүүлт нь хамааралгүй идэвхгүй хүмүүсийг чимээгүй хамт хаядаг.  Тиймээс
//    доорх нэг хүнд хамаарах гарцуудыг ашиглана.
// ---------------------------------------------------------------------------

/** Жагсаалтад БАЙХ ёстой ч бүртгэгдээгүй хүн (шинэ ажилтан). */
export interface RosterMissing {
  user_id: number;
  full_name: string;
  role: string;
  team_code: string | null;
}

/** Яагаад энэ хүн жагсаалтад БАЙХ ЁСГҮЙ вэ. */
export type RosterStaleReason = 'inactive' | 'role' | 'out_of_cohort' | 'excluded';

/** Бүртгэлтэй ч байх ёсгүй болсон хүн. */
export interface RosterStale {
  user_id: number;
  full_name: string;
  role: string;
  user_status: string;
  team_code: string | null;
  reason: RosterStaleReason;
  /** >0 бол хассан ч тайланд үлдэнэ (илгээсэн хариултыг хэзээ ч устгахгүй). */
  submitted_count: number;
}

export interface RoundCandidates {
  round_status: RoundStatus;
  auto_enroll: boolean;
  /** false бол хамрах хүрээ нь мэдэгдэхгүй хуучин ээлж — sync юу ч хийхгүй. */
  cohort_known: boolean;
  missing: RosterMissing[];
  stale: RosterStale[];
}

/** Жагсаалтын аудит — нэмэх/хасах ёстой хүмүүс.  Ямар ч бичилт хийхгүй. */
export const fetchRoundCandidates = (id: number) =>
  apiFetch<RoundCandidates>(`${BASE}/rounds/${id}/candidates`);

/** Хамрах хүрээнд тохирох ч бүртгэгдээгүй БҮХ хүнийг нөхөж бүртгэнэ. */
export const syncRoundParticipants = (id: number) =>
  apiFetch<{ added: number; round: AssessmentRoundDetail }>(`${BASE}/rounds/${id}/sync`, {
    method: 'POST',
  });

/** Нэг хүнийг ээлжид нэмнэ. */
export const addRoundParticipant = (roundId: number, userId: number) =>
  apiFetch<{ round: AssessmentRoundDetail }>(
    `${BASE}/rounds/${roundId}/participants/${userId}`,
    { method: 'POST' },
  );

/**
 * Нэг хүнийг ээлжээс хасна.
 *
 * `kept_submitted > 0` бол тухайн хүн ИЛГЭЭСЭН хариулттай тул тайланд
 * үлдэнэ — UI үүнийг ил хэлэх ёстой, «бүрэн хассан» гэж хуурч болохгүй.
 */
export const removeRoundParticipant = (roundId: number, userId: number) =>
  apiFetch<{ removed: true; kept_submitted: number; round: AssessmentRoundDetail }>(
    `${BASE}/rounds/${roundId}/participants/${userId}`,
    { method: 'DELETE' },
  );

// ---------------------------------------------------------------------------
// Админ — үр дүн
// ---------------------------------------------------------------------------

/** Нэг оролцогчийн бодогдсон үр дүн (сервер тал `assessmentScore.ts`-ээр бодно). */
export interface ParticipantResult {
  user_id: number;
  full_name: string;
  employee_id: string | null;
  profile_image: string | null;
  team_code: string | null;
  team_name_mn: string | null;
  position: string | null;
  self_submitted: boolean;
  /** Дор хаяж 1 ахлагч илгээсэн эсэх (хэд хэдэн ахлагч байж болно). */
  senior_submitted: boolean;
  /** Хэдэн ахлагч илгээсэн / нийт хэдэн ахлагч оноогдсон — "1/2" гэх мэт харуулахад. */
  senior_submitted_count: number;
  senior_total_count: number;
  /** Хуучин ганц-ахлагчийн нэр (одоо `assessment_participants`-ийн үлдэгдэл — шинэ код нь senior_evaluators ашиглана). */
  evaluator_name: string | null;
  /** Оноогдсон ахлагч бүрийн нэр + илгээсэн эсэх. */
  senior_evaluators: { user_id: number | null; full_name: string | null; submitted: boolean }[];
  parts: {
    part_id: string;
    title: string;
    chart: 'scatter' | 'radar';
    weighted: boolean;
    weight_sum: number;
    overall_pct: number | null;
    overall_level: AssessmentLevelBand | null;
    totals: { must: number; self: number | null; senior: number | null; average: number | null };
    sections: {
      section_id: string;
      code: string;
      title: string;
      weight: number;
      item_count: number;
      must: number;
      self: number | null;
      senior: number | null;
      average: number | null;
      self_pct: number | null;
      senior_pct: number | null;
      pct: number | null;
      level: AssessmentLevelBand | null;
    }[];
  }[];
  /** Excel-ийн дэлгэрэнгүй хуудсанд — мөр тус бүрийн түүхий хариулт.
   *  `senior` нь илгээсэн ахлагч бүрийн хариултын массив (0..N),
   *  `senior_evaluators`-тэй ИЖИЛ дараалалтай. */
  answers: { self: AssessmentAnswers; senior: AssessmentAnswers[] };
  /** Түвшин ахих зам. Ажилтан өөрөө илгээгээгүй бол null. */
  level_up: LevelUpPart[] | null;
}

export const fetchRoundResults = (id: number) =>
  apiFetch<{
    round: AssessmentRoundSummary;
    schema: AssessmentSchema;
    results: ParticipantResult[];
  }>(`${BASE}/rounds/${id}/results`);

/**
 * Нэг оролцогчийн дэлгэрэнгүй.
 *
 * ⚠️ Жагсаалтын `fetchRoundResults` нь `level_up`-ыг БУЦААХГҮЙ (оролцогч
 *    бүрийн төлөвлөгөө хариултыг олон дахин үлээлгэдэг тул сервер талд
 *    хаасан).  «Түвшин ахих зам» хэрэгтэй дэлгэц ЭНЭ гарцыг дуудна.
 *    Жагсаалтыг орлуулахгүй — benchmark/cohort нь бүх оролцогчийг шаарддаг.
 */
export const fetchParticipantResult = (roundId: number, userId: number) =>
  apiFetch<{
    round: AssessmentRoundSummary;
    schema: AssessmentSchema;
    result: ParticipantResult;
  }>(`${BASE}/rounds/${roundId}/results/${userId}`);
