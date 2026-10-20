import { formatDisplayName } from '@/shared/lib/formatting';
import type { AttendanceSession } from '@/shared/types';
import type { TFn } from '@/features/attendance/admin/constants';
import { todayInUB } from '@/features/attendance/admin/utils/dates';
import { formatTime } from '@/features/attendance/admin/utils/format';

/* =============================================================================
 *  «Хаагдаагүй бүртгэл» — ГУРВАН гаралтын ЦОРЫН ГАНЦ мөр бэлтгэгч.
 * -----------------------------------------------------------------------------
 *  Дэлгэцийн Excel-маягийн хүснэгт (`OpenSessionsTable`), хэвлэх цонх
 *  (`printOpenSessions`) ба .xlsx (`exportOpenSessionsXlsx`) ГУРВУУЛАА
 *  ЭНЭ функцээс мөрөө авна.  Гурвыг тус тусад нь бөглөвөл «дэлгэц дээр нэг
 *  тоо, цаасан дээр өөр тоо» болох нь цаг хугацааны асуудал — тиймээс
 *  форматлалт (нэрийн эрэмбэ, цаг, хоногийн зөрүү) энд НЭГ УДАА хийгдэнэ.
 * ===========================================================================*/

export interface OpenSessionRow {
  /** `attendance_sessions.id` — жагсаалтын сонголт/үйлдэлтэй холбогдоно. */
  id: number;
  /** Хүснэгтийн мөрийн дугаар (1-ээс). */
  nu: number;
  /** `yyyy-mm-dd` — ирсэн өдөр. */
  date: string;
  /** «Нэр Овог» дараалалд (`formatDisplayName`). */
  name: string;
  /** Ажилтны НУ дугаар.  Байхгүй бол хоосон мөр. */
  employeeId: string;
  /** `HH:mm` — ирсэн цаг (UB). */
  clockIn: string;
  /** Хоцорсон минут (0 = цагтаа). */
  lateMinutes: number;
  /** Тухайн өдрөөс хойш өнөөдрийг хүртэл хэдэн хоног хаагдаагүй байгаа. */
  daysOpen: number;
  /** Ажилтны/админы тэмдэглэл. */
  note: string;
  /** Ажилтны ҮНДСЭН багийн код (`BA`, `BB`…).  Баггүй бол хоосон мөр. */
  teamCode: string;
  /** Тухайн багийн монгол нэр.  Баггүй бол хоосон мөр. */
  teamName: string;
}

/** `yyyy-mm-dd` хоёрын хоногийн зөрүү.  Хоёуланг нь UTC-ийн шөнө дунд гэж
 *  уншсанаар зуны цагийн шилжилт нөлөөлөхгүй (D1 нь ISO огноо хадгалдаг). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Хаагдаагүй session-уудыг хүснэгтийн мөр болгоно.  Дараалал нь орж ирсэн
 *  массивынхаа дарааллыг хадгална (backend: `date DESC, clock_in ASC`). */
export function buildOpenSessionRows(sessions: AttendanceSession[]): OpenSessionRow[] {
  const today = todayInUB();
  return sessions.map((s, idx) => ({
    id: s.id,
    nu: idx + 1,
    date: s.date,
    name: formatDisplayName(s.full_name ?? ''),
    employeeId: s.employee_id ?? '',
    clockIn: formatTime(s.clock_in),
    lateMinutes: s.late_minutes ?? 0,
    daysOpen: daysBetween(s.date, today),
    note: s.notes ?? '',
    teamCode: s.team_code ?? '',
    teamName: s.team_name ?? '',
  }));
}

/** Баримтын толгойд гарах хугацааны шошго — «2026-08-01 → 2026-08-25»,
 *  зөвхөн нэг тал нь бөглөгдсөн, эсвэл огт шүүгээгүй тохиолдлыг хамарна. */
export function openRangeLabel(from: string, to: string, t: TFn): string {
  if (from && to) return `${from} → ${to}`;
  if (from) return `${from} →`;
  if (to) return `→ ${to}`;
  return t('attendanceAdminPage.openFilterAllDates');
}

