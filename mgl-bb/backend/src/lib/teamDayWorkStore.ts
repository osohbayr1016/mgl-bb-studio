/**
 * Багууд хуудасны «одоогийн ажил» (2026-09-24) — НЭГ өдрийн төслийн бус ажил
 * ба засварын цагийг D1-ээс уншина.  Дүрэм нь `lib/teamDayWork.ts`-д (цэвэр,
 * тесттэй).  `GET /teams/allocation` ба `GET /teams/:id/overview` хоёулаа
 * ЭНЭ ганц функцийг дуудна — хоёр хуудас зөрөхгүй.
 *
 * Зориуд ОРУУЛААГҮЙ зүйл: төслийн бус ажлын «юу хийсэн» тайлан (`report`),
 * шалгалтын шат/төлөв ба засварын тайлбар.  Эдгээр нь админы шалгалтын
 * мэдээлэл — Багууд хуудсыг бүх ажилтан хардаг.  Татгалзсан төслийн бус
 * мөр ажил гэж тооцогдохгүй (`nonProjectDayCounts`-тэй ижил дүрэм).
 */
import { categoryLabelOf } from './nonProjectWork';
import { nonProjectCoversNow } from './teamDayWork';
import { nowInUBIso, todayInUB } from './time';
import { ubMinutesOf } from './workSchedule';

export interface DayNonProjectItem {
  id: number;
  user_id: number;
  category: string;
  /** Серверийн (монгол) шошго — frontend i18n-д түлхүүр байхгүй үеийн нөөц. */
  category_label: string;
  /** Зөвхөн «Бусад» ангилалд — ямар ажил болохыг ажилтан бичсэн. */
  note: string | null;
  /** Цаггүй бүртгэлд (0356, ирцэд сонгосон) хоёулаа null. */
  start_time: string | null;
  end_time: string | null;
  /** Цайны цонхтой давхцсан хэсгийг хассан хугацаа (0342-ийн тооцоо); цаггүй
   *  мөрөнд ирцийн сонголтоос (өглөө 4 / өдөржин 8 цаг). */
  minutes: number;
  /** Зөвхөн өнөөдөр: цагийн муж одоог хамарна (`nonProjectCoversNow`); цаггүй
   *  мөр бол төслийн «одоо»-той ижил (`routes/teams.ts`) — нээлттэй ирцтэй,
   *  гарах биш СҮҮЛИЙН цэгт сонгогдсон. */
  now: boolean;
}

export interface DayRepairHoursItem {
  /** Бүлгийн хамгийн бага `repair_entries.id` — React түлхүүрт. */
  id: number;
  user_id: number;
  /** `project` = жинхэнэ төсөл дээрх засвар, `repair` = засварын (дотоод) төсөл. */
  kind: 'project' | 'repair';
  /** `projects.id` ЭСВЭЛ `repair_projects.id` — ЭЕРЭГ, `kind`-аар ялгана. */
  target_id: number;
  target_name: string;
  /** 0341 — цагаар бодогддог төслийн таскаас бүртгэсэн бол. */
  task_id: number | null;
  task_name: string | null;
  hours: number;
}

export interface DayWork {
  date: string;
  non_project: DayNonProjectItem[];
  repair_hours: DayRepairHoursItem[];
}

