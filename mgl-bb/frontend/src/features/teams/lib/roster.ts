import { teamHex } from '@/shared/lib/team-colors';
import type {
  AllocActiveMember,
  AllocAxisEntry,
  AllocCell,
  AllocPerson,
  AllocProject,
  AllocTeam,
  AllocationModel,
} from './allocation';
import { isRepairProject, shortProjectLabel } from './allocation';
import { hasDayWork, mergePickedRepairHours, showPickNow, type PersonDayWork } from './currentWork';
import type { RosterGroup, RosterPerson, RosterProjectLabel } from './donut';

/**
 * Донатын зүсмийн НЭРСИЙН жагсаалт (2026-09-15).
 *
 * Эзний хүсэлт: «баг эсвэл төсөл дээр хулганаа аваачихад тэнд ажиллаж буй
 * БҮХ ажилтны нэр графикт харагддаг байх — хэнийг аль төслөөс аль төсөл рүү
 * шилжүүлэхээ шууд хэлж чаддаг байх».  Тиймээс нэр бүрийн хажууд «бас хэдэн
 * төсөл дээр байна», «үндсэн төсөл нь өөр» гэсэн тайлбар явна — хүнтэй
 * холбогдох ямар ч товч БАЙХГҮЙ (эзэн өөрөө ярина).
 *
 * Бүх функц `AllocationModel`-оос цэвэр уншина — донатын тоолох дүрэмтэй
 * («хүн бүр ЯГ НЭГ удаа, үндсэн төслөөрөө») нэг эх сурвалж тул нэрсийн
 * тоо зүсмийн тоотой зөрөхгүй.
 */

export interface RosterLabels {
  /** «Төсөлгүй» бүлгийн нэр. */
  idle: string;
  /** «бас: A, B» — энэ хүн бас өөр төслүүд дээр (нэрээр нь, тоогоор БИШ). */
  alsoOn: (projects: string[]) => string;
  /** «өмнө нь: A, B» — өдрийн ӨМНӨХ шатанд сонгосон, одоо биш төслүүд. */
  earlierOn: (projects: string[]) => string;
  /** «12 өдөр» — мужаар харахад төсөл дээр суусан өдрийн тоо. */
  dayCount: (count: number) => string;
  /** «2 цаг 30 мин» — сонголтын шошгон дээрх засварын цаг (`mergePickedRepairHours`). */
  duration: (hours: number) => string;
}

/** Нүдэнд ОДОО ажиллаж буй (ирцээр сонгосон) хүмүүсийн id. */
export function workingIds(cell: AllocCell): number[] {
  return cell.active_user_ids;
}

/** user_id → хүн.  Нүднүүдийн гишүүд + багуудын төсөлгүй гишүүдээс. */
export function buildPeopleIndex(model: AllocationModel): Map<number, AllocPerson> {
  const index = new Map<number, AllocPerson>();
  for (const row of model.byTeam) {
    for (const p of row.entity.idle_members) index.set(p.user_id, p);
    for (const cell of row.cells) for (const m of cell.members) index.set(m.user_id, m);
  }
  return index;
}

/** user_id → project_id → ирцийн сонголт (зөвхөн ирцийн хэмжүүрт хэрэгтэй). */
export function buildActiveIndex(
  model: AllocationModel,
): Map<number, Map<number, AllocActiveMember>> {
  const index = new Map<number, Map<number, AllocActiveMember>>();
  for (const row of model.byTeam) {
    for (const cell of row.cells) {
      for (const m of cell.active_members) {
        let byProject = index.get(m.user_id);
        if (!byProject) index.set(m.user_id, (byProject = new Map()));
        byProject.set(cell.project_id, m);
      }
    }
  }
  return index;
}

/** user_id → одоо ажиллаж буй төслүүдийн id (давхардаагүй). */
export function buildWorkIndex(model: AllocationModel): Map<number, Set<number>> {
  const index = new Map<number, Set<number>>();
  for (const row of model.byTeam) {
    for (const cell of row.cells) {
      for (const id of workingIds(cell)) {
        let set = index.get(id);
        if (!set) index.set(id, (set = new Set()));
        set.add(cell.project_id);
      }
    }
  }
  return index;
}

/**
 * «Бат-Өлзий Тэлмэн» → «Тэлмэн .Б» (2026-09-16, эзний хүсэлт).  `users.full_name`
 * нь «Овог Нэр» дараалалтай тул сүүлийн үг = нэр, эхний үгийн үсэг = овгийн
 * товчлол.  Ганц үгтэй нэр хэвээр.  Бүтэн нэр `title`-д үлдэнэ.
 */
