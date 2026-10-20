/**
 * Хугацааны сануулгын sweep — «Төслийн хуваарь» хуудасны автомат тал.
 *
 * Өдөрт НЭГ УДАА (УБ-ийн 09:00-аас хойш) бүх төслийн эрсдэлийг бодож,
 * дуусах огноо ойртсон (7 / 3 / 1 хоног), хэтэрсэн, эсвэл удаан
 * хөдөлгөөнгүй (stale) төслүүд дээр хариуцагч руу мэдэгдэл илгээнэ.
 *
 * ЗАРЧИМ — давхардахгүй байх нь хамгийн чухал: инженерүүдийг өдөр бүр
 * ижил мэдэгдлээр цохих нь мэдэгдлийн систем бүхэлдээ үл тоомсорлогдох
 * шалтгаан болдог.  Хоёр давхар хамгаалалт:
 *   1. `app_settings.deadline_sweep_last_date` — өдрийг АЖИЛ ЭХЛЭХЭЭС ӨМНӨ
 *      «эзэмшиж» авна, тул зэрэг ажилласан хоёр cron tick эсвэл дунд нь
 *      унасан ажиллагаа ч хоёр дахин илгээхгүй.
 *   2. `project_reminders (project_id, stage)` анхдагч түлхүүр — төсөл
 *      бүр шат тус бүр дээр амьдралынхаа туршид ЯГ НЭГ мэдэгдэл авна.
 *      Хуваарь дахин тавигдвал routes/timeline.ts дахь PUT .../schedule
 *      уг мөрүүдийг устгаж дахин сануулах эрхийг нээнэ.
 *
 * Cron: ШИНЭ cron илэрхийлэл БҮРТГЭЭГҮЙ.  wrangler.toml-д таарахгүй
 * илэрхийлэл нэмбэл index.ts-ийн fail-safe салаагаар орж Gmail-ийн sync
 * гурвалыг тэр хуваариар давхар ажиллуулна.  Оронд нь энэ функц өөрөө
 * цагаа шалгаж (доорх `MIN_HOUR_UB`) байгаа cron дээр залгагдана —
 * lib/pushSweep.ts-ийн prune нь UTC минут == 17 дээр яг ижил аргаар
 * гацдагтай адил.
 */
import type { Env } from '../types';
import { loadTimelineProjects, type TimelineProject } from '../routes/timeline';
import { loadOverdueMilestones } from '../routes/deadlines';
import { createNotification, notifyProjectResponsible } from './notify';
import { todayInUB } from './time';

const UB_TZ = 'Asia/Ulaanbaatar';

/** Үүнээс өмнөх цагт сануулга илгээхгүй — өглөө ажилдаа ирэх үед хүрнэ. */
const MIN_HOUR_UB = 9;

const SWEEP_KEY = 'deadline_sweep_last_date';

/** `project_reminders.stage` — эрсдэлийн төлөвөөс шат руу. */
type ReminderStage = 'd7' | 'd3' | 'd1' | 'overdue' | 'stale';

const STAGE_OF: Partial<Record<TimelineProject['risk_state'], ReminderStage>> = {
  overdue: 'overdue',
  due_1: 'd1',
  due_3: 'd3',
  due_7: 'd7',
  stale: 'stale',
};

/** Нэг batch-д хэдэн INSERT — D1 batch нь transaction тул хэсэгчлэн
 *  явуулж нэг мөрийн алдаа бүх өдрийг унагаахаас сэргийлнэ. */
const INSERT_CHUNK = 25;

/** УБ-ийн одоогийн цаг (0-23).  lib/time.ts-д цагийн helper байхгүй тул
 *  энд Intl-ээр шууд уншина (todayInUB / nowInUBIso л байдаг). */
function currentHourInUB(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: UB_TZ,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const raw = parts.find((p) => p.type === 'hour')?.value ?? '';
  const hour = Number.parseInt(raw, 10);
  return Number.isFinite(hour) ? hour : -1;
}

function projectTitle(p: TimelineProject): string {
  return p.display_title?.trim() || p.name;
}

/** Мэдэгдлийн Монгол гарчиг/бие — i18n түлхүүр БИШ, энэ репо дэх бусад
 *  мэдэгдэлтэй ижил серверт бичигдэнэ (routes/tasks.ts-ийг үз). */
