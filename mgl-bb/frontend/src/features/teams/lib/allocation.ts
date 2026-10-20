/**
 * «Хүн хүчний хуваарилалт» — `GET /api/teams/allocation`-ийн төрөл + хувиргалт.
 *
 * Багууд хуудас ХОЁР асуултад хариулна:
 *   1. Аль багийн хэдэн гишүүн аль төсөл дээр ажиллаж байна вэ?
 *   2. Аль төсөл дээр аль багаас хэдэн хүн ажиллаж байна вэ?
 *
 * Хоёулаа НЭГ л (баг × төсөл) нүдний жагсаалтаас гарна.  Тиймээс энд
 * хоёр тусдаа хувиргалт биш, нэг матрицыг хоёр тэнхлэгээр «уншдаг»
 * загвар байна — нийлбэрүүд нь тодорхойлолтоор зөрөх боломжгүй.
 */

import { todayUB } from '@/shared/lib/time';
import { indexDayWork, type DayWorkPayload, type PersonDayWork } from './currentWork';

/*
 * Загварын тоо нь үргэлж ИРЦ (ирц бүртгүүлэхдээ сонгосон төсөл) — «Хуваарилалт»
 * (ажлын хариуцагчаар) сэлгүүр 2026-09-24-нд хасагдаж, түүний салаанууд
 * (`AllocMetric = 'people'`) хүрэгдэхгүй болсон тул устгасан.
 */

/**
 * Ирцийн хэмжүүрийн МУЖ (2026-09-17, эзний хүсэлт: «7 хоног, сар, 3 сар,
 * 6 сар» шүүлтүүр; «1 жил» 2026-09-18-нд хасагдсан).  Сонгосон огноогоор
 * ТӨГСӨНӨ; `day` = ганц өдөр.  Хуваарилалтын хэмжүүрт нөлөөгүй (ажлын
 * хариуцагч өдрөөр өөрчлөгдөхгүй).
 *
 * ⚠️ Мужаар (`day`-аас бусад) харахад ирцийн тоо бүр ӨДРИЙН ДУНДАЖ
 * (2026-09-18, эзний хүсэлт: «7 хоног сонговол сүүлийн 7 хоногт дунджаар
 * хэдэн хүн тухайн төсөл дээр ажилласан бэ»): серверийн `active_person_days`
 * (хүн-өдөр) / `active_days` (мужид ирцийн бүртгэлтэй өдөр — амралт, баяр
 * тоологдохгүй), 1 орны бутархай.  `buildAllocationModel` нүд бүрийн
 * `active`-ийг тэр дунджаар СОЛИДОГ тул доод компонентууд `cell.active`-ийг
 * хэвээр уншина; `AllocAxisEntry.people`, `activePeople` мөн дундаж.
 * `active_user_ids` / `active_members` (нэрс, өдрийн тоо) хэвээр.
 */
export type AllocRange = 'day' | 'week' | 'month' | '3m' | '6m';
export const ALLOC_RANGES: AllocRange[] = ['day', 'week', 'month', '3m', '6m'];
export const ALLOC_RANGE_DAYS: Record<AllocRange, number> = {
  day: 1,
  week: 7,
  month: 30,
  '3m': 90,
  '6m': 180,
};

/** 1 орны бутархай дундаж — 0 хуваарьт 0. */
export const avgPerDay = (personDays: number, days: number): number =>
  days > 0 ? Math.round((personDays / days) * 10) / 10 : 0;

export interface AllocPerson {
  user_id: number;
  full_name: string;
  profile_image: string | null;
  position?: string | null;
}

export interface AllocCellMember extends AllocPerson {
  /** Тухайн төсөл дээрх энэ хүний хариуцсан ажлын тоо. */
  tasks: number;
  /** Тэдгээрээс ДУУСААГҮЙ нь.  0 бол энэ хүн энд ажиллаж дууссан. */
  open_tasks: number;
  avg_progress: number;
}