export function shortPersonName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return fullName.trim();
  const given = parts[parts.length - 1] ?? '';
  const initial = parts[0]?.[0] ?? '';
  return initial ? `${given} .${initial.toUpperCase()}` : given;
}

/** Нэрсийг харьцуулах — ХАРУУЛДАГ нэрээр (нэр, овог биш); кирилл, латинд ажиллана. */
const byName = (a: RosterPerson, b: RosterPerson) => a.display_name.localeCompare(b.display_name);

export interface RosterContext {
  model: AllocationModel;
  /** `buildPrimaryProjectMap` — user_id → үндсэн төсөл. */
  primary: Map<number, number>;
  colorOfProject: (projectId: number) => string;
  labels: RosterLabels;
  people: Map<number, AllocPerson>;
  work: Map<number, Set<number>>;
  /** `buildActiveIndex` — хэн аль төслийг аль шатанд сонгосон. */
  active: Map<number, Map<number, AllocActiveMember>>;
}

/** Нэг таб дотор нэг л удаа угсарна — индексүүд нь моделоос гардаг. */
export function buildRosterContext(
  init: Omit<RosterContext, 'people' | 'work' | 'active'>,
): RosterContext {
  return {
    ...init,
    people: buildPeopleIndex(init.model),
    work: buildWorkIndex(init.model),
    active: buildActiveIndex(init.model),
  };
}

function projectLabelOf(model: AllocationModel, projectId: number): string {
  const p = model.byProject.find((r) => r.entity.id === projectId)?.entity;
  return p ? shortProjectLabel(p.name) : String(projectId);
}

/** Засварын (дотоод) төсөл үү — `-repair_projects.id`, `kind = 'repair'`. */
function isRepairId(model: AllocationModel, projectId: number): boolean {
  return isRepairProject(model.byProject.find((r) => r.entity.id === projectId)?.entity);
}

/** Сонгосон өдрийн төслийн бус ажил + засварын цаг — мөрөнд харуулах бол.
 *  Зөвхөн «Өдөр» мужид (мужаар мөрүүд өдрийн тоо харуулдаг); «одоо» дүрэм
 *  нь `ctx.model.dayWork`-ийг шууд уншина — бүх мужид хүчинтэй. */
function dayWorkOf(ctx: RosterContext, userId: number): PersonDayWork | undefined {
  if (ctx.model.range !== 'day') return undefined;
  const work = ctx.model.dayWork.get(userId);
  return hasDayWork(work) ? work : undefined;
}

/**
 * Нэг хүний мөр (2026-09-16, эзний хүсэлт): нэрийн доор ҮНДСЭН төсөл
 * (хамгийн их ажилтай нь — `buildPrimaryProjectMap`), дараа нь бусад
 * төслүүд нэрээр.  `here` = энэ мөр аль нүдэнд байгаа
 * (Багаар таб) — үндсэн нь өөр бол `elsewhere` (бүдэг); хавтгай багийн
 * жагсаалтад `null`.  `note` нь `title`-д зориулсан нэг мөр хураангуй.
 */