function messageFor(
  stage: ReminderStage,
  p: TimelineProject,
): { title: string; body: string } {
  const name = projectTitle(p);
  const due = p.finish_date ? ` (дуусах ${p.finish_date})` : '';
  switch (stage) {
    case 'overdue': {
      const n = p.days_left != null ? Math.abs(p.days_left) : null;
      return {
        title: 'Төслийн хугацаа хэтэрсэн',
        body: `«${name}»${due}${n != null ? ` — ${n} хоног хэтэрсэн` : ''}.`,
      };
    }
    case 'd1': {
      const when = p.days_left != null && p.days_left <= 0 ? 'өнөөдөр' : 'маргааш';
      return {
        title: `Төслийн хугацаа ${when} дуусна`,
        body: `«${name}»${due} — явцаа шалгаж, шаардлагатай бол хугацааг шинэчилнэ үү.`,
      };
    }
    case 'd3':
      return {
        title: 'Төслийн хугацаа 3 хоногийн дотор дуусна',
        body: `«${name}»${due}.`,
      };
    case 'd7':
      return {
        title: 'Төслийн хугацаа 7 хоногийн дотор дуусна',
        body: `«${name}»${due}.`,
      };
    case 'stale':
      return {
        title: 'Төсөл удаан хугацаанд хөдөлгөөнгүй байна',
        body: `«${name}» — ${
          p.stale_days != null ? `${p.stale_days} хоног` : 'удаан хугацаанд'
        } батлагдсан явц бүртгэгдээгүй.`,
      };
  }
}

/**
 * Хугацаа ХЭТЭРСЭН milestone-ийн мэдэгдэл (migration 0173).
 *
 * ⚠️ ЗӨВХӨН «хэтэрсэн» шат.  Төслийн сануулга нь d7/d3/d1/overdue/stale
 *    гэсэн таван шаттай; milestone нь ЗОРИУДААР ганцхан шаттай.  Шалтгаан:
 *    төсөлд хэдэн ч milestone байж болох тул урьдчилсан сануулга нэмбэл
 *    мэдэгдлийн урсгал төсөл бүрээр үржиж, бүх мэдэгдлийн систем үл
 *    тоомсорлогдох болно (энэ файлын толгойн ЗАРЧМЫГ үз).
 *
 * Давхардлын хамгаалалт нь `project_milestones.overdue_notified_at` —
 * тусдаа хүснэгт хэрэггүй, учир нь шат ганц.  Огноог засвал API нь
 * түүнийг NULL болгож дахин сануулах эрхийг нээнэ
 * (`PUT /api/deadlines/milestones/:id`-ийг үз).
 *
 * Мэдэгдэл хүлээн авагч: хариуцагч байвал ЗӨВХӨН тэр (хамгийн нарийн
 * хаяг), байхгүй бол төслийн хариуцагчид + админ.
 */
async function sweepOverdueMilestones(env: Env, today: string): Promise<void> {
  let rows;
  try {
    rows = await loadOverdueMilestones(env.DB, today);
  } catch (err) {
    console.error('deadline-sweep milestone load failed', err);
    return;
  }
  if (rows.length === 0) return;

  for (const m of rows) {
    try {
      // Тэмдэглэгээг ЭХЛЭЭД тавина — мэдэгдэл илгээх алхам унасан ч маргааш
      // дахин цохихгүй.  `AND overdue_notified_at IS NULL` нь зэрэг
      // ажилласан хоёр tick-ийн уралдааныг таслана (`meta.changes === 0`
      // → өөр tick аль хэдийн эзэмшсэн).
      const res = await env.DB.prepare(
        `UPDATE project_milestones
            SET overdue_notified_at = datetime('now')
          WHERE id = ? AND overdue_notified_at IS NULL`,
      )
        .bind(m.id)
        .run();
      if ((res.meta?.changes ?? 0) === 0) continue;

      const title = 'Хугацаа хэтэрсэн';
      const body = `«${m.title}» — ${m.project_title} (${m.due_date}), ${m.days_overdue} хоног хэтэрсэн.`;
      const link = `/app/projects/${m.project_id}?tab=deadlines`;

      if (m.assignee_ids.length > 0) {
        // Хариуцагч БҮРТ тусад нь — хамтарсан хугацааны хувьд нэг хүнд
        // мэдэгдээд бусад нь мэдэхгүй үлдэх нь хамгийн эвгүй тохиолдол.
        for (const uid of m.assignee_ids) {
          await createNotification(env.DB, uid, 'project_deadline', title, body, link);
        }
      } else {
        await notifyProjectResponsible(
          env.DB,
          m.project_id,
          'project_deadline',
          title,
          body,
          link,
          { includeAdmins: true },
        );
      }
    } catch (err) {
      console.error('deadline-sweep milestone notify failed', m.id, err);
    }
  }
}