export interface AllocTeam {
  id: number;
  code: string;
  name_mn: string;
  name_en: string | null;
  sort_order: number;
  /** Идэвхтэй, ҮНДСЭН гишүүдийн тоо (`user_teams.is_primary = 1`). */
  member_count: number;
  /** Мужид энэ багийн хүн-өдөр (өдөрт давхардаагүй) — дунджийн тоологч. */
  active_person_days: number;
  /** Ямар ч төсөлд хариуцагчаар бүртгэлгүй гишүүд. */
  idle_members: AllocPerson[];
}

export interface AllocProject {
  /**
   * `projects.id` — ЭСВЭЛ, `kind === 'repair'` бол `-repair_projects.id`
   * (СӨРӨГ).  Хоёр хүснэгтийн id давхцдаг тул сервер засварын төслийг
   * сөрөг id-аар ялгаж өгдөг (routes/teams.ts allocation); ингэснээр
   * `byProjectId` гэх бүх тоон түлхүүр өөрчлөлтгүй ажиллана.
   * ⚠️ `/app/projects/:id` руу холбохдоо ЗААВАЛ `projectHref()`-ээр —
   *    сөрөг id-тай төсөл тийм хуудасгүй.
   */
  id: number;
  name: string;
  display_title: string | null;
  status: string;
  category: string | null;
  is_pending: number;
  is_asap: number;
  /** Мужид энэ төсөл дээрх хүн-өдөр — дунджийн тоологч. */
  active_person_days: number;
  /** `repair` = ирцээр сонгосон ЗАСВАРЫН төсөл (миграц 0324).  Байхгүй бол `project`. */
  kind?: 'project' | 'repair';
}

/** Засварын төсөл (`repair_projects`) мөр үү. */
export const isRepairProject = (p: Pick<AllocProject, 'kind'> | undefined): boolean =>
  p?.kind === 'repair';

/**
 * Төслийн хуудасны холбоос — засварын төсөлд `undefined` (тийм хуудас
 * байхгүй; удирдлага нь Зөвшөөрөл → Засвар).  Бүх `<Link to=…>` энд л.
 */
export function projectHref(p: Pick<AllocProject, 'id' | 'kind'> | undefined): string | undefined {
  if (!p || isRepairProject(p)) return undefined;
  return `/app/projects/${p.id}`;
}

/** Ирцийн шат — өдөрт гурав хүртэл, тус бүр өөрийн төслийн сонголттой. */
export type AllocActiveStage = 'morning' | 'afternoon' | 'clock_out';

/**
 * Нэг хүний нэг төсөл дээрх ӨДРИЙН сонголт (2026-09-17, эзний хүсэлт:
 * «хэн аль төслийг сонгосон, одоо аль дээр нь байгааг харуул»).
 * `stages` хоосон бол ирцийн өмнө л төлөвлөсөн, checkpoint-оор баталгаажаагүй.
 */
export interface AllocActiveMember {
  user_id: number;
  /** Зангуу өдөр (`to`) дээрх шатууд — мужийн бусад өдөр энд орохгүй. */
  stages: AllocActiveStage[];
  /** Мужид энэ төслийг сонгосон ӨДРИЙН тоо (ганц өдрийн мужид үргэлж 1). */
  days: number;
  /** Хамгийн сүүлд сонгосон өдөр. */
  last_date: string;
  /** Хүний СҮҮЛИЙН сонголтод энэ төсөл байна. */
  latest: boolean;
  /** Одоо (ирцээ хаагаагүй) энэ төсөл дээр сууж байна — зөвхөн өнөөдөр. */
  now: boolean;
}

