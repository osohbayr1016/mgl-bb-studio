/**
 * Төслийн бус ажил (backend миграц 0342, `routes/nonProjectWork.ts`).
 * Хэлбэр нь `lib/nonProjectWorkStore.ts`-ийн `shapeEntry` / `nonProjectMeta`.
 */

export type NonProjectStatus = 'pending' | 'approved' | 'rejected';

/** Серверт `entryStage`-ээр гаргасан шат — frontend ДАХИН тооцохгүй. */
export type NonProjectStage = 'needs_report' | 'awaiting_review' | 'approved' | 'rejected';

export interface NonProjectEntry {
  id: number;
  date: string;
  category: string;
  /** Серверийн (монгол) шошго — i18n-д түлхүүр байхгүй үеийн нөөц. */
  category_label: string;
  /** Зөвхөн «Бусад» ангилалд — ямар ажил болохыг ажилтан бичсэн. */
  note: string | null;
  /** Ирцэд сонгосон (цаггүй) мөрөнд null — ажилтан «Миний ажлууд»-аас
   *  ажлаа дуусгаж оруулах хүртэл. */
  start_time: string | null;
  end_time: string | null;
  /** Цагтай бол цайны цонхтой давхцсан хэсгийг хассан хугацаа; цаггүй бол 0
   *  (ирцийн сонголт зөвхөн хяналт — цаг бодогдохгүй). */
  minutes: number;
  /** Эхэлсэн/дууссан цагтай эсэх. */
  timed: boolean;
  /** Ирцэд аль хагаст сонгогдсон: `am` = өглөө, `pm` = 14:00 / гарах үед. */
  halves: DayHalf[];
  /** Ирцэд анх сонгосон цаг 'HH:MM' — «Миний ажлууд»-ын эхэлсэн цагийн урьдчилсан утга. */
  picked_at: string | null;
  /** Өнөөдрийн хамгийн сүүлийн ирцийн цэгт сонгогдсон — дараагийн цэгийн урьдчилсан сонголт. */
  active: boolean;
  /** Өдрийн төгсгөлд бичсэн «яг юу хийсэн». */
  report: string | null;
  reported_at: string | null;
  status: NonProjectStatus;
  stage: NonProjectStage;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  /** Админ батлах үед бүтээмжид олгосон хувь (засвартай ижил: өдрийн дундаж × цаг / 8); бусад үед null. */
  computed_pct: number | null;
}

export type DayHalf = 'am' | 'pm';

/**
 * Ирцийн цонхонд сонгосон төслийн бус ажил (`POST /attendance/clock-in` г.м.-ийн
 * `non_project`).  Зөвхөн хяналт — цаг, «юу хийсэн» байхгүй.
 */
export interface NonProjectPick {
  category: string;
  note: string | null;
}

export interface NonProjectCategoryOption {
  key: string;
  label: string;
  requires_note: boolean;
}

/** Маягтын тогтмол мэдээлэл.  `lunch` = null бол цайны цаг хасахгүй.
 *  `shift_end` = тухайн өдрийн ээлжийн дуусах цаг; дууссан цаг үүнээс хойш байж болохгүй.
 *  `shift_start` = ээлжийн эхлэл — эхэлсэн цагийн урьдчилсан утгын доод хязгаар. */
export interface NonProjectMeta {
  categories: NonProjectCategoryOption[];
  lunch: { start: string; end: string } | null;
  shift_end?: string | null;
  shift_start?: string | null;
}

/** `GET /attendance/my-status` → `non_project_work`. */
export interface NonProjectWorkToday extends NonProjectMeta {
  today: NonProjectEntry[];
}

/** `GET /non-project-work/my`. */
export interface NonProjectWorkMine extends NonProjectMeta {
  today: string;
  items: NonProjectEntry[];
}

/** «Миний ажлууд»-ын маягт — ажлаа дуусгасны дараа: цаг + «юу хийсэн» заавал. */
export interface NonProjectFormValues {
  category: string;
  note: string;
  start_time: string;
  end_time: string;
  report: string;
}