export async function loadDayWork(
  db: D1Database,
  date: string,
  opts: {
    /** Гэрээ хэлэлцээрийн шатны төслийн нэр зөвхөн admin/senior-т (`seesPending`). */
    seesPending: boolean;
    /** Өгвөл зөвхөн тэр багийн ҮНДСЭН гишүүд (`/teams/:id/overview`). */
    teamId?: number;
  },
): Promise<DayWork> {
  const nowMin = date === todayInUB() ? ubMinutesOf(nowInUBIso()) : null;
  const teamSql =
    opts.teamId != null
      ? ' AND u.id IN (SELECT user_id FROM user_teams WHERE team_id = ?2 AND is_primary = 1)'
      : '';
  const pendingSql = opts.seesPending ? '' : ' AND (re.project_id IS NULL OR COALESCE(p.is_pending, 0) = 0)';
  const bind = (stmt: D1PreparedStatement) =>
    opts.teamId != null ? stmt.bind(date, opts.teamId) : stmt.bind(date);

  const [npRes, repairRes] = await Promise.all([
    bind(
      db.prepare(
        `SELECT n.id, n.user_id, n.category, n.note, n.start_time, n.end_time, n.minutes,
                (n.start_time IS NULL
                 AND EXISTS (SELECT 1 FROM attendance_sessions s
                              WHERE s.user_id = n.user_id AND s.date = n.date AND s.clock_out IS NULL)
                 AND EXISTS (
                   SELECT 1 FROM attendance_checkpoint_non_project a
                    WHERE a.entry_id = n.id
                      AND a.checkpoint_id = (
                        SELECT c.id FROM attendance_project_checkpoints c
                         WHERE c.user_id = n.user_id AND c.date = n.date
                           AND c.checkpoint_type <> 'clock_out'
                         ORDER BY c.recorded_at DESC, c.id DESC LIMIT 1))) AS selected_now
           FROM non_project_work_entries n
           INNER JOIN users u ON u.id = n.user_id AND u.status = 'active'
          WHERE n.date = ?1 AND n.status <> 'rejected'${teamSql}
          ORDER BY n.user_id, n.start_time, n.id`,
      ),
    ).all<{
      id: number;
      user_id: number;
      category: string;
      note: string | null;
      start_time: string | null;
      end_time: string | null;
      minutes: number;
      selected_now: number;
    }>(),
    // Нэг хүн нэг зорилт/таск дээр өдөрт хэд хэдэн удаа бүртгэж болно —
    // харагдацад нийлбэр нь хэрэгтэй.
    bind(
      db.prepare(
        `SELECT MIN(re.id) AS id, re.user_id, re.project_id, re.repair_project_id,
                COALESCE(p.name, rp.name) AS target_name,
                t.id AS task_id, t.name AS task_name,
                ROUND(SUM(re.hours), 2) AS hours
           FROM repair_entries re
           INNER JOIN users u ON u.id = re.user_id AND u.status = 'active'
           LEFT JOIN projects p         ON p.id = re.project_id
           LEFT JOIN repair_projects rp ON rp.id = re.repair_project_id
           LEFT JOIN tasks t            ON t.id = re.task_id
          WHERE re.date = ?1${pendingSql}${teamSql}
          GROUP BY re.user_id, re.project_id, re.repair_project_id, t.id
          ORDER BY re.user_id, MIN(re.created_at), MIN(re.id)`,
      ),
    ).all<{
      id: number;
      user_id: number;
      project_id: number | null;
      repair_project_id: number | null;
      target_name: string | null;
      task_id: number | null;
      task_name: string | null;
      hours: number;
    }>(),
  ]);

  return {
    date,
    non_project: (npRes.results ?? []).map((r) => ({
      id: r.id,
      user_id: r.user_id,
      category: r.category,
      category_label: categoryLabelOf(r.category),
      note: r.note,
      start_time: r.start_time,
      end_time: r.end_time,
      minutes: r.minutes,
      now:
        r.start_time != null ? nonProjectCoversNow(r, nowMin) : nowMin != null && r.selected_now === 1,
    })),
    repair_hours: (repairRes.results ?? []).map((r) => ({
      id: r.id,
      user_id: r.user_id,
      kind: r.repair_project_id != null ? ('repair' as const) : ('project' as const),
      target_id: r.repair_project_id ?? r.project_id ?? 0,
      target_name: r.target_name ?? '',
      task_id: r.task_id,
      task_name: r.task_name,
      hours: r.hours,
    })),
  };
}
