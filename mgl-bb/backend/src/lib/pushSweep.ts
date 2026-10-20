/**
 * Push sweep — `notifications` хүснэгтийг тогтмол «түүж» шинэ мөрүүдийг
 * браузерын push мэдэгдэл болгон илгээнэ (минут тутмын cron, src/index.ts).
 *
 * ЗАРЧИМ: аппликейшн доторх хонх (notifications) нь БҮРЭН ҮНЭН эх сурвалж;
 * push бол зөвхөн түүний нэмэлт мэдэгдэл.  Тиймээс sweep нь ЗОРИУДААР
 * at-most-once (илгээхээс ӨМНӨ pushed = 1 тавина): минут тутмын cron-ын
 * хоёр дуудалт давхацвал давхардсан баннер гарахаас нэг удаа алдах нь
 * хамаагүй дээр — хонхонд мэдэгдэл ямар ч тохиолдолд үлдэнэ.
 */
import type { Env, NotificationType } from '../types';
import {
  sendWebPush,
  vapidConfigured,
  type PushPayload,
  type PushSubscriptionRecord,
} from './webPush';

/* ------------------------------------------------------------------ */
/*  Ангилал + хэрэглэгчийн тохиргоо                                    */
/* ------------------------------------------------------------------ */

export const PUSH_CATEGORIES = [
  'approvals',
  'my_progress',
  'tasks',
  'attendance',
  'leaves',
  'feedback',
  'deadlines',
  /* Захиалагчийн портал.  АЖИЛТАНД: захиалагч материал илгээв.
     ЗАХИАЛАГЧИД: материал шалгагдав, шинэ зураг/тайлан нийтлэгдэв. */
  'client',
  /* Нийтийн мэдээлэл — системийн шинэчлэлт, компанийн мэдээлэл, зарлал. */
  'announcements',
] as const;

export type PushCategory = (typeof PUSH_CATEGORIES)[number];

/** Тохиргоогүй (NULL) хэрэглэгчид бүх ангилал асаалттай. */
export const DEFAULT_PUSH_PREFS: Record<PushCategory, boolean> = {
  approvals: true,
  my_progress: true,
  tasks: true,
  attendance: true,
  leaves: true,
  feedback: true,
  deadlines: true,
  client: true,
  announcements: true,
};

/**
 * Мэдэгдлийн төрөл → хэрэглэгчид харагдах ангилал.
 *
 * ⚠️ `Record<NotificationType, PushCategory>` тэмдэглэгээ нь ЗОРИУДААР:
 *    types.ts-д 15 дахь төрөл нэмэхэд энэ файл ЭВДЭРЧ, шинэ төрөл ямар
 *    ангилалд хамаарахыг шийдэхээс өөр аргагүй болно (чимээгүй алдагдахгүй).
 */