export async function runDeadlineSweep(env: Env): Promise<void> {
  const db = env.DB;

  // 1. Өглөөний 09:00-аас өмнө юу ч хийхгүй.
  const hour = currentHourInUB();
  if (hour < MIN_HOUR_UB) return;

  const today = todayInUB();

  try {
    // 2. Өнөөдөр аль хэдийн ажилласан уу?
    const last = await db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .bind(SWEEP_KEY)
      .first<{ value: string }>();
    if (last?.value && last.value >= today) return;

    // 3. Өдрийг АЖИЛ ЭХЛЭХЭЭС ӨМНӨ эзэмшинэ — доорх алхмын аль нэг унасан ч
    //    (эсвэл өөр tick зэрэг оролдсон ч) хоёр дахин илгээхгүй.  Сануулга
    //    алдагдах нь давхардахаас хамаагүй дээр: хуудас өөрөө эрсдэлийг
    //    жагсаадаг тул мэдээлэл алга болохгүй.
    //    `updated_by` NULL — cron-ы ард хэрэглэгч байхгүй (lib/settings.ts-ийн
    //    upsertSetting нь заавал хэрэглэгч шаарддаг тул энд шууд SQL).
    await db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at, updated_by)
         VALUES (?, ?, datetime('now'), NULL)
         ON CONFLICT(key) DO UPDATE SET
           value      = excluded.value,
           updated_at = datetime('now')`,
      )
      .bind(SWEEP_KEY, today)
      .run();
  } catch (err) {
    console.error('deadline-sweep claim failed', err);
    return;
  }

  // 3.5. Хэтэрсэн milestone-ууд.  Өдрийг аль хэдийн эзэмшсэн тул энд
  //      ажиллана.  Төслийн сануулгаас ӨМНӨ дуудсан шалтгаан: доорх
  //      алхмуудад `candidates.length === 0` гэсэн эрт `return` байгаа —
  //      араас нь дуудвал сануулах төсөлгүй өдөр milestone-ууд алгасагдана.
  //      Өөрийн дотоод алдаагаа өөрөө барьдаг тул төслийн шатыг унагаахгүй.
  await sweepOverdueMilestones(env, today);

  // 4. Бүх төслийн эрсдэлийг route-тай ЯГ ижил замаар бодно (эрсдэлийн
  //    логик хоёр газарт хуулагдахгүй).  viewerId = 0: PROJECT_LIST_SQL-ийн
  //    `is_member` тэмдэглэгээ бидэнд хэрэггүй.
  let projects: TimelineProject[];
  try {
    projects = await loadTimelineProjects(db, 0, today);
  } catch (err) {
    console.error('deadline-sweep load failed', err);
    return;
  }

  // 5. Төлөв → шат.  Бусад бүх төлөв (done / on_track / not_started /
  //    unscheduled) юу ч илгээхгүй.
  const candidates: { project: TimelineProject; stage: ReminderStage }[] = [];
  for (const p of projects) {
    if (p.status === 'archived') continue;
    const stage = STAGE_OF[p.risk_state];
    if (stage) candidates.push({ project: p, stage });
  }
  if (candidates.length === 0) return;

  // 6. Давхардлын шүүлт — INSERT амжилттай болсон (meta.changes > 0) мөр л
  //    мэдэгдэл төрүүлнэ.  Энэ бол spam-ийн эсрэг ЦОРЫН ГАНЦ механизм.
  const fresh: { project: TimelineProject; stage: ReminderStage }[] = [];
  const insert = db.prepare(
    'INSERT INTO project_reminders (project_id, stage) VALUES (?, ?) ON CONFLICT DO NOTHING',
  );
  for (let i = 0; i < candidates.length; i += INSERT_CHUNK) {
    const chunk = candidates.slice(i, i + INSERT_CHUNK);
    try {
      const results = await db.batch(chunk.map((x) => insert.bind(x.project.id, x.stage)));
      results.forEach((res, idx) => {
        const item = chunk[idx];
        if (item && (res.meta?.changes ?? 0) > 0) fresh.push(item);
      });
    } catch (err) {
      // Нэг багц унавал үлдсэнийг үргэлжлүүлнэ — бүтэн өдрийн sweep
      // ганц мөрийн улмаас зогсохгүй.
      console.error('deadline-sweep reminder insert failed', err);
    }
  }

  // 7. Мэдэгдэл.  `d1` ба `overdue` дээр админ рүү нэмж хуулна (escalation);
  //    эрт шатууд дээр зөвхөн хариуцагч.
  for (const { project, stage } of fresh) {
    try {
      const { title, body } = messageFor(stage, project);
      await notifyProjectResponsible(
        db,
        project.id,
        'project_deadline',
        title,
        body,
        `/app/projects/${project.id}`,
        { includeAdmins: stage === 'd1' || stage === 'overdue' },
      );
    } catch (err) {
      console.error('deadline-sweep notify failed', project.id, err);
    }
  }
}
