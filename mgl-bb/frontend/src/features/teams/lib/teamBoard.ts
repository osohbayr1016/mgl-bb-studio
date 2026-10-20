import type { PersonDayWork } from './currentWork';
import {
  buildTodayBoard,
  isWorkingToday,
  type LanePerson,
  type TeamMember,
  type TeamProject,
} from './teamView';

/**
 * Багийн дэлгэрэнгүй хуудасны «нэг дэлгэцийн самбар»-ын ЦЭВЭР (React-гүй) загвар.
 *
 * Асуулт ГУРАВ, бүгд нэг дэлгэц дээр:
 *   1. Аль төсөл дээр өнөөдөр хэн ажиллаж байна вэ?      → `active` / `nonProject`
 *   2. Багийн бусад төсөл юу болж байна вэ?              → `quiet` (хүнгүй ч мөр нь харагдана)
 *   3. Гишүүн бүр өнөөдөр ажиллаж байна уу, хаана?        → `roster`
 *
 * Тоолол нь `buildTodayBoard` (hero-той ижил эх сурвалж) — өмнө нь толгойд «8»,
 * самбарт «10/12» гэж зөрдөг байсан тул шинэ тооллого ЗҮГЭЭР дахин бичигдэхгүй.
 */

export type BoardRowKind = 'project' | 'repair' | 'nonProject' | 'quiet';

export interface BoardRow {
  /** Тогтвортой түлхүүр: `p:12` төсөл, `r:3` засварын төсөл, `np` төслийн бус ажил. */
  key: string;
  kind: BoardRowKind;
  /** Ирцийн сонголттой ижил id: засварын төсөл = `-repair_projects.id`, төслийн бус = 0. */
  id: number;
  name: string;
  /** Багийн төсөл бол түүний тоо баримт (явц, ажил, хоцролт); өөр багийн / засварын төсөл бол null. */
  project: TeamProject | null;
  /** Өнөөдөр энэ мөрөнд ажиллаж буй хүмүүс (`quiet` мөрөнд хоосон). */
  people: LanePerson[];
}

export interface RosterEntry {
  member: TeamMember;
  /** Өнөөдөр төсөл / засвар / төслийн бус ажлын аль нэгэнд бүртгэлтэй. */
  working: boolean;
  /** Хүн орсон мөрүүдийн `BoardRow.key` — самбар ↔ жагсаалт хоорондын онцлолт. */
  rowKeys: string[];
}

export interface TeamBoardModel {
  /** Өнөөдөр хүнтэй төсөл / засварын төсөл — хүний тоогоор буурахаар. */
  active: BoardRow[];
  /** Төслийн бус ажил бүртгэсэн хүмүүсийн нэг мөр (байхгүй бол null). */
  nonProject: BoardRow | null;
  /** Идэвхтэй ч өнөөдөр хэн ч ажиллаагүй төслүүд — хоцролт ихтэй нь эхэнд. */
  quiet: BoardRow[];
  /** Архивласан төслүүд (backend зөвхөн админд буцаана). */
  archived: BoardRow[];
  /** Өнөөдөр ажиллаж буй гишүүдийн тоо — hero-той ижил. */
  activeCount: number;
  roster: RosterEntry[];
}

const byName = (a: string, b: string) => a.localeCompare(b, 'mn');

/** `formatDisplayName`-ыг импортлохгүй (browser-ийн `brand()` дуудахгүйн тулд) — эрэмбэд түүхий нэр хангалттай. */
const memberName = (m: TeamMember) => m.full_name ?? '';

export function buildTeamBoard(
  members: readonly TeamMember[],
  projects: readonly TeamProject[],
  dayWork: ReadonlyMap<number, PersonDayWork>,
): TeamBoardModel {
  const board = buildTodayBoard(members, dayWork);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const active: BoardRow[] = board.lanes.map((lane) => ({
    key: `${lane.repair ? 'r' : 'p'}:${Math.abs(lane.id)}`,
    kind: lane.repair ? 'repair' : 'project',
    id: lane.id,
    name: lane.name,
    project: lane.repair ? null : (projectById.get(lane.id) ?? null),
    people: lane.people,
  }));

  const nonProject: BoardRow | null =
    board.nonProject.length > 0
      ? {
          key: 'np',
          kind: 'nonProject',
          id: 0,
          name: '',
          project: null,
          people: board.nonProject.map((member) => ({ member })),
        }
      : null;

  // Хүнтэй мөр болсон төслүүдийг «хөдөлгөөнгүй» жагсаалтаас хасна.
  const shown = new Set(board.lanes.filter((l) => !l.repair).map((l) => l.id));
  const rest = projects.filter((p) => !shown.has(p.id));
  const toRow = (p: TeamProject): BoardRow => ({
    key: `p:${p.id}`,
    kind: 'quiet',
    id: p.id,
    name: p.name,
    project: p,
    people: [],
  });
  const quiet = rest
    .filter((p) => p.status !== 'archived')
    .sort((a, b) => (b.overdue_count ?? 0) - (a.overdue_count ?? 0) || byName(a.name, b.name))
    .map(toRow);
  const archived = rest
    .filter((p) => p.status === 'archived')
    .sort((a, b) => byName(a.name, b.name))
    .map(toRow);

  const keysByMember = new Map<number, string[]>();
  for (const row of nonProject ? [...active, nonProject] : active) {
    for (const person of row.people) {
      const list = keysByMember.get(person.member.id);
      if (list) list.push(row.key);
      else keysByMember.set(person.member.id, [row.key]);
    }
  }

  const roster: RosterEntry[] = members
    .map((member) => ({
      member,
      working: isWorkingToday(member, dayWork.get(member.id)),
      rowKeys: keysByMember.get(member.id) ?? [],
    }))
    // Ажиллаж буй нь эхэнд, дараа нь нэрээр — «хэн чөлөөтэй» доороос нэг дор харагдана.
    .sort(
      (a, b) =>
        Number(b.working) - Number(a.working) || byName(memberName(a.member), memberName(b.member)),
    );

  return { active, nonProject, quiet, archived, activeCount: board.activeCount, roster };
}

/** Төслийн мөрийн ойрын хугацааны байдал — `next_due` (YYYY-MM-DD) → өнөөдрөөс хэдэн хоног. */
export function daysUntil(dateStr: string | null | undefined, today: Date = new Date()): number | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return null;
  const due = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due - now) / 86_400_000);
}