export const CATEGORY_OF: Record<NotificationType, PushCategory> = {
  // Батлах хүсэлт — ахлагч/админд ирдэг «чи хийх ёстой» ажил.
  progress_pending: 'approvals',
  attendance_confirm_requested: 'approvals',
  asr_submitted: 'approvals',
  leave_requested: 'approvals',
  // Өөрийн илгээсэн ажлын хариу.
  progress_approved: 'my_progress',
  progress_rejected: 'my_progress',
  asr_approved: 'my_progress',
  asr_rejected: 'my_progress',
  // Зохиогчийн хяналтын хуваарь — «чи талбайд явна» гэсэн даалгавар.
  asr_visit_assigned: 'tasks',
  asr_visit_cancelled: 'tasks',
  // Даалгавар.
  task_assigned: 'tasks',
  // Ирц.
  attendance_adjusted: 'attendance',
  attendance_confirm_responded: 'attendance',
  attendance_announcement: 'attendance',
  // Чөлөө.
  leave_approved: 'leaves',
  leave_rejected: 'leaves',
  leave_cancelled: 'leaves',
  // Санал хүсэлт + PGP санал.
  suggestion_submitted: 'feedback',
  suggestion_updated: 'feedback',
  suggestion_resolved: 'feedback',
  pgp_feedback: 'feedback',
  // Ур чадварын үнэлгээ — бөглөх ёстой маягт (өөрийн болон багийнхаа).
  assessment_assigned: 'tasks',
  assessment_submitted: 'tasks',
  // Төслийн хугацаа — дуусах огноо ойртсон сануулга + гараар түлхсэн сануулга.
  project_deadline: 'deadlines',
  project_nudge: 'deadlines',
  // Захиалагчийн портал.  Дөрвүүлээ нэг ангилалд: ажилтан ба захиалагч
  // ХЭЗЭЭ Ч нэг хүн биш тул тэдний тохиргоо мөргөлдөхгүй.
  client_submission_received: 'client',
  client_submission_reviewed: 'client',
  client_publication: 'client',
  client_message: 'client',
  client_signature_requested: 'client',
  client_signed: 'client',
  // Нийтийн мэдээлэл — нийтлэгдэх/шинэчлэгдэх/сануулга.
  announcement_published: 'announcements',
  // Захирлаас багийн ахлах руу — «багийн бүтээмжийн зөрүүнд анхаар» гэсэн
  // хийх ёстой ажил (ахлагчид ирдэг батлах хүсэлттэй ижил төрлийн).
  team_gap_warning: 'approvals',
  // Баримтын гарын үсэг — «зурна уу / батлана уу» нь хийх ёстой ажил,
  // шийдвэр нь өөрийн илгээсэн ажлын хариу.
  doc_sign_requested: 'approvals',
  doc_sign_decided: 'my_progress',
  // Revit-ийн өөрчлөлтийн мэдэгдэл — «таны элемент нөлөөлөлд орлоо, танилцана уу».
  revit_change_notice: 'tasks',
  // Програмын хүсэлт — reviewer-т шинэ хүсэлт/илгээгчийн идэвх, илгээгчид өөрийн хүсэлтийн хариу.  Push биед зөвхөн
  // гарчиг + хүсэлтийн гарчиг/хариу (дотоод тэмдэглэл ХЭЗЭЭ Ч биш).
  engineering_request_new: 'feedback',
  engineering_request_activity: 'feedback',
  engineering_request_update: 'feedback',
};

/** `users.push_prefs` JSON-ыг анхдагч дээр давхарлана.  Гажсан JSON,
 *  танихгүй түлхүүр, boolean бус утгыг чимээгүй алгасна. */
export function resolvePrefs(raw: string | null | undefined): Record<PushCategory, boolean> {
  const out: Record<PushCategory, boolean> = { ...DEFAULT_PUSH_PREFS };
  if (!raw) return out;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
    const obj = parsed as Record<string, unknown>;
    for (const cat of PUSH_CATEGORIES) {
      const v = obj[cat];
      if (typeof v === 'boolean') out[cat] = v;
    }
  } catch {
    /* гажсан JSON → анхдагч */
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Тогтмолууд                                                         */
/* ------------------------------------------------------------------ */

/** Үүнээс хуучин pushed = 0 мөрийг илгээхгүй, зүгээр тэмдэглээд өнгөрнө
 *  (worker унтарсны дараа хоцорсон мэдэгдэл бөөнөөр буудахаас сэргийлнэ). */
const STALE_MINUTES = 15;
const MAX_NOTIFICATIONS_PER_SWEEP = 200;
const MAX_PUSHES_PER_SWEEP = 500;
/** Workers нэг зэрэг 6 гадагш холболт хүлээх боломжтой. */
const CONCURRENCY = 6;
/** Нэг хүнд нэг sweep-д үүнээс олон мэдэгдэл ногдвол нэг болгон нэгтгэнэ. */
const MAX_PER_USER_PER_SWEEP = 3;
const FAILURE_DELETE_THRESHOLD = 10;
/** Уншсан, хуучирсан мэдэгдлийг цэвэрлэх хугацаа. */
const PRUNE_DAYS = 90;
const PRUNE_BATCH = 1000;
/** D1-ийн нэг statement-д зөвшөөрөгдөх bind параметрийн дээд тоо. */
const BIND_CHUNK = 100;
/** Цагт нэг удаа цэвэрлэнэ — cron минут тутам ажилладаг тул минутаар хаалт. */
const PRUNE_MINUTE = 17;

/* ------------------------------------------------------------------ */
/*  Туслахууд                                                          */
/* ------------------------------------------------------------------ */

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function placeholders(n: number): string {
  return new Array(n).fill('?').join(',');
}

/** Гараар бичсэн concurrency pool — Promise.all нь бүх хүсэлтийг нэг дор
 *  нээж Workers-ийн холболтын хязгаарт мөргөнө. */
async function runPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    workers.push(
      (async () => {
        for (;;) {
          const idx = cursor++;
          if (idx >= items.length) return;
          const item = items[idx];
          if (item === undefined) continue;
          await fn(item);
        }
      })(),
    );
  }
  await Promise.all(workers);
}