export interface AllocCell {
  team_id: number;
  project_id: number;
  /**
   * ОДОО ажиллаж буй хүн = энэ төсөлд ДУУСААГҮЙ ажил хариуцсан хүн.
   *
   * ⚠️ 2026-09-03-нд утга нь өөрчлөгдсөн.  Өмнө нь «хэзээ нэгэн цагт
   * хариуцагч байсан» бүхнийг тоолдог байсан тул дуусчихсан төсөл бүтэн
   * багаараа ачаалалтай мэт харагдаж, 18 хүнтэй багийн нүднүүдийн
   * нийлбэр 52 хүрдэг байв.
   */
  people: number;
  /** Хэзээ нэгэн цагт энд ажилласан хүн (дууссаныг оруулаад). */
  ever_people: number;
  /** Тухайн өдөр ирцээрээ энэ төслийг сонгосон хүний тоо.  Мужаар бол
   *  ӨДРИЙН ДУНДАЖ (бутархай) — `buildAllocationModel` солино, дээрх тайлбар. */
  active: number;
  /** Мужид энэ нүдний хүн-өдөр (= Σ `active_members[].days`). */
  active_person_days: number;
  /** Түүний хүмүүсийн id — мөр/баганын ДАВХАРДААГҮЙ нийлбэрийг зөвхөн
   *  id-аас гаргана (нэг хүн 2 төсөл сонгосон бол нэг л удаа тоологдоно). */
  active_user_ids: number[];
  /** Ирцээр сонгосон хүн бүр — аль шатанд, сүүлийн эсэх, одоо энд эсэх. */
  active_members: AllocActiveMember[];
  tasks: number;
  done_tasks: number;
  overdue_tasks: number;
  avg_progress: number;
  members: AllocCellMember[];
}

export interface AllocationResponse {
  date: string;
  range: AllocRange;
  from: string;
  to: string;
  /** Мужид ядаж нэг ирцийн төслийн бүртгэлтэй өдрийн тоо — дунджийн хуваарь. */
  active_days: number;
  headcount: number;
  assigned_people: number;
  active_people: number;
  /** Нийт хүн-өдөр (өдөрт давхардаагүй). */
  active_person_days: number;
  teams: AllocTeam[];
  projects: AllocProject[];
  cells: AllocCell[];
  /** Зангуу өдрийн (`to`) төслийн бус ажил + засварын цаг — нэрсийн мөрийн
   *  «одоогийн ажил» (`lib/currentWork.ts`).  Нүд, донатад ОРОХГҮЙ. */
  day_work?: DayWorkPayload;
}

/* ------------------------------------------------------------------ */

/** Нэг тэнхлэгийн (баг эсвэл төсөл) нэгтгэсэн мөр. */
export interface AllocAxisEntry<T> {
  entity: T;
  /** Энэ мөр/баганын нүднүүд, тооны буурах эрэмбээр. */
  cells: AllocCell[];
  /** Давхардаагүй ХҮНий тоо.  Нүднүүдийн нийлбэр Биш — нэг хүн хоёр
   *  төсөл дээр байвал нүд тус бүрд тоологдох ч энд НЭГ удаа орно. */
  people: number;
  /** Нөгөө тэнхлэгийн тоо (баг хэдэн төсөлтэй / төсөл хэдэн багтай). */
  partners: number;
  tasks: number;
  overdue_tasks: number;
  active: number;
  avg_progress: number;
  /** Нүднүүдийн ЭНГИЙН нийлбэр (давхардалтай).  `people`-ээс их байвал
   *  зөрүү нь «хэдэн хүн олон төсөл дээр байна» гэсэн үг. */
  cellSum: number;
  /** Хоёроос дээш төсөл дээр ажиллаж буй хүний тоо. */
  multiProjectPeople: number;
}

export interface AllocationModel {
  byTeam: AllocAxisEntry<AllocTeam>[];
  byProject: AllocAxisEntry<AllocProject>[];
  headcount: number;
  assignedPeople: number;
  activePeople: number;
  idlePeople: number;
  /** Хүнтэй төслийн тоо. */
  staffedProjects: number;
  /** Мужийн төгсгөл = өнөөдөр (УБ).  «Одоо / гарсан» тэмдэг зөвхөн өнөөдөрт утгатай. */
  isToday: boolean;
  range: AllocRange;
  from: string;
  to: string;
  activeDays: number;
  /**
   * Дунджийн хуваарь: мужаар + ирцийн хэмжүүрт `max(1, activeDays)`, бусад
   * үед `null` (тоо = хүний тоо, өдрийн горим байт-ижил).
   */
  spanDays: number | null;
  /**
   * user_id → зангуу ӨДРИЙН (`to`) төслийн бус ажил + засварын цаг.  Бүх
   * мужид дүүрнэ: сервер `to` = өнөөдөр үед ямар ч мужид ирцийн `now`-г
   * тавьдаг тул «одоо» дүрэм (`showPickNow`) мужаар харахад ч хүчинтэй байх
   * ёстой.  Харин МӨРҮҮД нь зөвхөн «Өдөр» мужид (`roster.ts` `dayWorkOf`) —
   * мужаар мөрүүд дундаж/өдрийн тоо харуулдаг тул нэг өдрийн ажил тэнд утгагүй.
   */
  dayWork: Map<number, PersonDayWork>;
}

