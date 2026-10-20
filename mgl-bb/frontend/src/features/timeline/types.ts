/**
 * «Төслийн хуваарь» (portfolio Gantt) — frontend талын төрлүүд.
 *
 * Энэ файл нь `GET /api/timeline`-ын хариуг ЯГ тусгана (backend-ийн
 * `routes/timeline.ts` + `lib/projectRisk.ts` хоёртой гэрээгээр таарна).
 * Мөр бүр = НЭГ ТӨСӨЛ (task биш) — огнооны тэнхлэг дээр нэг баар.
 *
 * Төлөв (`risk_state`) нь DB-д хадгалагддаггүй, сервер тал өдөр бүр
 * дахин боддог үүсмэл утга:
 *   finish_date байхгүй  → 'unscheduled' (хуваарьгүй)
 *   start_date ирээдүйд  → 'not_started' (хараахан эхлээгүй)
 * Тул энд шинэ статусын багана байхгүй — зөвхөн уншиж харуулна.
 */

/** Эрсдэлийн төлөв — `backend/src/lib/projectRisk.ts`-ийн union-тай ижил. */
export type RiskState =
  | 'done'
  | 'overdue'
  | 'due_1'
  | 'due_3'
  | 'due_7'
  | 'stale'
  | 'not_started'
  | 'unscheduled'
  | 'on_track';

/** Хариуцагч (багийн ахлагч, эсвэл fallback-аар сонгогдсон хүн). */
export interface TimelineLead {
  id: number;
  full_name: string;
}

/** Тэнхлэг дээрх нэг мөр. */
export interface TimelineProject {
  id: number;
  name: string;
  display_title: string | null;
  /** 'AZ' | 'ZA' | 'ET' | 'EZ' | 'IZ' | null */
  category: string | null;
  status: 'active' | 'completed' | 'archived';
  /** 0|1 — «яаралтай» тэмдэглэгээ. */
  is_asap: number;
  /** 0|1 — гэрээ хэлэлцээрийн шатанд (гэрээ хараахан байгуулагдаагүй).
   *  Мөр шараар тодорно; компанийн «идэвхтэй төсөл»-ийн тоо болон хугацаа
   *  хэтэрсэн даалгаврын жагсаалтаас хасагдана (migration 0143). */
  is_pending: number;
  /** 0..100. `manual_progress` тавигдсан бол тэр НЬ АЛЬ ХЭДИЙН ялсан байна. */
  progress: number;
  /** Гараар тавьсан хувь (жижиг засварын ажилд). null бол автомат тооцоо. */
  manual_progress: number | null;
  /** Блок/зураг/эд ангийн задаргаа байгаа эсэх (ядаж 1 блок). */
  has_breakdown: boolean;
  /** 'YYYY-MM-DD' — `project_passport` дахь баталгаажаагүй чөлөөт текст. */
  start_date: string | null;
  /** 'YYYY-MM-DD' — мөн адил баталгаажаагүй. */
  finish_date: string | null;
  /** Хамгийн сүүлд батлагдсан прогрессийн бичилт ('YYYY-MM-DD HH:MM:SS', UTC). */
  last_activity_at: string | null;
  /* ── Төслийн ЖАГСААЛТ хуудастай ижил мэдээлэл (2026-08-13) ────────────
   * «Хугацаа» хуудас устсаны дараа энэ хуудас нь эцсийн хугацааны цорын
   * ганц гадаргуу болсон тул мөр бүр «энэ ямар төсөл вэ» гэдгийг өөрөө
   * хэлэх ёстой болов.  Шинэ асуулга НЭМЭЭГҮЙ — `PROJECT_LIST_SQL` аль
   * хэдийн буцаадаг, урьд нь хаядаг байсан баганууд. */
  description: string | null;
  /** 'YYYY-MM-DD HH:MM:SS' (UTC) — төсөл үүссэн огноо. */
  created_at: string | null;
  /** `project_members`-ийн тоо. */
  member_count: number;
  /** Нарийн төвөгтэй байдлын жин.  ЗӨВХӨН admin-д ирнэ — бусад дүрд
   *  сервер тал `null` буцаана (`ProjectsPage`-ийн `isAdminTier`-тэй
   *  ижил хил), тиймээс UI нь дүр шалгах шаардлагагүй. */
  complexity_pct: number | null;
  /**
   * Хоосон байж болно — хариуцагч тодорхойгүй тохиолдол бий.
   *
   * ⚠️ Баг (`teams`) ба гишүүдийн тоо (`member_count`) энд ЗОРИУДААР
   * БАЙХГҮЙ (backend-ийн гарцад ч байхгүй).  Хуваарийн хуудас нэг л
   * өнгөний хэлээр ярина — ЭРСДЭЛ.  Багийн өөрийн өнгө
   * (`shared/lib/team-colors.ts`) нь эрсдэлийн chip-тэй зэрэгцээд хоёр
   * дахь өнгөний хэл үүсгэж байсныг больсон.  Хариуцагч ХҮН л үлдэнэ —
   * сануулга тэр рүү очно.
   */
  leads: TimelineLead[];
  risk_state: RiskState;
  /** finish_date − today (хуанлийн хоног). Хуваарьгүй бол null. */
  days_left: number | null;
  /** Сүүлийн хөдөлгөөнөөс хойшх хоног. Тодорхойгүй бол null. */
  stale_days: number | null;
  /** start_date − today. Эхлэх огноогүй бол null; эхэлсэн бол <= 0. */
  days_to_start: number | null;
  /** Хугацаа хэдэн удаа сунгагдсан (migration 0337).  0 = сунгаагүй. */
  extension_count: number;
  /** Анхны дуусах хугацаа — зөвхөн сунгагдсан төсөлд; бусдад null. */
  original_finish_date: string | null;
}

export interface TimelineResponse {
  /** Серверийн `todayInUB()` — клиентийн цагийн бүсээс хамаарахгүй. */
  today: string;
  /**
   * Энэ уншигч хуваарийг ЗАСАХ эрхтэй эсэх — сервер тал шийдсэн (`admin`).
   *
   * Хуудас өөрөө дүр шалгахын оронд үүнийг дагана: бичих замууд бүгд
   * `requireAdmin()`-ээр хаалттай тул хоёр газар дүрийн жагсаалт бичвэл
   * нэг өдөр зөрж, эрхгүй хүнд ажиллахгүй товч харагдана.
   */
  can_edit: boolean;
  projects: TimelineProject[];
}

/** Тэнхлэгийн томруулалтын БЭЛЭН ЦЭГҮҮД — `ZOOM_PRESETS`-ийн түлхүүр
 *  (lib/timeScale.ts).  Бодит томруулалт нь тасралтгүй `pxPerDay` тоо тул
 *  энэ union нь зөвхөн товчлууруудын үсрэх байрлалыг нэрлэнэ. */
export type Zoom = 'day' | 'week' | 'month' | 'quarter';