/* ------------------------------------------------------------------ */
/*  Sweep                                                              */
/* ------------------------------------------------------------------ */

interface QueuedNotification {
  id: number;
  user_id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
}

interface SubRow {
  id: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  push_prefs: string | null;
}

interface PushJob {
  sub: PushSubscriptionRecord;
  payload: PushPayload;
}

export interface PushSweepStats {
  scanned: number;
  sent: number;
  dropped: number;
  failed: number;
}

/**
 * Нэг cron sweep.  ХЭЗЭЭ Ч шидэхгүй — дуудагч нь `ctx.waitUntil` тул
 * шидсэн алдаа чимээгүй алга болно.
 */
export async function sweepPushNotifications(env: Env): Promise<PushSweepStats> {
  const stats: PushSweepStats = { scanned: 0, sent: 0, dropped: 0, failed: 0 };
  if (!vapidConfigured(env)) return stats;

  const startedAt = Date.now();
  try {
    await runSweep(env, stats);
  } catch (err) {
    // ХЭЗЭЭ Ч дахин шидэхгүй — `ctx.waitUntil` дотор шидсэн алдаа
    // хаана ч гарч ирэхгүй чимээгүй алга болно.
    console.error('[push-sweep] failed', err);
  }

  // Cron минут тутам ажилладаг тул хоосон гүйлт бүрийг бичвэл өдөрт 1440
  // утгагүй мөр хуримтлагдана — ажил хийсэн үед л логдоно.
  if (stats.scanned > 0) {
    console.log(
      `[push-sweep] scanned=${stats.scanned} sent=${stats.sent} dropped=${stats.dropped} failed=${stats.failed} ms=${Date.now() - startedAt}`,
    );
  }
  return stats;
}

/** Sweep-ийн бодит бие.  Алдаа шидэж болно — дуудагч нь барьж, статистик
 *  ба лог мөрийг ямар ч гарцад нэг л газраас бичнэ. */