/** Мужаар ирцийн дундаж харуулж байна уу (тоонууд бутархай байж болно). */
export const isSpanAverage = (model: Pick<AllocationModel, 'spanDays'>): boolean =>
  model.spanDays != null;

function summarize<T>(
  entity: T,
  cells: AllocCell[],
  /** Мужийн дундаж: тэнхлэгийн `people` = entity-ийн хүн-өдөр / spanDays. */
  spanAvg: { spanDays: number; personDays: number } | null,
): AllocAxisEntry<T> {
  const sorted = [...cells].sort((a, b) => b.active - a.active || b.tasks - a.tasks);
  const people = new Set<number>();
  let tasks = 0;
  let overdue = 0;
  let active = 0;
  let progressWeight = 0;
  let progressSum = 0;
  for (const cell of cells) {
    // «Хүн» гэдэг нь ирцээр тэмдэглэсэн хүн (`members` — ажлын хариуцагч — биш).
    for (const id of cell.active_user_ids) people.add(id);
    tasks += cell.tasks;
    overdue += cell.overdue_tasks;
    active += cell.active;
    // Явцын дундаж нь АЖЛААР жигнэгдэнэ — 200 ажилтай төслийн 40% ба
    // 2 ажилтай төслийн 100%-ийг тэнцүү жинтэй гэж үзвэл дүр зураг худал.
    progressSum += cell.avg_progress * cell.tasks;
    progressWeight += cell.tasks;
  }
  const perPerson = new Map<number, number>();
  for (const cell of cells) {
    for (const id of cell.active_user_ids) perPerson.set(id, (perPerson.get(id) ?? 0) + 1);
  }

  return {
    entity,
    cells: sorted,
    people: spanAvg ? avgPerDay(spanAvg.personDays, spanAvg.spanDays) : people.size,
    partners: cells.filter((c) => c.active > 0).length,
    tasks,
    overdue_tasks: overdue,
    active,
    avg_progress: progressWeight > 0 ? Math.round((progressSum / progressWeight) * 10) / 10 : 0,
    cellSum: cells.reduce((sum, c) => sum + c.active, 0),
    multiProjectPeople: [...perPerson.values()].filter((n) => n > 1).length,
  };
}

