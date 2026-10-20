import type { TFn } from '@/features/attendance/admin/constants';

/* =============================================================================
 *  Багаар шүүх — ирцийн самбарын БҮХ табын НЭГ ЛОГИК.
 * -----------------------------------------------------------------------------
 *  Анх «Хаагдаагүй бүртгэл» таб дээр гарч ирсэн: админ 436 мөрийг нэг дор
 *  харах нь хэрэггүй, тэр эдгээрийг БАГААР нь салгаж тухайн багийн сениорт
 *  «эдгээр нь таны багийнхны хаагдаагүй цаг» гэж өгдөг.  «Тайлан» таб яг
 *  ижил хэрэглээтэй (нэг багийн цагийн хүснэгтийг хэвлэх/экспортлох) тул
 *  хоёр таб НЭГ энэ файлаас шүүлтээ авна — үгүй бол хоёр таб дээрх ижил
 *  харагдацтай chip-үүд өөр өөрөөр аашилж эхэлнэ.
 *
 *  ⚠️ Сонголт нь ОЛОН БАГ (`string[]`).  Хоосон массив = «Бүгд» — тусдаа
 *  «all» тугийг хадгалахгүй, учир нь хоёр эх сурвалж (жагсаалт + туг) хоорондоо
 *  зөрөх боломж үүсгэдэг.  Chip дээр дахин дарвал ТУХАЙН баг л сонголтоос
 *  хасагдана (`toggleTeam`) — «Бүгд» рүү заваарах шаардлагагүй.
 * ===========================================================================*/

/** «Баг тодорхойлогдоогүй» бүлгийн онцгой код.  `teams.code` нь хэзээ ч
 *  ийм утгатай байхгүй тул жинхэнэ багтай мөргөлдөхгүй. */
export const NO_TEAM = '__none__';

/** Багийн шүүлтийн нэг сонголт (chip). */
export interface TeamFacet {
  /** `teams.code` эсвэл [[NO_TEAM]]. */
  code: string;
  /** Товчлол (chip дээр гарах) — `NO_TEAM` үед орчуулагдсан шошго. */
  label: string;
  /** Бүтэн нэр (tooltip, хэвлэсэн баримтын толгой). */
  name: string;
  /** Тухайн багт ногдох тоо.  Юуны тоо болох нь дуудагчаас хамаарна —
   *  «Хаагдаагүй» дээр БҮРТГЭЛ, «Тайлан» дээр АЖИЛТАН (`distinctBy`). */
  count: number;
}

/** Багаар бүлэглэгдэх чадвартай мөрийн ХАМГИЙН БАГА хэлбэр.  `AttendanceSession`
 *  ба `DailyAttendanceRow` хоёул үүнд тохирно. */
export interface TeamTaggedRow {
  team_code?: string | null;
  team_name?: string | null;
  /** `teams.sort_order`.  Байхгүй бол код руугаа буцаж эрэмбэлнэ. */
  team_sort?: number | null;
}

/**
 * Багийн сонголтуудыг АЧААЛСАН мөрүүдээс шууд тоолж гаргана.
 *
 * ⚠️ Тоог сервер талаас тусад нь авчирдаггүй нь ЗОРИУД: chip дээрх тоо
 * нь «энэ багийг дарвал хэдэн мөр үлдэх вэ» гэдгийг ЯГ хэлэх ёстой.
 * Тусдаа тоолсон бол хязгаараас (`limit`) болж жагсаалттай зөрөх байв.
 *
 * ⚠️ Мөн БАГИЙН ШҮҮЛТЭЭС ҮЛ ХАМААРЧ бүх ачаалсан мөрөөс тоологдоно — chip
 * дээрх тоо нь «нөгөө багийг дарвал хэд болох вэ» гэдгийг харуулах ёстой,
 * тэгэхгүй бол сонгомогц бусад нь 0 болно.
 *
 * `distinctBy` өгвөл тухайн түлхүүрээр ДАВХАРДАЛГҮЙ тоолно — «Тайлан» табын
 * grid нь «ажилтан × өдөр» мөртэй тул `r => r.user_id` дамжуулснаар chip нь
 * 21 хоногийн мөрийн тоо биш, АЖИЛТНЫ тоог харуулна.
 *
 * Эрэмбэ нь `teams.sort_order` — компанийн өөрийн дараалал (БА, БҮ, ХАС…).
 * Цагаан толгойгоор эрэмбэлбэл энэ дараалал алдагдана.
 */
