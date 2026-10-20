/**
 * Web Push бүртгэл + тохиргоо — /api/push
 *
 *   GET  /public-key    — браузерын `applicationServerKey` (VAPID нийтийн түлхүүр)
 *   POST /subscribe     — PushSubscription-ыг бүртгэх / шинэчлэх
 *   POST /unsubscribe   — өөрийн төхөөрөмжийн бүртгэлийг устгах
 *   GET  /prefs         — ангиллын тохиргоо + бүртгэлтэй төхөөрөмжийн тоо
 *   PUT  /prefs         — ангиллын тохиргоо хадгалах
 *   POST /test          — өөр рүүгээ туршилтын мэдэгдэл илгээх
 *
 * `authMiddleware` нь /api/* бүхэлд нь ажилладаг тул энд нэмэлт хамгаалалт
 * шаардлагагүй — бүх төгсгөл нь ЗӨВХӨН дуудагчийн ӨӨРИЙН мөрүүд дээр ажиллана.
 */
import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { b64urlToBytes, sendWebPush, vapidConfigured } from '../lib/webPush';
import {
  DEFAULT_PUSH_PREFS,
  PUSH_CATEGORIES,
  resolvePrefs,
  type PushCategory,
} from '../lib/pushSweep';

const push = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/* ------------------------------------------------------------------ */
/*  Endpoint-ийн цагаан жагсаалт (SSRF-ийн хамгаалалт)                 */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЭНЭ ЖАГСААЛТ БОЛ SSRF-ИЙН ГОЛ ХЯНАЛТ.
 *
 * `/subscribe` нь дурын хэрэглэгчийн өгсөн URL-ыг DB-д хадгалдаг бөгөөд
 * cron sweep дараа нь тэр URL руу Worker-ээс POST хийдэг.  Хэрэв
 * шалгалтгүй бол баталгаажсан ямар ч хэрэглэгч Worker-ийг дурын хост
 * (дотоод сүлжээ, metadata endpoint, гуравдагч талын API) руу хүсэлт
 * дамжуулагч болгон ашиглах боломжтой.  Тиймээс зөвхөн жинхэнэ push
 * service-үүдийн домэйныг зөвшөөрнө.
 */
const ALLOWED_PUSH_HOSTS = new Set(['fcm.googleapis.com', 'android.googleapis.com']);
const ALLOWED_PUSH_HOST_SUFFIXES = [
  '.push.services.mozilla.com', // Firefox
  '.notify.windows.com', // Edge / WNS
  '.push.apple.com', // Safari (web.push.apple.com)
];

function isAllowedEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (ALLOWED_PUSH_HOSTS.has(host)) return true;
  return ALLOWED_PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** Хариултад endpoint-ийг бүтнээр нь буцаахгүй — сүүлийн хэсгээр нь таних. */
function endpointTail(endpoint: string): string {
  return endpoint.length <= 14 ? endpoint : `…${endpoint.slice(-12)}`;
}

/* ------------------------------------------------------------------ */
/*  GET /api/push/public-key                                           */
/* ------------------------------------------------------------------ */

// Тохируулаагүй үед 503 биш `null` буцаана — фронтенд «push боломжгүй»
// гэдгийг алдааны дэлгэц гаргалгүй чимээгүй ойлгох ёстой.
push.get('/public-key', (c) => {
  return c.json({ public_key: vapidConfigured(c.env) ? (c.env.VAPID_PUBLIC_KEY ?? null) : null });
});

/* ------------------------------------------------------------------ */
/*  POST /api/push/subscribe                                           */
/* ------------------------------------------------------------------ */

interface SubscribeBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