export function buildAllocationModel(data: AllocationResponse | undefined): AllocationModel {
  const teams = data?.teams ?? [];
  // Засварын төсөл (0324) ирцийн хэмжүүрт өөрийн мөртэй.
  const projects = data?.projects ?? [];
  const range = data?.range ?? 'day';
  const spanDays = range !== 'day' ? Math.max(1, data?.active_days ?? 0) : null;
  // Мужаар: нүдний `active` = өдрийн дундаж (дээрх тайлбар).  Өдрийн горимд
  // серверийн мөр хэвээр.
  const cells =
    spanDays == null
      ? (data?.cells ?? [])
      : (data?.cells ?? []).map((c) => ({
          ...c,
          active: avgPerDay(c.active_person_days ?? 0, spanDays),
        }));

  const byTeamId = new Map<number, AllocCell[]>();
  const byProjectId = new Map<number, AllocCell[]>();

  const push = (map: Map<number, AllocCell[]>, key: number, cell: AllocCell) => {
    const list = map.get(key);
    if (list) list.push(cell);
    else map.set(key, [cell]);
  };

  for (const cell of cells) {
    push(byTeamId, cell.team_id, cell);
    push(byProjectId, cell.project_id, cell);
  }

  const spanOf = (personDays: number | undefined) =>
    spanDays == null ? null : { spanDays, personDays: personDays ?? 0 };
  const byTeam = teams.map((team) =>
    summarize(team, byTeamId.get(team.id) ?? [], spanOf(team.active_person_days)),
  );
  const byProject = projects.map((project) =>
    summarize(project, byProjectId.get(project.id) ?? [], spanOf(project.active_person_days)),
  );

  const assignedPeople = data?.assigned_people ?? 0;
  const activePeople =
    spanDays == null
      ? (data?.active_people ?? 0)
      : avgPerDay(data?.active_person_days ?? 0, spanDays);
  const headcount = data?.headcount ?? 0;

  return {
    byTeam,
    byProject,
    headcount,
    assignedPeople,
    activePeople,
    idlePeople: Math.max(0, headcount - assignedPeople),
    staffedProjects: byProject.filter((p) => p.people > 0).length,
    isToday: (data?.to ?? data?.date) === todayUB(),
    range,
    from: data?.from ?? data?.date ?? '',
    to: data?.to ?? data?.date ?? '',
    activeDays: data?.active_days ?? 0,
    spanDays,
    dayWork: indexDayWork(data?.day_work),
  };
}

/**
 * Шошгонд багтах богино төслийн нэр.
 *
 * Төслийн нэр бүр `MGL-<ЖЖССӨӨ>` кодоор эхэлдэг (жишээ нь
 * «MGL-260226_MITIC_AZ»).  Донат, самбарын шошгонд тэр угтвар нь мөр бүрт
 * давтагдах тул мэдээлэл ЗӨӨХГҮЙ — зөвхөн зай иднэ; шошгонд зөвхөн нэрийг
 * үлдээнэ.
 */
export function shortProjectLabel(name: string): string {
  const stripped = name.replace(/^MGL[-_]?\d{6}\s*[-_]?\s*/i, '').trim();
  return stripped || name;
}

/* ------------------------------------------------------------------ */
/* Графикийн туслахууд (2026-09-14, «график хараад л ойлгодог» хувилбар) */

/** Багийн нэг ГИШҮҮНД ногдох дуусаагүй ажил — ачааллын жинхэнэ дохио.
 *  `people = 0` бол `null` (ажил хуваарилдаггүй баг: MGMT, IZ). */
export function openTasksPerPerson<T>(row: AllocAxisEntry<T>): number | null {
  if (row.people <= 0) return null;
  const open = row.cells.reduce((s, c) => s + Math.max(0, c.tasks - c.done_tasks), 0);
  return Math.round((open / row.people) * 10) / 10;
}

/** Тэнхлэгийн мөрийн дуусаагүй ажлын тоо. */
export function openTasksOf<T>(row: AllocAxisEntry<T>): number {
  return row.cells.reduce((s, c) => s + Math.max(0, c.tasks - c.done_tasks), 0);
}

/**
 * Төслийн өнгө — хүний тоогоор эрэмбэлсэн ТОГТВОРТОЙ хуваарилалт.
 * Нэг төсөл бүх таб дээр ижил өнгөтэй байх ёстой; топ N-ээс хойшхи нь
 * саарал («Бусад»).  `projectColors.ts`-ийн ирцийн хувилбартай ижил зарчим,
 * гэхдээ хуваарилалтын өгөгдөл дээр.
 */
export function buildProjectPalette(
  model: AllocationModel,
  palette: readonly string[],
  othersColor: string,
): (projectId: number) => string {
  const ranked = [...model.byProject]
    .filter((p) => p.people > 0)
    .sort((a, b) => b.people - a.people || a.entity.name.localeCompare(b.entity.name));
  const map = new Map<number, string>();
  ranked.forEach((p, i) => map.set(p.entity.id, palette[i] ?? othersColor));
  return (id) => map.get(id) ?? othersColor;
}

/* ------------------------------------------------------------------ */
/* «Хүн бүр ЯГ НЭГ удаа» — донатын тоолох дүрэм (2026-09-14, эзний гомдол) */