export function buildTeamFacets<T extends TeamTaggedRow>(
  rows: readonly T[],
  t: TFn,
  distinctBy?: (row: T) => string | number,
): TeamFacet[] {
  const map = new Map<string, TeamFacet & { sort: number; seen?: Set<string | number> }>();
  for (const r of rows) {
    const code = r.team_code || NO_TEAM;
    let found = map.get(code);
    if (!found) {
      const isNone = code === NO_TEAM;
      found = {
        code,
        label: isNone ? t('attendanceAdminPage.openTeamNone') : code,
        name: isNone ? t('attendanceAdminPage.openTeamNone') : (r.team_name ?? code),
        count: 0,
        // Баггүй мөрүүд ҮРГЭЛЖ хамгийн сүүлд.
        sort: isNone ? Number.MAX_SAFE_INTEGER : (r.team_sort ?? 0),
        seen: distinctBy ? new Set<string | number>() : undefined,
      };
      map.set(code, found);
    }
    if (found.seen) {
      const key = distinctBy!(r);
      if (found.seen.has(key)) continue;
      found.seen.add(key);
    }
    found.count += 1;
  }
  return [...map.values()]
    .sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code))
    .map((f) => ({ code: f.code, label: f.label, name: f.name, count: f.count }));
}

/** Мөр нь сонгосон багуудын аль нэгэнд хамаарах эсэх.
 *  Сонголт хоосон бол шүүлтгүй (=бүгд). */
export function matchesTeams(
  teamCode: string | null | undefined,
  selected: readonly string[],
): boolean {
  if (selected.length === 0) return true;
  return selected.includes(teamCode || NO_TEAM);
}

/** Chip дээр дарахад — сонгогдсон байсан бол ХАСНА, үгүй бол НЭМНЭ.
 *  Дараалал нь `facets`-ийн дараалал биш, дарсан дараалал — шошго/файлын
 *  нэрийг тогтвортой байлгахын тулд дуудагч тал `facets`-ээр эрэмбэлнэ
 *  ([[orderTeams]]). */
export function toggleTeam(selected: readonly string[], code: string): string[] {
  return selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code];
}

/** Сонголтыг chip-ийн (компанийн) дараалалд оруулна — дарсан дараалал нь
 *  хэвлэсэн баримтын шошгонд гарах ёсгүй. */
export function orderTeams(selected: readonly string[], facets: readonly TeamFacet[]): string[] {
  const rank = new Map(facets.map((f, i) => [f.code, i]));
  return [...selected].sort(
    (a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Ачаалсан өгөгдөлд байхгүй болсон багийн кодуудыг сонголтоос хасна.
 *  (Жнь сүүлчийн хаагдаагүй бүртгэл хаагдсан, эсвэл огнооны муж солигдсон.)
 *  Юу ч хасагдаагүй бол ЯГ ТЭР массивыг буцаана — `useEffect` дотор
 *  дуудагдах тул шинэ reference буцаавал төгсгөлгүй давталт үүсгэнэ. */
export function pruneTeams(selected: readonly string[], facets: readonly TeamFacet[]): string[] {
  if (selected.length === 0 || facets.length === 0) return selected as string[];
  const live = new Set(facets.map((f) => f.code));
  const next = selected.filter((c) => live.has(c));
  return next.length === selected.length ? (selected as string[]) : next;
}

/** Хэвлэсэн баримт / Excel-ийн толгойд гарах багийн шошго.
 *  Шүүлтгүй үед `null` — дуудагч тал мөрийг нь огт гаргахгүй. */
export function teamSelectionLabel(
  selected: readonly string[],
  facets: readonly TeamFacet[],
): string | null {
  if (selected.length === 0) return null;
  const ordered = orderTeams(selected, facets);
  // Нэг баг — бүтэн нэртэйгээ.  Гарчигт «… — BB — Барилга бүтээц» гэж хоёр
  // зураас давхцахгүйн тулд хаалт хэрэглэнэ.
  if (ordered.length === 1) {
    const only = ordered[0]!;
    const f = facets.find((x) => x.code === only);
    if (!f) return only;
    return f.code === NO_TEAM ? f.name : `${f.code} (${f.name})`;
  }
  // Олон баг — бүтэн нэр нь хэт урт болно, тиймээс зөвхөн товчлол.
  return ordered.map((c) => facets.find((x) => x.code === c)?.label ?? c).join(', ');
}

/** Татаж авах файлын нэрэнд орох багийн хэсэг (`…_BA-BB.xlsx`).
 *  Шүүлтгүй үед хоосон мөр. */
export function teamSelectionStamp(
  selected: readonly string[],
  facets: readonly TeamFacet[],
): string {
  if (selected.length === 0) return '';
  return orderTeams(selected, facets)
    .map((c) => (c === NO_TEAM ? 'noteam' : c.replace(/[^A-Za-z0-9]/g, '')))
    .filter(Boolean)
    .join('-');
}
