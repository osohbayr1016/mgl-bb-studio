/**
 * Толгойн гүйдэг зурвас (ticker) — `GET /api/ticker`
 * ---------------------------------------------------------------------
 * Аппын толгойн голд гүйдэг богино мэдээллийн мөрүүдийг угсарна.  Толгой
 * нь `/app/*` БҮХ хуудсанд, БҮХ ролийн хүнд харагддаг тул энэ гарц нь
 * дуудагчийн ролийг харгалзан ӨӨР багц буцаана.
 *
 * ⚠️ РОЛИЙН ХИЛ.  Эрсдэлийн мөрүүд (хугацаа хэтэрсэн / хөдөлгөөнгүй төсөл)
 *    нь `/api/timeline`-ийн өгөгдөл бөгөөд тэр гарц `admin` + `senior`-оос
 *    бусдад 403 өгдөг.  Тиймээс энд ч ижил хил тавина — эс бөгөөс инженер
 *    толгойноосоо л удирдлагын мэдээллийг уншина.
 *
 * ⚠️ EDGE CACHE ЗОРИУДААР БАЙХГҮЙ.  Хариу нь ролиос хамаарч өөр тул
 *    `withEdgeCache` нь нэг ролийн хариуг нөгөөд өгөх эрсдэлтэй
 *    (lib/edgeCache.ts-ийн тайлбарыг үз — хэрэглэгчээр хуваагдсан хариуг
 *    кэшлэх нь энэ репод мэдэгдэж буй онгорхой хавх).  Оронд нь клиент тал
 *    TanStack Query-ийн `staleTime`-аар 60 секунд барина.
 *
 * ⚠️ ХЭЗЭЭ Ч 500 БУЦААХГҮЙ.  Энэ бол чимэглэл — нэг дэд асуулга уначихвал
 *    тэр мөр л дутна, толгой бүхэлдээ эвдрэхгүй.  Тиймээс мөр бүрийн
 *    асуулга ТУСДАА `safe()`-д ороосон.
 *
 * ЛОКАЛЧЛАЛ: сервер бэлэн ӨГҮҮЛБЭР буцаахгүй — `textKey` + `params`
 * буцаана.  Орчуулга нь frontend-ийн `mn.json` / `en.json`-д амьдарна
 * (аппын бусад хэсэгтэй ижил).
 */
import { Hono, type Context } from 'hono';
import { projectLastActivitySql } from '../lib/progressLatest';
import { withEdgeCache, bustEdgeCache } from '../lib/edgeCache';

import { requireAdmin } from '../middleware/auth';

import type { Env, AppVariables } from '../types';
import { todayInUB } from '../lib/time';
import { diffDays, isIsoDate, STALE_DAYS } from '../lib/projectRisk';
import { leaderboardMemberSql } from '../lib/ceo';
import { attendanceRosterSql } from '../lib/attendanceRoster';
import { NOT_ASR_ONLY_SQL } from '../lib/asrEligible';

const ticker = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** Толгойн зурваст нэг удаад харуулах дээд хязгаар.
 *  10 → 14 (2026-09-04): админы бичсэн мэдээ нэмэгдсэн тул суурин мөрүүд
 *  тэднээс болж чимээгүй унах ёсгүй.  Гүйдэг зурвас тул урт нь хэрэглэгчийн
 *  дэлгэцийг эзэлдэггүй — зөвхөн нэг эргэлтийн хугацааг уртасгана. */
const MAX_ITEMS = 14;

export type TickerTone = 'danger' | 'warning' | 'success' | 'info' | 'default';

export interface TickerItem {
  /** Тогтвортой түлхүүр — React-ийн `key` болон дараалал тогтооход. */
  id: string;
  tone: TickerTone;
  /** Богино шошго (`AnnouncementTag`) — орчуулгын түлхүүр. */
  tagKey: string;
  /** Үндсэн текст — орчуулгын түлхүүр. */
  textKey: string;
  /** `textKey`-ийн `{placeholder}`-уудад орох утгууд. */
  params?: Record<string, string | number>;
  /** Дарахад очих хаяг (аппын доторх зам). */
  href?: string;
  /* ── Админаас ирсэн ШУУД текст (`ticker_messages` / `ticker_builtin_prefs`) ──
   * Байвал `textKey`/`tagKey`-ийн ОРОНД хэрэглэнэ.  Орчуулгын түлхүүр биш,
   * бэлэн өгүүлбэр тул ХОЁР хэлээр явна — frontend `pickLocalized`-оор
   * сонгоод `{placeholder}`-уудыг нь өөрөө бөглөнө. */
  /** Монгол шууд текст. */
  text?: string;
  /** Англи шууд текст (хоосон бол монголоороо харагдана). */
  textEn?: string;
  /** Монгол шууд шошго. */
  tag?: string;
  /** Англи шууд шошго. */
  tagEn?: string;
}