function personRow(ctx: RosterContext, userId: number, here: number | null): RosterPerson {
  const name = ctx.people.get(userId)?.full_name ?? `#${userId}`;
  const projects = ctx.work.get(userId);
  const primaryId = ctx.primary.get(userId);
  const elsewhere = here != null && primaryId != null && primaryId !== here;
  const otherIds = projects ? [...projects].filter((id) => id !== primaryId) : [];
  // Сонголтоор харагдаж буй засварын төслийн цаг тусдаа мөр болохгүй — шошгон
  // дээрээ (`mergePickedRepairHours`, зөвхөн харагдац).
  const { work, hoursByPick } = mergePickedRepairHours(
    dayWorkOf(ctx, userId),
    new Set(primaryId != null ? [primaryId, ...otherIds] : otherIds),
  );
  const durationOf = (id: number) => {
    const h = hoursByPick.get(id);
    return h != null ? ctx.labels.duration(h) : undefined;
  };
  const primary =
    primaryId != null
      ? {
          id: primaryId,
          label: projectLabelOf(ctx.model, primaryId),
          color: ctx.colorOfProject(primaryId),
          repair: isRepairId(ctx.model, primaryId) || undefined,
          duration: durationOf(primaryId),
        }
      : undefined;
  // Бусад төслүүд ХОЁР төрөлтэй: сүүлийн сонголтод хамт байгаа нь «бас: …»,
  // өдрийн өмнөх шатанд л сонгосон нь «өмнө нь: …» — «өглөө А, үдээс хойш Б»
  // гэдгийг нэг мөрөөс уншина.
  // Мужаар (7 хоног … 1 жил) харахад «өмнө нь» гэсэн ялгаа утгагүй — оронд
  // нь төсөл бүрийн ард ӨДРИЙН тоо: «MITIC_AZ (12 өдөр)», олон өдөртэй нь эхэнд.
  const spanMode = ctx.model.range !== 'day';
  const picks = ctx.active.get(userId);
  const labelOf = (id: number) => {
    const label = projectLabelOf(ctx.model, id);
    const d = durationOf(id);
    return d ? `${label} · ${d}` : label;
  };
  const tagged = (id: number, label: string): RosterProjectLabel => ({
    label,
    repair: isRepairId(ctx.model, id) || undefined,
  });
  const sortLabels = (ids: number[]) =>
    ids.map((id) => tagged(id, labelOf(id))).sort((a, b) => a.label.localeCompare(b.label));
  const withDays = (ids: number[]) =>
    ids
      .map((id) => ({ id, label: labelOf(id), days: picks?.get(id)?.days ?? 0 }))
      .sort((a, b) => b.days - a.days || a.label.localeCompare(b.label))
      .map((x) => tagged(x.id, `${x.label} (${ctx.labels.dayCount(x.days)})`));
  const also = spanMode
    ? withDays(otherIds)
    : picks
      ? sortLabels(otherIds.filter((id) => picks.get(id)?.latest))
      : sortLabels(otherIds);
  const earlier =
    picks && !spanMode ? sortLabels(otherIds.filter((id) => !picks.get(id)?.latest)) : [];
  const primaryPick = picks && primaryId != null ? picks.get(primaryId) : undefined;
  const days = spanMode && primaryPick ? ctx.labels.dayCount(primaryPick.days) : undefined;
  // Төслийн бус ажил одоо үргэлжилж байвал ТЭР нь одоогийн ажил — ирцийн
  // сонголтын «одоо» тэмдэг нуугдана (эзний шийдвэр, `lib/currentWork.ts`).
  const now = showPickNow(primaryPick?.now ?? false, ctx.model.dayWork.get(userId));
  // «Гарсан» зөвхөн ӨНӨӨДӨР утгатай — өнгөрсөн өдөр бүх хүн гарсан нь мэдээж.
  // Ирцийн ЖИНХЭНЭ `now`-оор (нээлттэй session) — төслийн бус ажлын нуусан
  // «одоо» нь «гарсан» гэсэн үг биш (өдөрт хэд хэдэн session байж болно).
  const left =
    ctx.model.isToday &&
    primaryPick != null &&
    !primaryPick.now &&
    primaryPick.latest &&
    primaryPick.stages.includes('clock_out');
  const primaryNote = primary?.duration ? `${primary.label} · ${primary.duration}` : primary?.label;
  const note = [
    primaryNote && days ? `${primaryNote} (${days})` : primaryNote,
    also.length > 0 ? ctx.labels.alsoOn(also.map((x) => x.label)) : null,
    earlier.length > 0 ? ctx.labels.earlierOn(earlier.map((x) => x.label)) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    user_id: userId,
    full_name: name,
    display_name: shortPersonName(name),
    primary,
    others: also.length > 0 ? also : undefined,
    earlier: earlier.length > 0 ? earlier : undefined,
    days,
    note: note || undefined,
    elsewhere,
    now: now || undefined,
    left: left || undefined,
    work,
  };
}

/** Нэг (баг × төсөл) нүдний хүмүүс — БҮГД, үндсэн нь өөр байсан ч. */
export function cellPeople(ctx: RosterContext, cell: AllocCell): RosterPerson[] {
  return workingIds(cell)
    .map((id) => personRow(ctx, id, cell.project_id))
    .sort((a, b) => Number(a.elsewhere) - Number(b.elsewhere) || byName(a, b));
}

/**
 * Багийн ТӨСӨЛГҮЙ гишүүд — донатын саарал зүсэмтэй ижил олонлог:
 * API-ийн `idle_members` (ямар ч ажилгүй) + нүднүүдэд байгаа ч одоо
 * ажиллахгүй хүмүүс (ажил нь бүгд дууссан / ирцээр төсөл сонгоогүй).
 */
