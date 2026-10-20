/**
 * Үнэлгээний схемийн каноник төрлүүд.
 *
 * ⚠️ Энэ файл `backend/src/lib/assessmentSchema.ts`-тэй ЯГ ИЖИЛ байна.
 *    Shared package байхгүй тул хоёр талд давхардуулсан — аль нэгийг засвал
 *    нөгөөг нь заавал дагуулж засна. Дэлгэрэнгүй: docs/dev/assessments-spec.md
 */

// ---------------------------------------------------------------------------
// Схем (assessment_templates.schema_json / assessment_rounds.schema_json)
// ---------------------------------------------------------------------------

/** 1–5 онооны нэг шатлалын тайлбар (хуудасны оройн legend-д харагдана). */
export interface AssessmentScaleOption {
  /** Оноо (ихэвчлэн 1..5). */
  value: number;
  /** Богино нэр — жишээ нь «EXPERT», «Тогтмол, байнгын». */
  label: string;
  /** Дэлгэрэнгүй тайлбар — «20 ба түүнээс дээш төсөлд хийж гүйцэтгэсэн…». */
  caption?: string;
}

/** Онооны шатлал. Ур чадвар (туршлага) ба зан чанар нь өөр өөр тайлбартай. */
export interface AssessmentScale {
  id: string;
  label: string;
  min: number;
  max: number;
  options: AssessmentScaleOption[];
}

/** `pct` утгыг level нэр рүү буулгах хязгаар. */
export interface AssessmentLevelBand {
  code: string;
  label: string;
  /** Хамрах хувийн доод хязгаар (оруулаад). */
  minPct: number;
  /** Хамрах хувийн дээд хязгаар (оруулаад). */
  maxPct: number;
  /** Tailwind-гүй түүхий hex — график болон badge-д. */
  color: string;
}

/** 1–5 оноо өгөх нэг мөр. `must` оноо бүрд `scale.max` нэмэгдэнэ. */
export interface AssessmentItem {
  id: string;
  text: string;
  /** true бол оноог урвуулж тооцно (5→1). Архитекторын судалгаанд хэрэглээгүй. */
  reverse?: boolean;
}

/** Дэд асуулт (1.1.1 гэх мэт) — доор нь оноо өгөх мөрүүд байна. */
export interface AssessmentGroup {
  id: string;
  title: string;
  hint?: string;
  items: AssessmentItem[];
}

/** Хэсэг — ур чадварт нэг хуудас, зан чанарт spider-ийн нэг тэнхлэг. */
export interface AssessmentSection {
  id: string;
  /** График/Excel-д харагдах богино код: «CONCEPT_DESIGN». */
  code: string;
  title: string;
  subtitle?: string;
  description?: string;
  /** Зөвхөн `weighted: true` part-д утгатай. Нийлбэр 100 байх ёстой (зөөлөн). */
  weight: number;
  groups: AssessmentGroup[];
}

export interface AssessmentPart {
  id: string;
  title: string;
  intro?: string;
  /** `AssessmentSchema.scales[].id` руу заана. */
  scaleId: string;
  chart: 'scatter' | 'radar';
  /** true — жин, level, нийт оноо бодогдоно. false — зөвхөн хэсгийн хувь. */
  weighted: boolean;
  /** 'section' — хэсэг бүр тусдаа хуудас. 'part' — бүгд нэг хуудсанд. */
  paging: 'section' | 'part';
  sections: AssessmentSection[];
}

/**
 * Асуултгүй танилцуулга/зааврын нэг блок.
 *
 * Word-оос ирсэн «СУДАЛГААНЫ АГУУЛГА», «СУДАЛГАА НЬ ҮНДСЭН 2 ХЭСЭГТ
 * ХУВААГДАНА» мэт оноо өгөх мөргүй хэсгүүд ЭНД хадгалагдана — тэдгээр нь
 * хог биш, ажилтан бөглөж эхлэхийн ӨМНӨ уншдаг заавар юм.  Wizard-ын
 * ХАМГИЙН ЭХНИЙ хуудас болж гарна (`AssessmentFillPage` → `IntroPage`).
 */
export interface AssessmentIntroBlock {
  id: string;
  /** Гарчиг — Word дээрх хоосон хэсгийн нэр. */
  heading?: string;
  /** Догол мөрүүд — `\n`-ээр тусгаарласан энгийн текст (markdown БИШ). */
  body?: string;
}