/**
 * Нэг мөрийн асуулгыг тусгаарлана.  Уначихвал `null` буцаана — дуудагч
 * `.filter(Boolean)`-оор хаяна.  Ticker-ийн нэг мөрийн төлөө толгойг
 * унагаах нь утгагүй.
 */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/** «Огноо мэт харагдах уу» — паспортын огноо нь ЧӨЛӨӨТ ТЕКСТ ('-' бодитоор
 *  таарна) тул задлахын өмнө шалгана. */
function isoOrNull(v: unknown): string | null {
  return isIsoDate(v) ? v : null;
}

/* ================================================================== *
 *  АДМИНЫ ДАВХАРГА (migration 0255)                                   *
 *                                                                     *
 *  Дээрх ес нь ӨГӨГДЛӨӨС угсрагддаг тул DB-д мөр байхгүй.  Админ      *
 *  тэднийг унтраах / текст-шошго-өнгийг нь дарж бичих боломжтой болгох *
 *  ба өөрийн ЧӨЛӨӨТ зарлал нэмэхийн тулд хоёр хүснэгт нэмэгдсэн:      *
 *  `ticker_builtin_prefs` (суурин мөрийн тохиргоо) ба                 *
 *  `ticker_messages` (гараар бичсэн мөр).                             *
 * ================================================================== */

/**
 * Суурин мөрүүдийн түлхүүр — ДЭЭРХ `items.push({ id: … })`-ийн ТОЛЬ.
 *
 * ⚠️ ТВИН: мөр нэмэх/хасахдаа энэ жагсаалт болон `BUILTIN_DEFAULTS`-ыг
 *    ЗЭРЭГ засна (`Record<BuiltinKey, …>` тул мартвал TypeScript хэлнэ).
 *    Энд байхгүй `id`-тай мөр ажиллах ЧАДНА — зүгээр л админд харагдахгүй,
 *    эрэмбийн өгөгдмөл нь 500 болно.
 *
 * Дараалал нь өгөгдмөл эрэмбийг ЗААНА: индекс × 10 + 10 (10, 20, … 90).
 * Админы шинэ зарлал 0 авдаг тул автоматаар тэргүүнд гүйнэ.
 */
const BUILTIN_KEYS = [
  'attendance',
  'earliest',
  'event',
  'holiday',
  'leader',
  'oldest',
  'overdue',
  'stale',
  'dueSoon',
] as const;

export type BuiltinKey = (typeof BUILTIN_KEYS)[number];

/**
 * Суурин мөр бүрийн ӨГӨГДМӨЛ шошго/текст/өнгө — ЗӨВХӨН админы дэлгэц
 * дээр «юуг дарж бичих гэж байна» гэдгийг үзүүлэхэд хэрэглэнэ (гүйдэг
 * зурвас өөрөө дээрх `items.push`-оос шууд утгаа авна).
 *
 * ⚠️ Хоёр мөр нөхцөлөөс хамаарч ХОЁР түлхүүр ашигладаг (`holiday` →
 *    `holidayIn` / `holidayToday`, `overdue` → `overdueOne` /
 *    `overdueMany`).  Админ текстийг дарж бичвэл тэр нь ХОЁУЛАНГ нь
 *    орлоно — тиймээс `{n}`, `{count}` зэрэг орлуулагчийг болгоомжтой
 *    ашиглана (өнөөдөр баяр бол `{n}` нь 0 болно).
 */
const BUILTIN_DEFAULTS: Record<BuiltinKey, { tagKey: string; textKey: string; tone: TickerTone }> = {
  attendance: { tagKey: 'ticker.tagToday', textKey: 'ticker.attendance', tone: 'default' },
  earliest: { tagKey: 'ticker.tagPeople', textKey: 'ticker.earliest', tone: 'info' },
  event: { tagKey: 'ticker.tagToday', textKey: 'ticker.event', tone: 'info' },
  holiday: { tagKey: 'ticker.tagToday', textKey: 'ticker.holidayIn', tone: 'success' },
  leader: { tagKey: 'ticker.tagPeople', textKey: 'ticker.leader', tone: 'success' },
  oldest: { tagKey: 'ticker.tagFun', textKey: 'ticker.oldest', tone: 'warning' },
  overdue: { tagKey: 'ticker.tagRisk', textKey: 'ticker.overdueOne', tone: 'danger' },
  stale: { tagKey: 'ticker.tagRisk', textKey: 'ticker.stale', tone: 'warning' },
  dueSoon: { tagKey: 'ticker.tagRisk', textKey: 'ticker.dueSoon', tone: 'warning' },
};

/** Суурин мөрийн өгөгдмөл эрэмбэ (тохиргоо байхгүй үед). */
function defaultRank(key: string): number {
  const i = (BUILTIN_KEYS as readonly string[]).indexOf(key);
  return i < 0 ? 500 : (i + 1) * 10;
}