export function teamIdlePeople(ctx: RosterContext, row: AllocAxisEntry<AllocTeam>): RosterPerson[] {
  const working = new Set<number>();
  const known = new Set<number>();
  for (const cell of row.cells) {
    for (const id of workingIds(cell)) working.add(id);
    for (const m of cell.members) known.add(m.user_id);
  }
  for (const p of row.entity.idle_members) known.add(p.user_id);
  return [...known]
    .filter((id) => !working.has(id))
    .map((id) => {
      const name = ctx.people.get(id)?.full_name ?? `#${id}`;
      // Ирцээр төсөл сонгоогүй ч төслийн бус ажил / засварын цаг бүртгэсэн
      // байж болно — «төсөлгүй» гэдэг нь «юу ч хийгээгүй» гэсэн үг БИШ.
      return {
        user_id: id,
        full_name: name,
        display_name: shortPersonName(name),
        work: dayWorkOf(ctx, id),
      };
    })
    .sort(byName);
}

/**
 * БАГ → ХАВТГАЙ нэрсийн жагсаалт, толгойгүй (2026-09-16, эзний хүсэлт:
 * «төслийн нэр → доор нь хүмүүс» гэсэн бүлэглэл ХЭРЭГГҮЙ; хүн бүр нэг
 * мөр — тод нэр, доор нь жижгээр үндсэн төсөл · бусад төслүүд · ажлын
 * тоо).  Хүн бүр ЯГ НЭГ удаа (үндсэн төслөөрөө) — донатын зүсмийн тоотой
 * таарна.  Эрэмбэ: том төслийнхөн эхэнд (донатын логик), дотроо нэрээр;
 * төсөлгүй хүмүүс хамгийн сүүлд, бүдэг.
 */
export function teamRoster(ctx: RosterContext, row: AllocAxisEntry<AllocTeam>): RosterGroup[] {
  const people: RosterPerson[] = [];
  const seen = new Set<number>();
  const sizeOf = new Map<number, number>();
  for (const cell of row.cells) {
    for (const id of workingIds(cell)) {
      if (seen.has(id) || ctx.primary.get(id) !== cell.project_id) continue;
      seen.add(id);
      people.push(personRow(ctx, id, null));
      sizeOf.set(cell.project_id, (sizeOf.get(cell.project_id) ?? 0) + 1);
    }
  }
  const sizeOfPerson = (p: RosterPerson) => (p.primary ? (sizeOf.get(p.primary.id) ?? 0) : 0);
  people.sort(
    (a, b) =>
      sizeOfPerson(b) - sizeOfPerson(a) ||
      (a.primary?.label ?? '').localeCompare(b.primary?.label ?? '') ||
      byName(a, b),
  );
  // Төсөлгүй ч өдрийн ажилтай хүн бүдэг БИШ — эрэмбэ, тоо нь хэвээр (сүүлд).
  const idle = teamIdlePeople(ctx, row).map((p) => ({
    ...p,
    note: ctx.labels.idle,
    muted: !p.work,
  }));
  return [
    {
      key: '__all',
      label: '',
      color: teamHex(row.entity.code),
      hideHeader: true,
      people: [...people, ...idle],
    },
  ];
}

/**
 * ТӨСӨЛ → багаар бүлэглэсэн нэрс.  Энд БҮХ ажиллаж буй хүн орно — үндсэн
 * төсөл нь өөр байсан ч (бүдэг, «үндсэн: X» тайлбартай), учир нь эзний
 * асуулт «энэ төсөл дээр ХЭН ХЭН байна» юм.
 */
export function projectRoster(
  ctx: RosterContext,
  row: AllocAxisEntry<AllocProject>,
): RosterGroup[] {
  return row.cells
    .map((cell) => {
      const team = ctx.model.byTeam.find((r) => r.entity.id === cell.team_id)?.entity;
      const code = team?.code ?? '?';
      return {
        key: cell.team_id,
        code,
        label: team?.name_mn ?? code,
        color: teamHex(code),
        people: cellPeople(ctx, cell),
      };
    })
    .filter((g) => g.people.length > 0)
    .sort((a, b) => b.people.length - a.people.length || a.code.localeCompare(b.code));
}

/** Хэд хэдэн багийн төсөлгүй хүмүүс, багаар бүлэглэсэн (Тоймын саарал зүсэм). */
export function idleRoster(ctx: RosterContext, rows: AllocAxisEntry<AllocTeam>[]): RosterGroup[] {
  return rows
    .map((row) => ({
      key: row.entity.id,
      code: row.entity.code,
      label: row.entity.name_mn,
      color: teamHex(row.entity.code),
      people: teamIdlePeople(ctx, row),
    }))
    .filter((g) => g.people.length > 0)
    .sort((a, b) => b.people.length - a.people.length);
}