/** Татаж авах файлын нэрэнд орох огнооны хэсэг. */
export function openFileStamp(from: string, to: string): string {
  if (from && to) return `${from}_${to}`;
  if (from) return `from_${from}`;
  if (to) return `to_${to}`;
  return todayInUB();
}

/* =============================================================================
 *  БАГААР ШҮҮХ
 * -----------------------------------------------------------------------------
 *  Зорилго нь «БҮ багийн сениорт өгөх баримт» гаргах: тухайн багийн бүх
 *  хаагдаагүй цагийг НЭГ хуудсанд.  Тиймээс бүлгүүд нь ДАВХЦАХГҮЙ байх
 *  ёстой — хүн бүр яг нэг багт тоологдоно (backend нь `is_primary` багийг
 *  буцаадаг; яагаад гэдгийг `routes/attendance.ts`-ийн тайлбараас үзнэ үү).
 * ===========================================================================*/

/** «Баг тодорхойлогдоогүй» бүлгийн онцгой код.  `teams.code` нь хэзээ ч
 *  ийм утгатай байхгүй тул жинхэнэ багтай мөргөлдөхгүй. */
export const NO_TEAM = '__none__';

/** Багийн шүүлтийн нэг сонголт. */
export interface OpenTeamFacet {
  /** `teams.code` эсвэл [[NO_TEAM]]. */
  code: string;
  /** Товчлол (chip дээр гарах) — `NO_TEAM` үед орчуулагдсан шошго. */
  label: string;
  /** Бүтэн нэр (tooltip, хэвлэсэн баримтын толгой). */
  name: string;
  /** Тухайн багт ногдох хаагдаагүй бүртгэлийн тоо. */
  count: number;
}

/** Мөр нь сонгосон багт хамаарах эсэх.  `team` хоосон бол шүүлтгүй. */
export function sessionMatchesTeam(s: AttendanceSession, team: string): boolean {
  if (!team) return true;
  if (team === NO_TEAM) return !s.team_code;
  return s.team_code === team;
}

/**
 * Багийн сонголтуудыг АЧААЛСАН мөрүүдээс шууд тоолж гаргана.
 *
 * ⚠️ Тоог сервер талаас тусад нь авчирдаггүй нь ЗОРИУД: chip дээрх тоо
 * нь «энэ багийг дарвал хэдэн мөр үлдэх вэ» гэдгийг ЯГ хэлэх ёстой.
 * Тусдаа тоолсон бол хязгаараас (`limit`) болж жагсаалттай зөрөх байв.
 *
 * Эрэмбэ нь `teams.sort_order` — компанийн өөрийн дараалал (БА, БҮ, ХАС…).
 * Цагаан толгойгоор эрэмбэлбэл энэ дараалал алдагдана.
 */
export function buildTeamFacets(sessions: AttendanceSession[], t: TFn): OpenTeamFacet[] {
  const map = new Map<string, OpenTeamFacet & { sort: number }>();
  for (const s of sessions) {
    const code = s.team_code || NO_TEAM;
    const found = map.get(code);
    if (found) {
      found.count += 1;
      continue;
    }
    const isNone = code === NO_TEAM;
    map.set(code, {
      code,
      label: isNone ? t('attendanceAdminPage.openTeamNone') : code,
      name: isNone ? t('attendanceAdminPage.openTeamNone') : (s.team_name ?? code),
      count: 1,
      // Баггүй мөрүүд ҮРГЭЛЖ хамгийн сүүлд.
      sort: isNone ? Number.MAX_SAFE_INTEGER : (s.team_sort ?? 0),
    });
  }
  return [...map.values()]
    .sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code))
    .map((f) => ({ code: f.code, label: f.label, name: f.name, count: f.count }));
}

/** Хэвлэсэн баримт / Excel-ийн толгойд гарах багийн шошго.
 *  Шүүлтгүй үед `null` — дуудагч тал мөрийг нь огт гаргахгүй. */
export function openTeamLabel(team: string, facets: OpenTeamFacet[]): string | null {
  if (!team) return null;
  const f = facets.find((x) => x.code === team);
  if (!f) return team;
  // Гарчигт «… — BB — Барилга бүтээц» гэж хоёр зураас давхцахгүйн тулд
  // хаалт хэрэглэнэ.
  return f.code === NO_TEAM ? f.name : `${f.code} (${f.name})`;
}
