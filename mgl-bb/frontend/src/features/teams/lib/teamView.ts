import type { TeamOverview } from '@/shared/types';
import { hasDayWork, type PersonDayWork } from './currentWork';

/**
 * Багийн дэлгэрэнгүй хуудасны ЦЭВЭР (React-гүй) логик — hero, «Өнөөдөр» самбар,
 * гишүүдийн жагсаалт гурвуулаа ИЖИЛ тооллоор ажиллахын тулд нэг газар.
 *
 * Өмнө нь hero «өнөөдөр N»-ийг зөвхөн ирцийн сонголтоор, самбар нь сонголт +
 * засварын цаг + төслийн бус ажлаар тоолдог байсан тул нэг дэлгэц дээр
 * «8» ба «10/12» гэсэн ХОЁР өөр тоо гарч байв.
 */

export type TeamMember = TeamOverview['members'][number];
export type TeamProject = TeamOverview['projects'][number];
type ActiveTarget = TeamMember['active_today'][number];

/** Хоёр үсгийн товчлол — зураггүй хүний avatar-ын нөөц. */
export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

/** Явцын түвшин → семантик өнгө (`text-*` / `bg-*` хоёуланд ижил нэр). */
export type ProgressTone = 'success' | 'info' | 'primary' | 'warning' | 'muted';

export function progressTone(v: number): ProgressTone {
  if (v >= 100) return 'success';
  if (v >= 70) return 'info';
  if (v >= 40) return 'primary';
  if (v > 0) return 'warning';
  return 'muted';
}

export const TONE_TEXT: Record<ProgressTone, string> = {
  success: 'text-success',
  info: 'text-info',
  primary: 'text-primary',
  warning: 'text-warning',
  muted: 'text-muted-foreground',
};

export const TONE_BG: Record<ProgressTone, string> = {
  success: 'bg-success',
  info: 'bg-info',
  primary: 'bg-primary',
  warning: 'bg-warning',
  muted: 'bg-muted-subtle',
};

/**
 * Хүн ӨНӨӨДӨР ажиллаж байна уу — ирцээр төсөл / засварын төсөл сонгосон, эсвэл
 * засварын цаг, төслийн бус ажил бүртгэсэн.  «Чөлөөтэй» = эдгээрийн аль нь ч үгүй.
 */
export function isWorkingToday(m: TeamMember, work: PersonDayWork | undefined): boolean {
  return (m.active_today?.length ?? 0) > 0 || hasDayWork(work);
}

/** Самбарын нэг хүн — засварын цаг нь тэр lane дээр зарцуулсан цаг. */
export interface LanePerson {
  member: TeamMember;
  /** Энэ lane дээр бүртгэсэн засварын цаг (байхгүй бол undefined). */
  hours?: number;
}

export interface TodayLane {
  /** Ирцийн сонголттой ижил id: засварын төсөл = `-repair_projects.id`. */
  id: number;
  name: string;
  repair: boolean;
  people: LanePerson[];
}

export interface TodayBoardModel {
  lanes: TodayLane[];
  /** Төслийн бус ажил бүртгэсэн хүмүүс (өөрийн lane). */
  nonProject: TeamMember[];
  /** Өнөөдөр юу ч сонгоогүй / бүртгээгүй хүмүүс. */
  idle: TeamMember[];
  activeCount: number;
}

/**
 * Гишүүдийг өнөөдрийн ажлаар нь lane болгоно.  Нэг хүн хэд хэдэн lane-д гарч
 * болно (цагаа хувааж байгаа нь зөв).  Засварын цаг (ирцээр сонгоогүй ч
 * бүртгэж болно) тэр төсөл / засварын төслийн lane-д орно — эс тэгвэл 4 цаг
 * засвар хийсэн хүн «Чөлөөтэй» гэж харагдана.
 */
export function buildTodayBoard(
  members: readonly TeamMember[],
  dayWork: ReadonlyMap<number, PersonDayWork>,
): TodayBoardModel {
  const laneMap = new Map<number, TodayLane>();
  const nonProject: TeamMember[] = [];
  const idle: TeamMember[] = [];
  let activeCount = 0;

  for (const m of members) {
    const work = dayWork.get(m.id);
    const targets = new Map<number, ActiveTarget>();
    for (const p of m.active_today ?? []) targets.set(p.project_id, p);

    const hoursByLane = new Map<number, number>();
    for (const r of work?.repairHours ?? []) {
      const laneId = r.kind === 'repair' ? -r.target_id : r.target_id;
      hoursByLane.set(laneId, (hoursByLane.get(laneId) ?? 0) + r.hours);
      if (!targets.has(laneId)) {
        targets.set(laneId, { project_id: laneId, project_name: r.target_name, kind: r.kind });
      }
    }

    const hasNonProject = (work?.nonProject.length ?? 0) > 0;
    if (hasNonProject) nonProject.push(m);
    if (targets.size > 0 || hasNonProject) activeCount += 1;
    else idle.push(m);

    for (const p of targets.values()) {
      let lane = laneMap.get(p.project_id);
      if (!lane) {
        lane = { id: p.project_id, name: p.project_name, repair: p.kind === 'repair', people: [] };
        laneMap.set(p.project_id, lane);
      }
      lane.people.push({ member: m, hours: hoursByLane.get(p.project_id) });
    }
  }

  const lanes = Array.from(laneMap.values()).sort(
    (a, b) => b.people.length - a.people.length || a.name.localeCompare(b.name),
  );
  return { lanes, nonProject, idle, activeCount };
}

/** Төслийн lane-ийн тэмдэглэгээний өнгө — id-аас тогтвортой (өдрийн турш солигдохгүй). */
export function laneColor(id: number, palette: readonly string[]): string {
  return palette[Math.abs(id) % palette.length] ?? palette[0] ?? '#64748b';
}