/**
 * Хүн бүрийн ҮНДСЭН төсөл.
 *
 * Эзний гомдол: «BA 18 хүнтэй байхад бусад гэдэгт 19 хүн», «Бусад маш их»,
 * «менежментийн хүмүүс харагдахгүй».  Шалтгаан нь нэг: донат (хүн × төсөл)
 * хослолыг тоолж байсан тул 3 төсөл дээрх хүн 3 удаа орж, зүсмүүдийн
 * нийлбэр голын тооноос давж байв.  Одоо ХҮН БҮР ЯГ НЭГ зүсэмд орно —
 * ирцээр сонгосон төслөөрөө (одоо → олон өдөр → сүүлийн сонголт).  Тэнцвэл
 * хүн ихтэй төсөл, дараа нь бага id.
 *
 * Буцаах утга: user_id → project_id.  Ямар ч төсөлгүй хүн орохгүй.
 */
export function buildPrimaryProjectMap(model: AllocationModel): Map<number, number> {
  const best = new Map<number, { projectId: number; score: number; people: number }>();
  const consider = (userId: number, projectId: number, score: number, people: number) => {
    const cur = best.get(userId);
    if (
      !cur ||
      score > cur.score ||
      (score === cur.score && (people > cur.people || (people === cur.people && projectId < cur.projectId)))
    ) {
      best.set(userId, { projectId, score, people });
    }
  };
  for (const row of model.byTeam) {
    for (const cell of row.cells) {
      // «Үндсэн» = ОДОО сууж буй төсөл, үгүй бол мужид ХАМГИЙН ОЛОН өдөр
      // сонгосон нь (тэнцвэл сүүлийн сонголт).  Ганц өдрийн мужид days = 1
      // тул: одоо → сүүлийн → өдрийн өмнөх сонголт.
      for (const m of cell.active_members) {
        const score = (m.now ? 1_000_000 : 0) + m.days * 10 + (m.latest ? 1 : 0);
        consider(m.user_id, cell.project_id, score, cell.active);
      }
    }
  }
  const out = new Map<number, number>();
  for (const [id, b] of best) out.set(id, b.projectId);
  return out;
}

export interface PrimarySplit {
  /** project_id → энэ төслийг ҮНДСЭН болгосон хүний тоо. */
  byProject: Map<number, number>;
  /** Ядаж нэг төсөлтэй хүн (давхардаагүй). */
  assigned: number;
  /** Хоёроос дээш төсөл дээр зэрэг байгаа хүн — зөвхөн тайлбарт. */
  multi: number;
}

/**
 * Нэг багийн гишүүдийг үндсэн төслөөр нь хуваана.  `byProject`-ийн нийлбэр
 * = `assigned`; `member_count − assigned` = төсөлгүй.  Ингэснээр донатын
 * зүсмүүд + саарал «төсөлгүй» зүсэм ЯГ багийн гишүүдийн тоо болно.
 */
export function splitTeamByPrimary(
  row: AllocAxisEntry<AllocTeam>,
  primary: Map<number, number>,
  /** Мужийн дундаж горим (`model.spanDays`): зүсэм = төслийн өдрийн дундаж хүн. */
  spanDays: number | null = null,
): PrimarySplit {
  const byProject = new Map<number, number>();
  const seen = new Set<number>();
  const projectsOf = new Map<number, number>();
  if (spanDays != null) {
    // Мужаар «үндсэн төсөл» гэсэн ойлголт утгагүй — хүн бүр өдөр бүр өөр
    // төсөл сонгож болно.  Зүсэм = тэр төслийн өдрийн дундаж хүн
    // (`cell.active`, аль хэдийн дундаж); `assigned` = багийн өдрийн дундаж
    // (өдөрт давхардаагүй, `row.people`).  Зүсмүүдийн нийлбэр `assigned`-аас
    // их байвал зарим хүн нэг өдөрт хоёр төсөл сонгосон гэсэн үг.
    for (const cell of row.cells) {
      if (cell.active > 0) byProject.set(cell.project_id, cell.active);
      for (const id of cell.active_user_ids) projectsOf.set(id, (projectsOf.get(id) ?? 0) + 1);
    }
    return {
      byProject,
      assigned: row.people,
      multi: [...projectsOf.values()].filter((n) => n > 1).length,
    };
  }
  for (const cell of row.cells) {
    for (const id of cell.active_user_ids) {
      projectsOf.set(id, (projectsOf.get(id) ?? 0) + 1);
      if (seen.has(id)) continue;
      const p = primary.get(id);
      if (p == null) continue;
      seen.add(id);
      byProject.set(p, (byProject.get(p) ?? 0) + 1);
    }
  }
  return {
    byProject,
    assigned: seen.size,
    multi: [...projectsOf.values()].filter((n) => n > 1).length,
  };
}