export interface AssessmentSchema {
  version: 1;
  scales: AssessmentScale[];
  levels: AssessmentLevelBand[];
  parts: AssessmentPart[];
  /** Танилцуулга хуудас. Хоосон/байхгүй бол тэр хуудас гарахгүй. */
  intro?: AssessmentIntroBlock[];
}

/** Хариултын хавтгай map: item id → оноо. */
export type AssessmentAnswers = Record<string, number>;

export type EvaluatorKind = 'self' | 'senior';
export type ResponseStatus = 'draft' | 'submitted';
export type RoundStatus = 'draft' | 'open' | 'closed';
export type TemplateStatus = 'draft' | 'active' | 'archived';

// ---------------------------------------------------------------------------
// API хэлбэрүүд
// ---------------------------------------------------------------------------

export interface AssessmentTemplateSummary {
  id: number;
  code: string;
  title_mn: string;
  title_en: string | null;
  description: string | null;
  status: TemplateStatus;
  item_count: number;
  section_count: number;
  /** Анхдагч баг ('BA' / 'BB'…) — раунд үүсгэхэд урьдчилан бөглөгдөнө. */
  team_codes: string[];
  /** Анхдагч үнэлэгчид (senior) — мөн адил урьдчилан бөглөгдөнө. */
  senior_user_ids: number[];
  created_at: string;
  updated_at: string;
}

export interface AssessmentTemplateDetail extends AssessmentTemplateSummary {
  schema: AssessmentSchema;
}

export interface AssessmentRoundSummary {
  id: number;
  template_id: number;
  name: string;
  period: string;
  status: RoundStatus;
  opens_at: string | null;
  closes_at: string | null;
  participant_count: number;
  self_submitted_count: number;
  senior_submitted_count: number;
  /** Раунд ямар багт явсан. */
  team_codes: string[];
  /** Раунд ДАЯАР үнэлэх senior-ууд (бүх оролцогчийг үнэлнэ). */
  senior_user_ids: number[];
  created_at: string;
}

export interface AssessmentParticipant {
  user_id: number;
  full_name: string;
  employee_id: string | null;
  profile_image: string | null;
  team_code: string | null;
  team_name_mn: string | null;
  evaluator_user_id: number | null;
  evaluator_name: string | null;
  self_status: ResponseStatus | null;
  self_response_id: number | null;
  /** Хэд хэдэн ахлагчтай үед «БҮГД илгээсэн» байж гэмээнэ `'submitted'`. */
  senior_status: ResponseStatus | null;
  senior_response_id: number | null;
  senior_total: number;
  senior_submitted: number;
  /** Оноогдсон ахлагч бүр — нэр, маягтын id, төлөв. */
  seniors: {
    user_id: number | null;
    full_name: string | null;
    response_id: number;
    status: ResponseStatus;
  }[];
}

export interface AssessmentRoundDetail extends AssessmentRoundSummary {
  schema: AssessmentSchema;
  participants: AssessmentParticipant[];
  /** `senior_user_ids`-ийн нэрлэсэн хэлбэр. */
  senior_users: { user_id: number; full_name: string }[];
}

/** Бөглөх маягтын нэг хуваарь (ажилтан өөрөө эсвэл senior-ийн үнэлэх хүн). */
export interface AssessmentAssignment {
  response_id: number;
  round_id: number;
  round_name: string;
  round_period: string;
  round_status: RoundStatus;
  template_title: string;
  subject_user_id: number;
  subject_name: string;
  evaluator_kind: EvaluatorKind;
  status: ResponseStatus;
  submitted_at: string | null;
  updated_at: string;
  /** Бөглөсөн мөрийн тоо / нийт мөрийн тоо. */
  answered_count: number;
  total_count: number;
}

export interface AssessmentResponseDetail {
  id: number;
  round_id: number;
  round_name: string;
  round_period: string;
  round_status: RoundStatus;
  subject_user_id: number;
  subject_name: string;
  evaluator_kind: EvaluatorKind;
  status: ResponseStatus;
  submitted_at: string | null;
  answers: AssessmentAnswers;
  schema: AssessmentSchema;
  /** Одоогийн нэвтэрсэн хэрэглэгч энэ маягтын жинхэнэ эзэн (evaluator) мөн эсэх. */
  is_owner: boolean;
}