const TONES: readonly TickerTone[] = ['danger', 'warning', 'success', 'info', 'default'];
const isTone = (v: unknown): v is TickerTone => TONES.includes(v as TickerTone);

interface BuiltinPrefRow {
  key: string;
  is_active: number;
  text_mn: string | null;
  text_en: string | null;
  tag_mn: string | null;
  tag_en: string | null;
  tone: string | null;
  sort_order: number | null;
}

export interface TickerMessageRow {
  id: number;
  text_mn: string;
  text_en: string | null;
  tag_mn: string | null;
  tag_en: string | null;
  tone: string;
  href: string | null;
  is_active: number;
  starts_on: string | null;
  ends_on: string | null;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
}

const PREF_COLS = `key, is_active, text_mn, text_en, tag_mn, tag_en, tone, sort_order`;
const MSG_COLS = `id, text_mn, text_en, tag_mn, tag_en, tone, href, is_active,
                  starts_on, ends_on, sort_order, created_at, updated_at`;

/**
 * Суурин мөрүүд дээр админы давхаргыг нааж, гараар бичсэн зарлалуудтай
 * НЭГ эрэмбийн орон зайд нийлүүлнэ.
 *
 * • унтраасан суурин мөр — огт гарахгүй;
 * • дарж бичсэн текст — `textKey`-ийн ОРОНД `text`/`textEn` (шууд утга)
 *   болж явна (frontend орлуулагчийг нь өөрөө бөглөнө);
 * • эрэмбэ тэнцвэл ГАРААР бичсэн мөр урдаа орно.
 */
function withAdminLayer(
  builtins: TickerItem[],
  prefs: Map<string, BuiltinPrefRow>,
  messages: TickerMessageRow[],
): TickerItem[] {
  const ranked: { rank: number; seq: number; item: TickerItem }[] = [];

  messages.forEach((m, i) => {
    ranked.push({
      rank: m.sort_order,
      seq: i,
      item: {
        id: `msg-${m.id}`,
        tone: isTone(m.tone) ? m.tone : 'default',
        // Шошго хоосон бол «МЭДЭЭ» гэсэн өгөгдмөл түлхүүр рүү унана.
        tagKey: 'ticker.tagNews',
        textKey: '',
        text: m.text_mn,
        textEn: m.text_en ?? undefined,
        tag: m.tag_mn ?? undefined,
        tagEn: m.tag_en ?? undefined,
        href: m.href ?? undefined,
      },
    });
  });

  builtins.forEach((item) => {
    const p = prefs.get(item.id);
    if (p && p.is_active === 0) return;
    ranked.push({
      rank: p?.sort_order ?? defaultRank(item.id),
      // 1000+ → эрэмбэ тэнцвэл гараар бичсэн мөрийн ард орно.
      seq: 1000 + defaultRank(item.id),
      item: {
        ...item,
        tone: p && isTone(p.tone) ? p.tone : item.tone,
        text: p?.text_mn ?? undefined,
        textEn: p?.text_en ?? undefined,
        tag: p?.tag_mn ?? undefined,
        tagEn: p?.tag_en ?? undefined,
      },
    });
  });

  ranked.sort((a, b) => a.rank - b.rank || a.seq - b.seq);
  return ranked.map((r) => r.item).slice(0, MAX_ITEMS);
}


ticker.get('/', async (c) => {
  const user = c.var.user;
  const canSeeRisk = user.role === 'admin' || user.role === 'senior';
  // 2026-09-11 (D1 rows_read аудит): хариу нь ЗӨВХӨН `canSeeRisk`-ээс хамаардаг
  // (доорх бүх дэд асуулга хэрэглэгчийн id-г уншдаггүй) тул тэр хоёр хувилбарыг
  // ролийн бүлгээр ТУСДАА кэшлэнэ — толгойн тайлбар дахь «нэг ролийн хариуг
  // нөгөөд өгөх» эрсдэл варьирсан түлхүүрээр хаагдана.  Хэрэглэгч бүр 5 минут
  // тутам татдаг тул кэшгүйгээр нэг цагт 500+ удаа 13 000 мөр (өмнө нь 48 000)
  // уншиж байв; TTL 300 сек = хамгийн ихдээ цагт 12 удаа.
  return withEdgeCache(
    c,
    { key: 'ticker', varyTags: [canSeeRisk ? 'risk' : 'plain', todayInUB()], ttlSeconds: 300 },
    () => buildTicker(c, canSeeRisk),
  );
});