/**
 * Компани даяар: төсөл бүрийг үндсэн төслөө болгосон хүний тоо.  Мужийн
 * дундаж горимд (`model.spanDays`) төсөл бүрийн өдрийн дундаж хүн
 * (`byProject[].people`).
 */
export function splitCompanyByPrimary(
  primary: Map<number, number>,
  model?: Pick<AllocationModel, 'spanDays' | 'byProject'>,
): Map<number, number> {
  const byProject = new Map<number, number>();
  if (model && isSpanAverage(model)) {
    for (const row of model.byProject) if (row.people > 0) byProject.set(row.entity.id, row.people);
    return byProject;
  }
  for (const p of primary.values()) byProject.set(p, (byProject.get(p) ?? 0) + 1);
  return byProject;
}

/* ------------------------------------------------------------------ */
/* Менежмент нь «хүн хүч» БИШ (2026-09-14, эзний шийдвэр) */

/**
 * Төсөл дээр ажил хуваарилагддаггүй багууд.  «Нийт ажилтан» тоолуур,
 * «төсөлгүй» анхааруулга эдгээрийг ОРУУЛАХГҮЙ — эзэн «менежментийн 7 хүнийг
 * нийт ажилтнаас хас» гэж шийдсэн: тэд төсөлгүй байх нь хэвийн, тиймээс
 * «төсөлгүй 9» гэсэн улбар шар тоо худал дохио өгч байв.  Багийн донат
 * (Хүн хүч багаар) тэднийг ХЭВЭЭР харуулна — тэр нь бүтэц, ачаалал биш.
 */
export const NON_WORKFORCE_TEAM_CODES: ReadonlySet<string> = new Set(['MGMT']);

export const isWorkforceTeam = (code: string): boolean =>
  !NON_WORKFORCE_TEAM_CODES.has(code.toUpperCase());

export interface WorkforceSummary {
  /** Менежментээс бусад багийн идэвхтэй гишүүд. */
  headcount: number;
  /** Тэднээс ядаж нэг төсөлтэй нь (идэвхтэй хэмжүүрээр). */
  assigned: number;
  idle: number;
  /** Багаар задалсан төсөлгүй хүн — зөвхөн хүн хүчний багууд. */
  idleByTeam: Array<{ code: string; idle: number }>;
  /** Тусад нь тоологдсон менежмент. */
  management: { members: number; assigned: number };
}

export function summarizeWorkforce(model: AllocationModel): WorkforceSummary {
  let headcount = 0;
  let assigned = 0;
  const mgmt = { members: 0, assigned: 0 };
  const idleByTeam: Array<{ code: string; idle: number }> = [];
  for (const row of model.byTeam) {
    const members = row.entity.member_count;
    const withProject = Math.min(members, row.people);
    if (!isWorkforceTeam(row.entity.code)) {
      mgmt.members += members;
      mgmt.assigned += withProject;
      continue;
    }
    headcount += members;
    assigned += withProject;
    if (members - withProject > 0) idleByTeam.push({ code: row.entity.code, idle: members - withProject });
  }
  idleByTeam.sort((a, b) => b.idle - a.idle);
  return { headcount, assigned, idle: headcount - assigned, idleByTeam, management: mgmt };
}