push.post('/subscribe', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<SubscribeBody>().catch((): SubscribeBody => ({}));

  const endpoint = body.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 1024) {
    return c.json({ error: 'endpoint шаардлагатай (1024 тэмдэгтээс богино)' }, 400);
  }
  if (!isAllowedEndpoint(endpoint)) {
    return c.json({ error: 'endpoint нь зөвшөөрөгдсөн push үйлчилгээний хаяг байх ёстой' }, 400);
  }

  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') {
    return c.json({ error: 'keys.p256dh ба keys.auth шаардлагатай' }, 400);
  }
  const pubBytes = b64urlToBytes(p256dh);
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    return c.json({ error: 'keys.p256dh нь 65 байтын шахагдаагүй P-256 цэг байх ёстой' }, 400);
  }
  if (b64urlToBytes(auth).length !== 16) {
    return c.json({ error: 'keys.auth нь 16 байт байх ёстой' }, 400);
  }

  const userAgent = (c.req.header('User-Agent') ?? '').slice(0, 256) || null;

  // Нэг endpoint = нэг төхөөрөмжийн нэг браузерын профайл.  Оффисын нийтийн
  // компьютер дээр өөр хүн нэвтэрвэл ижил endpoint дээр user_id-г ДАРЖ
  // бичих ёстой — эс бөгөөс өмнөх хүн рүү өөр хүний мэдэгдэл очно.
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_used_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       user_agent = excluded.user_agent,
       failure_count = 0,
       last_used_at = datetime('now')`,
  )
    .bind(user.sub, endpoint, p256dh, auth, userAgent)
    .run();

  return c.json({ ok: true }, 201);
});

/* ------------------------------------------------------------------ */
/*  POST /api/push/unsubscribe                                         */
/* ------------------------------------------------------------------ */

push.post('/unsubscribe', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ endpoint?: unknown }>().catch(() => ({ endpoint: undefined }));
  const endpoint = body.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    return c.json({ error: 'endpoint шаардлагатай' }, 400);
  }

  // `AND user_id = ?` нь нэг хэрэглэгч нөгөөгийнхөө төхөөрөмжийг устгахаас
  // сэргийлнэ.  Байхгүй мөр дээр ч 200 — idempotent (давхар дуудалт аюулгүй).
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
    .bind(endpoint, user.sub)
    .run();

  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  GET / PUT /api/push/prefs                                          */
/* ------------------------------------------------------------------ */

push.get('/prefs', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT push_prefs FROM users WHERE id = ?')
    .bind(user.sub)
    .first<{ push_prefs: string | null }>();
  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?',
  )
    .bind(user.sub)
    .first<{ n: number }>();

  return c.json({
    prefs: resolvePrefs(row?.push_prefs),
    subscribed_devices: count?.n ?? 0,
  });
});

push.put('/prefs', async (c) => {
  const user = c.get('user');
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Биед ангилал бүрийн boolean утга бүхий объект байх ёстой' }, 400);
  }
  const obj = body as Record<string, unknown>;

  const known = new Set<string>(PUSH_CATEGORIES);
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) {
      return c.json({ error: `Танихгүй ангилал: ${key}` }, 400);
    }
    if (typeof obj[key] !== 'boolean') {
      return c.json({ error: `${key} нь boolean байх ёстой` }, 400);
    }
  }

  // Дутуу түлхүүрийг анхдагчаар нөхөж БҮТЭН 6 талбартай объект хадгална —
  // тэгснээр дараа нь уншихад «энэ нь тохируулаагүй юу, унтраасан юу» гэдэг
  // хоёрдмол утга үүсэхгүй.
  const prefs: Record<PushCategory, boolean> = { ...DEFAULT_PUSH_PREFS };
  for (const cat of PUSH_CATEGORIES) {
    const v = obj[cat];
    if (typeof v === 'boolean') prefs[cat] = v;
  }

  await c.env.DB.prepare('UPDATE users SET push_prefs = ? WHERE id = ?')
    .bind(JSON.stringify(prefs), user.sub)
    .run();

  return c.json({ prefs });
});

/* ------------------------------------------------------------------ */
/*  POST /api/push/test                                                */
/* ------------------------------------------------------------------ */

/** Хэрэглэгч тус бүрийн сүүлийн туршилтын мөч (isolate-ийн санах ойд). */
const lastTestAt = new Map<number, number>();
const TEST_THROTTLE_MS = 60_000;

push.post('/test', async (c) => {
  const user = c.get('user');
  if (!vapidConfigured(c.env)) {
    return c.json({ error: 'Push мэдэгдэл тохируулаагүй байна' }, 503);
  }

  const now = Date.now();
  const prev = lastTestAt.get(user.sub);
  if (prev !== undefined && now - prev < TEST_THROTTLE_MS) {
    return c.json(
      {
        error: `Дахин ${Math.ceil((TEST_THROTTLE_MS - (now - prev)) / 1000)} секундын дараа оролдоно уу`,
      },
      429,
    );
  }
  lastTestAt.set(user.sub, now);

  const { results: subs } = await c.env.DB.prepare(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? LIMIT 10',
  )
    .bind(user.sub)
    .all<{ id: number; endpoint: string; p256dh: string; auth: string }>();

  if (subs.length === 0) {
    return c.json({ error: 'Бүртгэлтэй төхөөрөмж алга. Эхлээд мэдэгдлийг зөвшөөрнө үү.' }, 404);
  }

  let sent = 0;
  let failed = 0;
  const results: Array<{ endpoint_tail: string; status: number }> = [];
  const deadIds: number[] = [];

  // Цөөхөн (≤10) тул дараалан илгээнэ — pool хэрэггүй.
  for (const sub of subs) {
    const res = await sendWebPush(c.env, sub, {
      title: 'MGL — туршилтын мэдэгдэл',
      body: 'Push мэдэгдэл ажиллаж байна ✅',
      link: '/app',
      tag: 'mgl-test',
    });
    results.push({ endpoint_tail: endpointTail(sub.endpoint), status: res.status });
    if (res.ok) {
      sent++;
    } else {
      failed++;
      if (res.action === 'drop') deadIds.push(sub.id);
    }
  }

  // Sweep-тэй ижил цэвэрлэгээ: үхсэн subscription-ыг шууд устгана.
  if (deadIds.length > 0) {
    await c.env.DB.prepare(
      `DELETE FROM push_subscriptions WHERE id IN (${deadIds.map(() => '?').join(',')})`,
    )
      .bind(...deadIds)
      .run();
  }

  return c.json({ sent, failed, results });
});

export default push;