async function buildTicker(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  canSeeRisk: boolean,
): Promise<{ items: TickerItem[] }> {
  const db = c.env.DB;
  const today = todayInUB();

  const items: TickerItem[] = [];

  /* ── 1. Өнөөдрийн ирц — бүх ролид ───────────────────────────────── */
  const attendance = await safe(async () => {
    const [present, roster] = await Promise.all([
      db
        .prepare(
          `SELECT COUNT(DISTINCT a.user_id) AS n
             FROM attendance_sessions a
             JOIN users u ON u.id = a.user_id
            WHERE a.date = ? AND ${attendanceRosterSql('u')}`,
        )
        .bind(today)
        .first<{ n: number }>(),
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM users u WHERE ${attendanceRosterSql('u')}`,
        )
        .first<{ n: number }>(),
    ]);
    return { present: present?.n ?? 0, total: roster?.n ?? 0 };
  });
  if (attendance && attendance.total > 0) {
    items.push({
      id: 'attendance',
      tone: attendance.present >= attendance.total ? 'success' : 'default',
      tagKey: 'ticker.tagToday',
      textKey: 'ticker.attendance',
      params: { present: attendance.present, total: attendance.total },
      href: '/app/attendance',
    });
  }

  /* ── 2. Өнөөдрийн хамгийн эрт ирсэн хүн — бүх ролид ─────────────── */
  const earliest = await safe(() =>
    db
      .prepare(
        `SELECT u.full_name, a.clock_in
           FROM attendance_sessions a
           JOIN users u ON u.id = a.user_id
          WHERE a.date = ? AND u.role != 'client'
          ORDER BY a.clock_in ASC
          LIMIT 1`,
      )
      .bind(today)
      .first<{ full_name: string; clock_in: string }>(),
  );
  if (earliest?.full_name) {
    // `clock_in` нь ISO/`YYYY-MM-DD HH:MM:SS` хэлбэртэй — цаг:минутыг л авна.
    const hhmm = /(\d{2}:\d{2})/.exec(earliest.clock_in)?.[1] ?? '';
    if (hhmm) {
      items.push({
        id: 'earliest',
        tone: 'info',
        tagKey: 'ticker.tagPeople',
        textKey: 'ticker.earliest',
        params: { name: earliest.full_name, time: hhmm },
      });
    }
  }

  /* ── 3. Өнөөдрийн арга хэмжээ — бүх ролид ───────────────────────── */
  const event = await safe(() =>
    db
      .prepare(
        `SELECT title, priority FROM calendar_events
          WHERE event_date = ?
          ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, id
          LIMIT 1`,
      )
      .bind(today)
      .first<{ title: string; priority: string }>(),
  );
  if (event?.title) {
    items.push({
      id: 'event',
      tone: event.priority === 'urgent' ? 'danger' : 'info',
      tagKey: 'ticker.tagToday',
      textKey: 'ticker.event',
      params: { title: event.title },
      href: '/app',
    });
  }

  /* ── 4. Дараагийн баяр — бүх ролид ──────────────────────────────── */
  const holiday = await safe(() =>
    db
      .prepare(`SELECT date, name FROM holidays WHERE date >= ? ORDER BY date LIMIT 1`)
      .bind(today)
      .first<{ date: string; name: string }>(),
  );
  if (holiday?.date) {
    const n = diffDays(today, holiday.date);
    items.push({
      id: 'holiday',
      tone: 'success',
      tagKey: 'ticker.tagToday',
      textKey: n <= 0 ? 'ticker.holidayToday' : 'ticker.holidayIn',
      params: { name: holiday.name, n },
    });
  }

  /* ── 5. Энэ сарын тэргүүлэгч — бүх ролид ────────────────────────── */
  // `leaderboardMemberSql` нь client/admin/worker-ийг өөрөө хасна (оноо
  // зөвхөн engineer/architect/senior + CEO-д хуримтлагддаг).
  const leader = await safe(() =>
    db
      .prepare(
        `SELECT u.full_name, SUM(p.amount) AS pts
           FROM user_points p
           JOIN users u ON u.id = p.user_id
          WHERE p.created_at >= ? AND ${leaderboardMemberSql('u', true)}
          GROUP BY p.user_id
          ORDER BY pts DESC
          LIMIT 1`,
      )
      .bind(`${today.slice(0, 7)}-01`)
      .first<{ full_name: string; pts: number }>(),
  );
  if (leader?.full_name && leader.pts > 0) {
    items.push({
      id: 'leader',
      tone: 'success',
      tagKey: 'ticker.tagPeople',
      textKey: 'ticker.leader',
      params: { name: leader.full_name, points: Math.round(leader.pts * 10) / 10 },
      href: '/app/leaderboard',
    });
  }

  /* ── 6. Хамгийн удаан амьдарсан төсөл — «хөгжилтэй» мөр ─────────── */
  const oldest = await safe(() =>
    db
      .prepare(
        `SELECT p.name, p.display_title, pp.start_date
           FROM projects p
           JOIN project_passport pp ON pp.project_id = p.id
          WHERE p.status = 'active' AND pp.start_date IS NOT NULL
            AND ${NOT_ASR_ONLY_SQL}
          ORDER BY pp.start_date ASC
          LIMIT 5`,
      )
      .all<{ name: string; display_title: string | null; start_date: string }>(),
  );
  // SQL-ээр шүүхгүй — `start_date` нь чөлөөт текст тул эхний 5-аас
  // ЖИНХЭНЭ огноотойг нь JS талд олно.
  const oldestRow = (oldest?.results ?? []).find((r) => isoOrNull(r.start_date));
  if (oldestRow) {
    const days = diffDays(oldestRow.start_date, today);
    if (days > 365) {
      items.push({
        id: 'oldest',
        tone: 'warning',
        tagKey: 'ticker.tagFun',
        textKey: 'ticker.oldest',
        params: { name: oldestRow.display_title?.trim() || oldestRow.name, n: days },
      });
    }
  }

  /* ── 7-9. Эрсдэл — ЗӨВХӨН admin + senior ────────────────────────── */
  if (canSeeRisk) {
    const activity = await safe(() =>
      db
        .prepare(
          // 2026-09-11: 48 223 → 9 890 мөр (lib/progressLatest.ts).
          projectLastActivitySql(true),
        )
        .all<{ project_id: number; last_activity_at: string }>(),
    );
    const projects = await safe(() =>
      db
        .prepare(
          `SELECT p.id, p.name, p.display_title, pp.finish_date
             FROM projects p
             LEFT JOIN project_passport pp ON pp.project_id = p.id
            WHERE p.status = 'active' AND ${NOT_ASR_ONLY_SQL}`,
        )
        .all<{
          id: number;
          name: string;
          display_title: string | null;
          finish_date: string | null;
        }>(),
    );

    const rows = projects?.results ?? [];
    const lastById = new Map<number, string>();
    for (const a of activity?.results ?? []) lastById.set(a.project_id, a.last_activity_at);

    // (a) Хамгийн удаан хөдөлгөөнгүй төсөл.
    let worstStale: { title: string; days: number } | null = null;
    // (b) Хамгийн их хэтэрсэн + хэтэрсэн тоо.
    let worstOverdue: { title: string; days: number } | null = null;
    let overdueCount = 0;
    // (c) 7 хоногийн дотор дуусах тоо.
    let dueSoon = 0;

    for (const r of rows) {
      const title = r.display_title?.trim() || r.name;

      const last = lastById.get(r.id);
      const lastIso = last ? last.slice(0, 10) : null;
      if (isoOrNull(lastIso)) {
        const idle = diffDays(lastIso as string, today);
        if (idle >= STALE_DAYS && (!worstStale || idle > worstStale.days)) {
          worstStale = { title, days: idle };
        }
      }

      const finish = isoOrNull(r.finish_date);
      if (finish) {
        const left = diffDays(today, finish);
        if (left < 0) {
          overdueCount += 1;
          const over = Math.abs(left);
          if (!worstOverdue || over > worstOverdue.days) worstOverdue = { title, days: over };
        } else if (left <= 7) {
          dueSoon += 1;
        }
      }
    }

    if (worstOverdue) {
      items.push({
        id: 'overdue',
        tone: 'danger',
        tagKey: 'ticker.tagRisk',
        textKey: overdueCount > 1 ? 'ticker.overdueMany' : 'ticker.overdueOne',
        params: { name: worstOverdue.title, n: worstOverdue.days, count: overdueCount - 1 },
        href: '/app/timeline',
      });
    }
    if (worstStale) {
      items.push({
        id: 'stale',
        tone: 'warning',
        tagKey: 'ticker.tagRisk',
        textKey: 'ticker.stale',
        params: { name: worstStale.title, n: worstStale.days },
        href: '/app/timeline',
      });
    }
    if (dueSoon > 0) {
      items.push({
        id: 'dueSoon',
        tone: 'warning',
        tagKey: 'ticker.tagRisk',
        textKey: 'ticker.dueSoon',
        params: { n: dueSoon },
        href: '/app/timeline',
      });
    }
  }

  /* ── 10. Админы давхарга — тохиргоо + гараар бичсэн мэдээ ────────
   *  Хоёулаа `safe()`-д: энэ хүснэгтүүд байхгүй (миграц ороогүй) орчинд
   *  зурвас ХУУЧНААРАА ажиллана. */
  const prefRows = await safe(() =>
    db.prepare(`SELECT ${PREF_COLS} FROM ticker_builtin_prefs`).all<BuiltinPrefRow>(),
  );
  const msgRows = await safe(() =>
    db
      .prepare(
        `SELECT ${MSG_COLS} FROM ticker_messages
          WHERE is_active = 1
            AND (starts_on IS NULL OR starts_on <= ?)
            AND (ends_on IS NULL OR ends_on >= ?)
          ORDER BY sort_order, id`,
      )
      .bind(today, today)
      .all<TickerMessageRow>(),
  );

  const prefs = new Map((prefRows?.results ?? []).map((r) => [r.key, r] as const));
  return { items: withAdminLayer(items, prefs, msgRows?.results ?? []) };
}

/* ================================================================== *
 *  АДМИН CRUD — `/api/ticker/admin/*`  (ЗӨВХӨН admin)                 *
 *                                                                     *
 *  Frontend: Тохиргоо → «Гүйдэг мэдээ» (`features/ticker/TickerAdminCard`). *
 *  Бүх зам `/admin`-аар эхэлдэг тул дээрх `GET /`-тэй мөргөлдөхгүй.    *
 * ================================================================== */

const TEXT_MAX = 200;
const TAG_MAX = 24;
const HREF_MAX = 200;
/** Хэт олон мөр толгойг «мэдээний хана» болгоно — зохиомжийн хязгаар. */
const MESSAGES_MAX = 40;

const hasField = (body: Record<string, unknown>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(body, k);

/** Хоосон/зайг NULL болгоно (өгөгдмөл рүү буцаах = хоосон утга илгээх). */
function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

/**
 * ЗӨВХӨН аппын дотоод зам.  `<Link to>` нь `//evil.com`-ыг гадаад URL
 * болгон дагадаг тул хоёр ташуу зураасыг энд таслана.
 */
function cleanHref(v: unknown): string | null {
  const s = cleanText(v, HREF_MAX);
  if (!s) return null;
  if (!s.startsWith('/') || s.startsWith('//')) return null;
  return s;
}

/** `undefined` = буруу хэлбэр (400), `null` = хоосолсон. */
function cleanDate(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return undefined;
  return v.trim();
}

function cleanRank(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(-999, Math.min(999, Math.round(n)));
}

interface PatchPlan {
  sets: string[];
  binds: (string | number | null)[];
}

/** Хэсэгчилсэн засварыг цагаан жагсаалтаар SQL болгоно. */
function buildMessagePatch(body: Record<string, unknown>): PatchPlan | { error: string } {
  const sets: string[] = [];
  const binds: (string | number | null)[] = [];

  if (hasField(body, 'text_mn')) {
    const v = cleanText(body.text_mn, TEXT_MAX);
    if (!v) return { error: 'Мэдээний текст хоосон байж болохгүй' };
    sets.push('text_mn = ?');
    binds.push(v);
  }
  if (hasField(body, 'text_en')) {
    sets.push('text_en = ?');
    binds.push(cleanText(body.text_en, TEXT_MAX));
  }
  for (const k of ['tag_mn', 'tag_en'] as const) {
    if (!hasField(body, k)) continue;
    sets.push(k + ' = ?');
    binds.push(cleanText(body[k], TAG_MAX));
  }
  if (hasField(body, 'tone')) {
    if (!isTone(body.tone)) return { error: 'Өнгө буруу' };
    sets.push('tone = ?');
    binds.push(body.tone);
  }
  if (hasField(body, 'href')) {
    sets.push('href = ?');
    binds.push(cleanHref(body.href));
  }
  if (hasField(body, 'is_active')) {
    sets.push('is_active = ?');
    binds.push(body.is_active ? 1 : 0);
  }
  for (const k of ['starts_on', 'ends_on'] as const) {
    if (!hasField(body, k)) continue;
    const v = cleanDate(body[k]);
    if (v === undefined) return { error: 'Огноо yyyy-mm-dd хэлбэртэй байх ёстой' };
    sets.push(k + ' = ?');
    binds.push(v);
  }
  if (hasField(body, 'sort_order')) {
    sets.push('sort_order = ?');
    binds.push(cleanRank(body.sort_order) ?? 0);
  }
  return { sets, binds };
}

/**
 * GET /api/ticker/admin — админы дэлгэцийн БҮХ өгөгдөл нэг дуудлагаар.
 *
 * `builtins` нь суурин мөр бүрийн ХҮЧИН ТӨГӨЛДӨР утгыг (тохиргоо +
 * өгөгдмөл) буцаана; `*_mn` / `*_en` NULL байвал «дараагүй» гэсэн үг тул
 * frontend өгөгдмөл орчуулгыг нь харуулна.
 */
/** Админы өөрчлөлт толгойд ШУУД харагдах — хоёр ролийн бүлгийн кэшийг хамт хаяна. */
async function bustTicker(c: Context<{ Bindings: Env; Variables: AppVariables }>): Promise<void> {
  const today = todayInUB();
  await bustEdgeCache(c, { key: 'ticker', varyTags: ['risk', today] });
  await bustEdgeCache(c, { key: 'ticker', varyTags: ['plain', today] });
}

ticker.get('/admin', requireAdmin(), async (c) => {
  const db = c.env.DB;
  const [prefRes, msgRes] = await Promise.all([
    db.prepare(`SELECT ${PREF_COLS} FROM ticker_builtin_prefs`).all<BuiltinPrefRow>(),
    db
      .prepare(`SELECT ${MSG_COLS} FROM ticker_messages ORDER BY sort_order, id`)
      .all<TickerMessageRow>(),
  ]);

  const prefs = new Map((prefRes.results ?? []).map((r) => [r.key, r] as const));

  return c.json({
    builtins: BUILTIN_KEYS.map((key) => {
      const p = prefs.get(key);
      const d = BUILTIN_DEFAULTS[key];
      return {
        key,
        default_tag_key: d.tagKey,
        default_text_key: d.textKey,
        default_tone: d.tone,
        is_active: p ? p.is_active : 1,
        text_mn: p?.text_mn ?? null,
        text_en: p?.text_en ?? null,
        tag_mn: p?.tag_mn ?? null,
        tag_en: p?.tag_en ?? null,
        tone: p?.tone ?? null,
        sort_order: p?.sort_order ?? defaultRank(key),
      };
    }),
    messages: msgRes.results ?? [],
  });
});

/** POST /api/ticker/admin/messages — шинэ мэдээ. */
// Админы бүх мутаци (POST/PATCH/DELETE) → хариу гарахын өмнө ticker кэшийг хаяна.
ticker.use('/admin/*', async (c, next) => {
  await next();
  if (c.req.method !== 'GET' && c.res.status < 400) await bustTicker(c);
});

ticker.post('/admin/messages', requireAdmin(), async (c) => {
  const db = c.env.DB;
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);

  const text = cleanText(body.text_mn, TEXT_MAX);
  if (!text) return c.json({ error: 'Мэдээний текст шаардлагатай' }, 400);
  if (hasField(body, 'tone') && !isTone(body.tone)) {
    return c.json({ error: 'Өнгө буруу' }, 400);
  }
  const startsOn = cleanDate(body.starts_on);
  const endsOn = cleanDate(body.ends_on);
  if (startsOn === undefined || endsOn === undefined) {
    return c.json({ error: 'Огноо yyyy-mm-dd хэлбэртэй байх ёстой' }, 400);
  }

  const count = await db.prepare(`SELECT COUNT(*) AS n FROM ticker_messages`).first<{ n: number }>();
  if ((count?.n ?? 0) >= MESSAGES_MAX) {
    return c.json({ error: `Хамгийн ихдээ ${MESSAGES_MAX} мэдээ хадгална` }, 409);
  }

  const user = c.get('user');
  const res = await db
    .prepare(
      `INSERT INTO ticker_messages
         (text_mn, text_en, tag_mn, tag_en, tone, href, is_active, starts_on, ends_on, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      text,
      cleanText(body.text_en, TEXT_MAX),
      cleanText(body.tag_mn, TAG_MAX),
      cleanText(body.tag_en, TAG_MAX),
      isTone(body.tone) ? body.tone : 'default',
      cleanHref(body.href),
      hasField(body, 'is_active') && !body.is_active ? 0 : 1,
      startsOn,
      endsOn,
      cleanRank(body.sort_order) ?? 0,
      user.sub,
    )
    .run();

  const row = await db
    .prepare(`SELECT ${MSG_COLS} FROM ticker_messages WHERE id = ?`)
    .bind(res.meta.last_row_id)
    .first<TickerMessageRow>();
  return c.json({ message: row }, 201);
});

/** PATCH /api/ticker/admin/messages/:id — хэсэгчилсэн засвар. */
ticker.patch('/admin/messages/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'id буруу' }, 400);

  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  const plan = buildMessagePatch(body);
  if ('error' in plan) return c.json({ error: plan.error }, 400);
  if (plan.sets.length === 0) return c.json({ error: 'Засах талбар алга' }, 400);

  const res = await c.env.DB.prepare(
    `UPDATE ticker_messages SET ${plan.sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(...plan.binds, id)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'Мэдээ олдсонгүй' }, 404);

  const row = await c.env.DB.prepare(`SELECT ${MSG_COLS} FROM ticker_messages WHERE id = ?`)
    .bind(id)
    .first<TickerMessageRow>();
  return c.json({ message: row });
});

/** DELETE /api/ticker/admin/messages/:id */
ticker.delete('/admin/messages/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'id буруу' }, 400);
  const res = await c.env.DB.prepare(`DELETE FROM ticker_messages WHERE id = ?`).bind(id).run();
  if (res.meta.changes === 0) return c.json({ error: 'Мэдээ олдсонгүй' }, 404);
  return c.json({ ok: true });
});

/**
 * PATCH /api/ticker/admin/builtin/:key — суурин мөрийн тохиргоо (upsert).
 *
 * Ирээгүй талбар ХЭВЭЭР үлдэнэ; хоосон мөр (`""`) илгээх нь тухайн
 * даралтыг цуцалж өгөгдмөл рүү буцаана.
 */
ticker.patch('/admin/builtin/:key', requireAdmin(), async (c) => {
  const key = c.req.param('key');
  if (!(BUILTIN_KEYS as readonly string[]).includes(key)) {
    return c.json({ error: 'Түлхүүр олдсонгүй' }, 404);
  }
  const db = c.env.DB;
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);

  if (hasField(body, 'tone') && body.tone !== null && body.tone !== '' && !isTone(body.tone)) {
    return c.json({ error: 'Өнгө буруу' }, 400);
  }

  const cur = await db
    .prepare(`SELECT ${PREF_COLS} FROM ticker_builtin_prefs WHERE key = ?`)
    .bind(key)
    .first<BuiltinPrefRow>();

  const next = {
    is_active: hasField(body, 'is_active') ? (body.is_active ? 1 : 0) : (cur?.is_active ?? 1),
    text_mn: hasField(body, 'text_mn') ? cleanText(body.text_mn, TEXT_MAX) : (cur?.text_mn ?? null),
    text_en: hasField(body, 'text_en') ? cleanText(body.text_en, TEXT_MAX) : (cur?.text_en ?? null),
    tag_mn: hasField(body, 'tag_mn') ? cleanText(body.tag_mn, TAG_MAX) : (cur?.tag_mn ?? null),
    tag_en: hasField(body, 'tag_en') ? cleanText(body.tag_en, TAG_MAX) : (cur?.tag_en ?? null),
    tone: hasField(body, 'tone') ? (isTone(body.tone) ? body.tone : null) : (cur?.tone ?? null),
    sort_order: hasField(body, 'sort_order')
      ? cleanRank(body.sort_order)
      : (cur?.sort_order ?? null),
  };

  const user = c.get('user');
  await db
    .prepare(
      `INSERT INTO ticker_builtin_prefs
         (key, is_active, text_mn, text_en, tag_mn, tag_en, tone, sort_order, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET
         is_active  = excluded.is_active,
         text_mn    = excluded.text_mn,
         text_en    = excluded.text_en,
         tag_mn     = excluded.tag_mn,
         tag_en     = excluded.tag_en,
         tone       = excluded.tone,
         sort_order = excluded.sort_order,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    )
    .bind(
      key,
      next.is_active,
      next.text_mn,
      next.text_en,
      next.tag_mn,
      next.tag_en,
      next.tone,
      next.sort_order,
      user.sub,
    )
    .run();

  return c.json({ ok: true });
});

/** DELETE /api/ticker/admin/builtin/:key — тохиргоог цуцалж өгөгдмөл рүү. */
ticker.delete('/admin/builtin/:key', requireAdmin(), async (c) => {
  const key = c.req.param('key');
  if (!(BUILTIN_KEYS as readonly string[]).includes(key)) {
    return c.json({ error: 'Түлхүүр олдсонгүй' }, 404);
  }
  await c.env.DB.prepare(`DELETE FROM ticker_builtin_prefs WHERE key = ?`).bind(key).run();
  return c.json({ ok: true });
});

/**
 * POST /api/ticker/admin/order — нэгдсэн эрэмбийг бүхэлд нь бичнэ.
 *
 * Хүлээж авах хэлбэр: `{ order: [{ kind: 'message' | 'builtin', key }] }`
 * — жагсаалтын индекс × 10 нь `sort_order` болно.  Суурин мөрийн хувьд
 * тохиргооны мөр байхгүй бол ЭНД үүснэ (upsert).
 */
ticker.post('/admin/order', requireAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const body = await c.req
    .json<{ order?: { kind?: string; key?: string | number }[] }>()
    .catch(() => ({}) as { order?: { kind?: string; key?: string | number }[] });

  const order = Array.isArray(body.order) ? body.order.slice(0, 100) : [];
  if (order.length === 0) return c.json({ error: 'order хоосон байна' }, 400);

  const stmts: D1PreparedStatement[] = [];
  for (const [i, row] of order.entries()) {
    const rank = (i + 1) * 10;
    if (row?.kind === 'message') {
      const id = Number(row.key);
      if (!Number.isInteger(id)) continue;
      stmts.push(
        db
          .prepare(
            `UPDATE ticker_messages SET sort_order = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .bind(rank, id),
      );
    } else if (
      row?.kind === 'builtin' &&
      (BUILTIN_KEYS as readonly string[]).includes(String(row.key))
    ) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO ticker_builtin_prefs (key, sort_order, updated_by, updated_at)
             VALUES (?, ?, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET
               sort_order = excluded.sort_order,
               updated_by = excluded.updated_by,
               updated_at = excluded.updated_at`,
          )
          .bind(String(row.key), rank, user.sub),
      );
    }
  }
  if (stmts.length > 0) await db.batch(stmts);
  return c.json({ ok: true });
});

export default ticker;
