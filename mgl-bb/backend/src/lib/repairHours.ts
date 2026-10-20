/**
 * Засварын АЖИЛЛАСАН ЦАГИЙН хураангуй (2026-09-24) — «хэн хэдэн цаг».
 *
 * Засварын ажил ажилтанд ХУВИАР биш ЦАГААР харагдана: цагаар бодогддог
 * (`projects.progress_mode = 'hours'`) төсөл ба дотоод ажил (`repair_projects`)
 * дээр «А — 3 цаг, Б — 5 цаг».  Энэ файл нь `repair_entries`-ийн
 * (хүн × таск) бүлэглэсэн мөрүүдийг төсөл / хүн / таскийн нийлбэр болгоно.
 *
 * ЦЭВЭР — DB дуудахгүй (routes/repair.ts SQL-ээ өөрөө ажиллуулна), тиймээс
 * `node --test` шууд ачаална.
 *
 * ⚠️ Зөвхөн ХАРАГДАЦ.  Оноо (`computed_pct`/`user_points`) ба явц
 *    (`progress_pct`, lib/repairProgress.ts) эндээс ХӨДЛӨХГҮЙ.
 */

/** SQL-ийн `GROUP BY re.user_id, t.id` мөр. */
export interface RepairHoursRow {
  user_id: number;
  full_name: string | null;
  /** `LEFT JOIN tasks` — таскгүй эсвэл устсан таск бол null. */
  task_id: number | null;
  hours: number;
  entries: number;
  last_date: string | null;
}

export interface PersonHours {
  user_id: number;
  full_name: string;
  hours: number;
  entries: number;
  last_date: string | null;
}

export interface TaskHours {
  task_id: number;
  hours: number;
  people: PersonHours[];
}

export interface RepairHoursSummary {
  total_hours: number;
  entry_count: number;
  /** Хүн бүрийн нийт цаг (таскаас үл хамааран), их → бага. */
  people: PersonHours[];
  /** Таск бүрийн цаг + хүмүүс; таскгүй бүртгэл энд ОРОХГҮЙ. */
  tasks: TaskHours[];
  /** Таскт холбогдоогүй (төслийн түвшний) цаг. */
  unlinked_hours: number;
}

/** REAL цагийн нийлбэрийн хөвөгч цэгийн үлдэгдлийг (9.3 + 9.9 = 19.200000000000003) арилгана. */
export function roundHours(h: number): number {
  const v = Number(h);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function byHoursThenName(a: PersonHours, b: PersonHours): number {
  return b.hours - a.hours || a.full_name.localeCompare(b.full_name) || a.user_id - b.user_id;
}

function addTo(map: Map<number, PersonHours>, r: RepairHoursRow): void {
  const cur = map.get(r.user_id);
  const hours = Number(r.hours) || 0;
  const entries = Number(r.entries) || 0;
  if (!cur) {
    map.set(r.user_id, {
      user_id: r.user_id,
      full_name: r.full_name ?? '',
      hours,
      entries,
      last_date: r.last_date,
    });
    return;
  }
  cur.hours += hours;
  cur.entries += entries;
  if (r.last_date && (!cur.last_date || r.last_date > cur.last_date)) cur.last_date = r.last_date;
}

function finish(map: Map<number, PersonHours>): PersonHours[] {
  return [...map.values()].map((p) => ({ ...p, hours: roundHours(p.hours) })).sort(byHoursThenName);
}

export function summarizeRepairHours(rows: readonly RepairHoursRow[]): RepairHoursSummary {
  const people = new Map<number, PersonHours>();
  const tasks = new Map<number, Map<number, PersonHours>>();
  let total = 0;
  let entries = 0;
  let unlinked = 0;
  for (const r of rows) {
    const h = Number(r.hours) || 0;
    total += h;
    entries += Number(r.entries) || 0;
    addTo(people, r);
    if (r.task_id == null) {
      unlinked += h;
      continue;
    }
    let perTask = tasks.get(r.task_id);
    if (!perTask) {
      perTask = new Map();
      tasks.set(r.task_id, perTask);
    }
    addTo(perTask, r);
  }
  return {
    total_hours: roundHours(total),
    entry_count: entries,
    people: finish(people),
    tasks: [...tasks.entries()]
      .map(([task_id, m]) => {
        const ps = finish(m);
        return { task_id, hours: roundHours(ps.reduce((s, p) => s + p.hours, 0)), people: ps };
      })
      .sort((a, b) => b.hours - a.hours || a.task_id - b.task_id),
    unlinked_hours: roundHours(unlinked),
  };
}