async function runSweep(env: Env, stats: PushSweepStats): Promise<void> {
  const db = env.DB;

  // 1) Хоцорсон дараалал.  `created_at IS NULL` салаа ЗААВАЛ хэрэгтэй:
  //    тухайн багана nullable бөгөөд SQL-д `NULL < x` нь NULL (үнэн биш)
  //    тул огноогүй мөрүүд дараалалд мөнхөд гацна.
  await db
    .prepare(
      `UPDATE notifications SET pushed = 1
        WHERE pushed = 0
          AND (created_at IS NULL OR created_at < datetime('now', '-${STALE_MINUTES} minutes'))`,
    )
    .run();

  // 2) Илгээх ээлж.
  const { results: queued } = await db
    .prepare(
      `SELECT id, user_id, type, title, body, link
         FROM notifications
        WHERE pushed = 0
        ORDER BY id
        LIMIT ${MAX_NOTIFICATIONS_PER_SWEEP}`,
    )
    .all<QueuedNotification>();

  stats.scanned = queued.length;
  if (queued.length === 0) {
    await pruneOldNotifications(db);
    return;
  }

  // 3) Илгээхээс ӨМНӨ тэмдэглэнэ (at-most-once — файлын толгойн тайлбар).
  const markStmts = chunk(
    queued.map((n) => n.id),
    BIND_CHUNK,
  ).map((ids) =>
    db
      .prepare(`UPDATE notifications SET pushed = 1 WHERE id IN (${placeholders(ids.length)})`)
      .bind(...ids),
  );
  if (markStmts.length > 0) await db.batch(markStmts);

  // 4) Тухайн хэрэглэгчдийн идэвхтэй төхөөрөмжүүд + тохиргоо.
  const userIds = [...new Set(queued.map((n) => n.user_id))];
  const subs: SubRow[] = [];
  for (const ids of chunk(userIds, BIND_CHUNK)) {
    const { results } = await db
      .prepare(
        `SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth, u.push_prefs
           FROM push_subscriptions s
           JOIN users u ON u.id = s.user_id
          WHERE s.user_id IN (${placeholders(ids.length)})
            AND u.status = 'active'`,
      )
      .bind(...ids)
      .all<SubRow>();
    subs.push(...results);
  }
  if (subs.length === 0) return;

  const subsByUser = new Map<number, SubRow[]>();
  for (const s of subs) {
    const list = subsByUser.get(s.user_id);
    if (list) list.push(s);
    else subsByUser.set(s.user_id, [s]);
  }

  // 5) Хэрэглэгч бүрийн мэдэгдлийг тохиргоогоор шүүнэ.  Төхөөрөмжгүй
  //    хүний мөрүүд аль хэдийн pushed = 1 тул дахин дараалалд орохгүй.
  const byUser = new Map<number, QueuedNotification[]>();
  for (const n of queued) {
    const userSubs = subsByUser.get(n.user_id);
    if (!userSubs || userSubs.length === 0) continue;
    const cat = CATEGORY_OF[n.type as NotificationType] as PushCategory | undefined;
    if (!cat) continue; // DB-д кодод байхгүй төрөл байвал алгасна
    const prefs = resolvePrefs(userSubs[0]?.push_prefs);
    if (!prefs[cat]) continue;
    const list = byUser.get(n.user_id);
    if (list) list.push(n);
    else byUser.set(n.user_id, [n]);
  }

  // 5b) Аппын икон дээрх ЖИНХЭНЭ уншаагүй тоо.
  //
  // Энэ нь SW-ийн `setAppBadge()`-д очдог тул зөв байх ёстой: энэ sweep-ийн
  // багцын хэмжээг ашиглавал (жишээ нь 4) хэрэглэгчид 12 уншаагүй байхад
  // икон дээр 4 гэж худал харуулна.  Нэг нэмэлт query — sweep-ийн ~12
  // query-ийн төсөвт багтана.
  const unreadByUser = new Map<number, number>();
  const recipientIds = [...byUser.keys()];
  for (const ids of chunk(recipientIds, BIND_CHUNK)) {
    const { results } = await db
      .prepare(
        `SELECT user_id, COUNT(*) AS c
           FROM notifications
          WHERE read = 0 AND user_id IN (${placeholders(ids.length)})
          GROUP BY user_id`,
      )
      .bind(...ids)
      .all<{ user_id: number; c: number }>();
    for (const row of results) unreadByUser.set(row.user_id, row.c);
  }

  // 6) Payload-ууд — олон бол нэг «нэгтгэсэн» мэдэгдэл болгоно.
  const jobs: PushJob[] = [];
  outer: for (const [userId, notes] of byUser) {
    const userSubs = subsByUser.get(userId) ?? [];
    const unread = unreadByUser.get(userId);
    const payloads: PushPayload[] = [];
    if (notes.length > MAX_PER_USER_PER_SWEEP) {
      const newest = notes[notes.length - 1]!;
      payloads.push({
        title: newest.title,
        body: `+${notes.length - 1} бусад мэдэгдэл`,
        link: newest.link ?? '/app',
        tag: `mgl-sum-${userId}`,
        unread,
      });
    } else {
      for (const n of notes) {
        payloads.push({
          title: n.title,
          body: n.body,
          link: n.link,
          tag: `mgl-n${n.id}`,
          type: n.type,
          id: n.id,
          unread,
        });
      }
    }
    for (const payload of payloads) {
      for (const sub of userSubs) {
        if (jobs.length >= MAX_PUSHES_PER_SWEEP) break outer;
        jobs.push({
          sub: { id: sub.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          payload,
        });
      }
    }
  }
  if (jobs.length === 0) {
    await pruneOldNotifications(db);
    return;
  }

  // 7) Илгээлт — 6 зэрэгцээ.  429 өгсөн push service-ийн үлдсэн хүсэлтийг
  //    энэ sweep-д огт оролдохгүй (дараагийн минутад дахин үзнэ).
  const dropIds = new Set<number>();
  const retryIds = new Set<number>();
  const okIds = new Set<number>();
  const throttledOrigins = new Set<string>();

  await runPool(jobs, CONCURRENCY, async (job) => {
    let origin = '';
    try {
      origin = new URL(job.sub.endpoint).origin;
    } catch {
      // Гажсан endpoint — дахин ажиллахгүй тул устгана.
      dropIds.add(job.sub.id);
      stats.dropped++;
      return;
    }
    if (throttledOrigins.has(origin)) {
      stats.failed++;
      return;
    }
    try {
      const res = await sendWebPush(env, job.sub, job.payload);
      if (res.ok) {
        okIds.add(job.sub.id);
        stats.sent++;
        return;
      }
      if (res.status === 429) throttledOrigins.add(origin);
      if (res.action === 'drop') {
        dropIds.add(job.sub.id);
        stats.dropped++;
      } else if (res.action === 'retry') {
        retryIds.add(job.sub.id);
        stats.failed++;
      } else {
        // 'ignore' | 'config' — subscription буруугүй, тоолуур хөдөлгөхгүй.
        stats.failed++;
      }
    } catch (err) {
      // Даалгавар бүр өөрийн алдааг барина — нэг нь унаснаас pool зогсохгүй.
      console.error('[push-sweep] job failed', err);
      stats.failed++;
    }
  });

  // 8) Хажуугийн үр дагаврыг нэг batch-д.  Устгасныг нэмэгдүүлэх/тэглэх
  //    жагсаалтаас хасна.
  for (const id of dropIds) {
    retryIds.delete(id);
    okIds.delete(id);
  }
  const effects: D1PreparedStatement[] = [];
  for (const ids of chunk([...dropIds], BIND_CHUNK)) {
    effects.push(
      db
        .prepare(`DELETE FROM push_subscriptions WHERE id IN (${placeholders(ids.length)})`)
        .bind(...ids),
    );
  }
  for (const ids of chunk([...retryIds], BIND_CHUNK)) {
    effects.push(
      db
        .prepare(
          `UPDATE push_subscriptions SET failure_count = failure_count + 1
            WHERE id IN (${placeholders(ids.length)})`,
        )
        .bind(...ids),
    );
  }
  if (retryIds.size > 0) {
    effects.push(
      db.prepare(
        `DELETE FROM push_subscriptions WHERE failure_count >= ${FAILURE_DELETE_THRESHOLD}`,
      ),
    );
  }
  for (const ids of chunk([...okIds], BIND_CHUNK)) {
    effects.push(
      db
        .prepare(
          `UPDATE push_subscriptions SET last_used_at = datetime('now'), failure_count = 0
            WHERE id IN (${placeholders(ids.length)})`,
        )
        .bind(...ids),
    );
  }
  if (effects.length > 0) await db.batch(effects);

  // 9) Цагт нэг удаагийн цэвэрлэгээ.
  await pruneOldNotifications(db);
}

/**
 * Уншсан, 90 хоногоос хуучин мэдэгдлийг багцаар устгана — цагт нэг удаа.
 * D1/SQLite-д `DELETE ... LIMIT` байхгүй тул дэд query-гээр хязгаарлана.
 */
async function pruneOldNotifications(db: D1Database): Promise<void> {
  if (new Date().getUTCMinutes() !== PRUNE_MINUTE) return;
  try {
    await db
      .prepare(
        `DELETE FROM notifications
          WHERE id IN (
            SELECT id FROM notifications
             WHERE read = 1
               AND created_at IS NOT NULL
               AND created_at < datetime('now', '-${PRUNE_DAYS} days')
             ORDER BY id
             LIMIT ${PRUNE_BATCH}
          )`,
      )
      .run();
  } catch (err) {
    console.error('[push-sweep] prune failed', err);
  }
}
