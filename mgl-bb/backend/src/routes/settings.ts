/**
 * Admin-managed app settings.  Currently only attendance knobs:
 *   - late_grace_minutes      (0 — 60)
 *   - late_penalty_per_minute (0 — 100000 ₮)
 *
 * GET  /api/settings/attendance — admin/senior may read
 * PUT  /api/settings/attendance — admin only may edit
 */
import { Hono } from 'hono';
import { deleteReplacedMediaAll } from '../lib/mediaReplace';
import { requireRole, requireAdmin } from '../middleware/auth';
import type { Env, AppVariables } from '../types';
import { getAttendanceSettings, getBrandingSettings, upsertSetting } from '../lib/settings';
import {
  loadOrgConfig,
  parseShift,
  parseMonths,
  ORG_SETTING_KEYS,
  type OrgConfig,
} from '../lib/orgConfig';
import { MODULE_IDS, MODULE_LABELS, ALWAYS_ON } from '../lib/modules';

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

router.get(
  '/attendance',
  requireRole('admin', 'senior'),
  async (c) => {
    const s = await getAttendanceSettings(c.env.DB);
    return c.json({
      late_grace_minutes: s.lateGraceMinutes,
      late_penalty_per_minute: s.latePenaltyPerMinute,
      require_office_ip: s.requireOfficeIp,
      lunch_enabled: s.lunchEnabled,
      lunch_start: s.lunchStart,
      lunch_end: s.lunchEnd,
      device_hw_match: s.deviceHwMatch,
      note: 'Тохиргооны өөрчлөлт зөвхөн шинэ ирц бүртгэлд үйлчилнэ; өмнөх өдрийн хадгалагдсан хоцролт/ажилласан цаг хэвээр үлдэнэ.',
    });
  },
);

router.put('/attendance', requireAdmin(), async (c) => {
  const user = c.get('user');
  type Body = {
    late_grace_minutes?: number;
    late_penalty_per_minute?: number;
    require_office_ip?: boolean;
    lunch_enabled?: boolean;
    lunch_start?: string;
    lunch_end?: string;
    device_hw_match?: boolean;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const grace = body.late_grace_minutes;
  const penalty = body.late_penalty_per_minute;
  const requireOfficeIp = body.require_office_ip;
  const lunchEnabled = body.lunch_enabled;
  const lunchStart = body.lunch_start;
  const lunchEnd = body.lunch_end;
  const deviceHwMatch = body.device_hw_match;
  const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

  if (grace !== undefined) {
    if (!Number.isInteger(grace) || grace < 0 || grace > 60) {
      return c.json({ error: 'late_grace_minutes 0–60 (бүхэл тоо) байх ёстой' }, 400);
    }
  }
  if (penalty !== undefined) {
    if (!Number.isInteger(penalty) || penalty < 0 || penalty > 100_000) {
      return c.json({ error: 'late_penalty_per_minute 0–100000 (бүхэл тоо) байх ёстой' }, 400);
    }
  }
  if (requireOfficeIp !== undefined && typeof requireOfficeIp !== 'boolean') {
    return c.json({ error: 'require_office_ip нь boolean байх ёстой' }, 400);
  }
  if (lunchEnabled !== undefined && typeof lunchEnabled !== 'boolean') {
    return c.json({ error: 'lunch_enabled нь boolean байх ёстой' }, 400);
  }
  if (deviceHwMatch !== undefined && typeof deviceHwMatch !== 'boolean') {
    return c.json({ error: 'device_hw_match нь boolean байх ёстой' }, 400);
  }
  if (lunchStart !== undefined && !TIME_RE.test(lunchStart)) {
    return c.json({ error: 'lunch_start нь HH:MM форматтай байх ёстой' }, 400);
  }
  if (lunchEnd !== undefined && !TIME_RE.test(lunchEnd)) {
    return c.json({ error: 'lunch_end нь HH:MM форматтай байх ёстой' }, 400);
  }
  // Эхлэх < дуусах хязгаар — нэг талыг л өөрчилбөл нөгөөг одоогийн утгатай жишнэ.
  if (lunchStart !== undefined || lunchEnd !== undefined) {
    const cur = await getAttendanceSettings(c.env.DB);
    const s = lunchStart ?? cur.lunchStart;
    const e = lunchEnd ?? cur.lunchEnd;
    if (e <= s) {
      return c.json({ error: 'lunch_end нь lunch_start-аас хойш байх ёстой' }, 400);
    }
  }

  if (grace !== undefined) {
    await upsertSetting(c.env.DB, 'late_grace_minutes', String(grace), user.sub);
  }
  if (penalty !== undefined) {
    await upsertSetting(c.env.DB, 'late_penalty_per_minute', String(penalty), user.sub);
  }
  if (requireOfficeIp !== undefined) {
    await upsertSetting(c.env.DB, 'require_office_ip', requireOfficeIp ? '1' : '0', user.sub);
  }
  if (lunchEnabled !== undefined) {
    await upsertSetting(c.env.DB, 'lunch_enabled', lunchEnabled ? '1' : '0', user.sub);
  }
  if (lunchStart !== undefined) {
    await upsertSetting(c.env.DB, 'lunch_start', lunchStart, user.sub);
  }
  if (lunchEnd !== undefined) {
    await upsertSetting(c.env.DB, 'lunch_end', lunchEnd, user.sub);
  }
  if (deviceHwMatch !== undefined) {
    await upsertSetting(c.env.DB, 'attendance_device_hw_match', deviceHwMatch ? '1' : '0', user.sub);
  }

  const updated = await getAttendanceSettings(c.env.DB);
  return c.json({
    late_grace_minutes: updated.lateGraceMinutes,
    late_penalty_per_minute: updated.latePenaltyPerMinute,
    require_office_ip: updated.requireOfficeIp,
    lunch_enabled: updated.lunchEnabled,
    lunch_start: updated.lunchStart,
    lunch_end: updated.lunchEnd,
    device_hw_match: updated.deviceHwMatch,
  });
});

/* =============================================================
 * GET /api/settings/branding — firm-wide brand assets (logo URL).
 * Open to any authed user; the PDF print page needs it.
 * ============================================================= */
router.get('/branding', async (c) => {
  const b = await getBrandingSettings(c.env.DB);
  return c.json({ logo_url: b.logoUrl, stamp_url: b.stampUrl });
});

/* PUT /api/settings/branding — admin only. Body { logo_url?, stamp_url? }.
 *
 * ⚠️ Талбар бүр БИЕ ДААН нэмэгддэг: заагаагүй (`undefined`) талбарт огт
 * хүрэхгүй.  Урьд нь `logo_url`-ыг болзолгүй бичдэг байсан тул зөвхөн
 * тамга илгээсэн хүсэлт ЛОГОГ чимээгүй арилгах байсан.  Хоосон мөр («»)
 * илгээх нь тухайн тохиргоог цэвэрлэнэ — хуучин зан төлөв хэвээр. */
router.put('/branding', requireAdmin(), async (c) => {
  const user = c.get('user');
  type Body = { logo_url?: string | null; stamp_url?: string | null };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  // 2026-09-11 (R2 аудит): солигдсон лого/тамганы хуучин объектыг цэвэрлэнэ
  // (lib/mediaReplace.ts) — бичихээс ӨМНӨ хуучин утгыг уншина.
  const before = await getBrandingSettings(c.env.DB);
  const pairs: Array<[string | null | undefined, string | null | undefined]> = [];

  if (body.logo_url !== undefined) {
    const raw = typeof body.logo_url === 'string' ? body.logo_url.trim() : '';
    await upsertSetting(c.env.DB, 'report_logo_url', raw, user.sub);
    pairs.push([before.logoUrl, raw || null]);
  }
  if (body.stamp_url !== undefined) {
    const raw = typeof body.stamp_url === 'string' ? body.stamp_url.trim() : '';
    await upsertSetting(c.env.DB, 'report_stamp_url', raw, user.sub);
    pairs.push([before.stampUrl, raw || null]);
  }
  if (pairs.length > 0) c.executionCtx.waitUntil(deleteReplacedMediaAll(c.env, pairs));

  const updated = await getBrandingSettings(c.env.DB);
  return c.json({ logo_url: updated.logoUrl, stamp_url: updated.stampUrl });
});

/* =============================================================
 * Байгууллагын тохиргоо (`lib/orgConfig.ts`).
 *
 * GET  /api/settings/org — нэвтэрсэн ХЭН Ч уншина.  Frontend нь брэндийн
 *      нэр, цагийн бүс, ажлын ээлжийг эндээс авч build үеийн дефолтоо
 *      дарж бичнэ.  Нууц зүйл агуулаагүй — бүгд UI дээр аль хэдийн харагддаг.
 * PUT  /api/settings/org — ЗӨВХӨН админ.
 * ============================================================= */

/** `OrgConfig` → API-ийн snake_case дүрс.  Frontend `shared/config/brand.ts`
 *  нь ЯГ ЭНЭ бүтцийг хүлээж авдаг — хоёуланг нь хамт өөрчил. */
function orgConfigDto(cfg: OrgConfig) {
  return {
    name_short: cfg.nameShort,
    name: cfg.name,
    legal_name_mn: cfg.legalNameMn,
    legal_name_en: cfg.legalNameEn,
    app_name: cfg.appName,
    director_title_mn: cfg.directorTitleMn,
    director_name_mn: cfg.directorNameMn,
    website_url: cfg.websiteUrl,
    contact_email: cfg.contactEmail,
    founded_year: cfg.foundedYear,
    tagline_mn: cfg.taglineMn,
    tagline_en: cfg.taglineEn,
    calendar_id: cfg.calendarId,
    timezone: cfg.timezone,
    currency_code: cfg.currencyCode,
    currency_symbol: cfg.currencySymbol,
    project_code_prefix: cfg.projectCodePrefix,
    hr_policy_doc: cfg.hrPolicyDoc,
    ceo_user_id: cfg.ceoUserId,
    shift_standard: cfg.shiftStandard.label,
    shift_early: cfg.shiftEarly.label,
    shift_mid: cfg.shiftMid.label,
    summer_months: [...cfg.summerMonths],
    modules_unrestricted: cfg.enabledModules === null,
    modules_enabled: cfg.enabledModules === null ? [...MODULE_IDS] : [...cfg.enabledModules],
  };
}

router.get('/org', async (c) => {
  // Middleware нь хүсэлт бүрийн эхэнд ачаалдаг (60 сек memo); гэхдээ энэ бол
  // тохиргоог засмагц шалгадаг гарц тул memo-г тойрч ШИНЭЭР уншина.
  const cfg = await loadOrgConfig(c.env, { force: true });
  return c.json(orgConfigDto(cfg));
});

router.put('/org', requireAdmin(), async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch((): Record<string, unknown> => ({}));

  /** Хүлээн авах талбарууд: API-ийн нэр → `app_settings`-ийн түлхүүр.
   *  `ORG_SETTING_KEYS`-ээс гаргана, тиймээс шинэ талбар нэмэхэд энд
   *  бас гарч ирнэ (compile-аар шалгагдана). */
  const FIELDS: Array<[string, string]> = [
    ['name_short', ORG_SETTING_KEYS.nameShort],
    ['name', ORG_SETTING_KEYS.name],
    ['legal_name_mn', ORG_SETTING_KEYS.legalNameMn],
    ['legal_name_en', ORG_SETTING_KEYS.legalNameEn],
    ['app_name', ORG_SETTING_KEYS.appName],
    ['director_title_mn', ORG_SETTING_KEYS.directorTitleMn],
    ['director_name_mn', ORG_SETTING_KEYS.directorNameMn],
    ['website_url', ORG_SETTING_KEYS.websiteUrl],
    ['contact_email', ORG_SETTING_KEYS.contactEmail],
    ['founded_year', ORG_SETTING_KEYS.foundedYear],
    ['tagline_mn', ORG_SETTING_KEYS.taglineMn],
    ['tagline_en', ORG_SETTING_KEYS.taglineEn],
    ['calendar_id', ORG_SETTING_KEYS.calendarId],
    ['timezone', ORG_SETTING_KEYS.timezone],
    ['currency_code', ORG_SETTING_KEYS.currencyCode],
    ['currency_symbol', ORG_SETTING_KEYS.currencySymbol],
    ['project_code_prefix', ORG_SETTING_KEYS.projectCodePrefix],
    ['hr_policy_doc', ORG_SETTING_KEYS.hrPolicyDoc],
    ['ceo_user_id', ORG_SETTING_KEYS.ceoUserId],
    ['shift_standard', ORG_SETTING_KEYS.shiftStandard],
    ['shift_early', ORG_SETTING_KEYS.shiftEarly],
    ['shift_mid', ORG_SETTING_KEYS.shiftMid],
    ['summer_months', ORG_SETTING_KEYS.summerMonths],
  ];

  /* ---- Баталгаажуулалт: буруу утга DB-д ОГТ хүрэхгүй ---- */
  if (typeof body.timezone === 'string' && body.timezone.trim() !== '') {
    // `Intl` нь танихгүй бүсэд шидэлт хийдэг — тэрийг л шалгуур болгоно.
    // Буруу бүс хадгалагдвал `todayInUB()` БҮХ хүсэлт дээр унана.
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: body.timezone.trim() }).format(new Date());
    } catch {
      return c.json({ error: `Танихгүй цагийн бүс: ${body.timezone}` }, 400);
    }
  }
  for (const key of ['shift_standard', 'shift_early', 'shift_mid'] as const) {
    const v = body[key];
    if (v !== undefined && v !== null && parseShift(v) === null) {
      return c.json({ error: `${key} нь 'HH:MM-HH:MM' форматтай байх ёстой` }, 400);
    }
  }
  if (body.summer_months !== undefined && body.summer_months !== null) {
    const raw = Array.isArray(body.summer_months)
      ? body.summer_months.join(',')
      : String(body.summer_months);
    if (parseMonths(raw) === null) {
      return c.json({ error: 'summer_months нь 1–12 доторх сарын жагсаалт байх ёстой' }, 400);
    }
  }
  if (body.ceo_user_id !== undefined && body.ceo_user_id !== null) {
    const s = String(body.ceo_user_id).trim();
    const ok = s === 'none' || s === '0' || /^\d+$/.test(s);
    if (!ok) return c.json({ error: "ceo_user_id нь эерэг бүхэл тоо эсвэл 'none' байх ёстой" }, 400);
  }

  /* ---- Бичих ---- */
  let written = 0;
  for (const [apiKey, settingKey] of FIELDS) {
    const raw = body[apiKey];
    if (raw === undefined) continue; // өгөөгүй талбарыг хөндөхгүй
    const value = Array.isArray(raw) ? raw.join(',') : raw === null ? '' : String(raw);
    await upsertSetting(c.env.DB, settingKey, value, user.sub);
    written += 1;
  }

  // memo-г тойрч дахин ачаалж, шинэчилсэн утгыг буцаана.
  const cfg = await loadOrgConfig(c.env, { force: true });
  return c.json({ updated: written, ...orgConfigDto(cfg) });
});

/* =============================================================
 * Модулийн эрх (`lib/modules.ts`).
 *
 * GET  /api/settings/modules — нэвтэрсэн ХЭН Ч уншина.  Frontend нь nav-аа
 *      шүүхэд ашиглана, тиймээс нэвтэрсэн хүн бүрт хэрэгтэй.
 * PUT  /api/settings/modules — ЗӨВХӨН админ.
 * ============================================================= */

router.get('/modules', async (c) => {
  const cfg = await loadOrgConfig(c.env, { force: true });
  const enabled = cfg.enabledModules;
  return c.json({
    // `null` = хязгаарлалтгүй.  Frontend үүнийг «бүгд нээлттэй» гэж уншина.
    unrestricted: enabled === null,
    enabled: enabled === null ? [...MODULE_IDS] : [...enabled],
    catalog: MODULE_IDS.map((id) => ({
      id,
      label_mn: MODULE_LABELS[id].mn,
      label_en: MODULE_LABELS[id].en,
      always_on: ALWAYS_ON.includes(id),
    })),
  });
});

router.put('/modules', requireAdmin(), async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<{ enabled?: unknown; unrestricted?: unknown }>()
    .catch((): { enabled?: unknown; unrestricted?: unknown } => ({}));

  // `unrestricted: true` → мөрийг хоосон болгож хязгаарлалтыг бүрэн авна.
  if (body.unrestricted === true) {
    await upsertSetting(c.env.DB, ORG_SETTING_KEYS.enabledModules, '', user.sub);
    const cfg = await loadOrgConfig(c.env, { force: true });
    return c.json({ unrestricted: cfg.enabledModules === null, enabled: [...MODULE_IDS] });
  }

  const requested: unknown = body.enabled;
  if (!Array.isArray(requested)) {
    return c.json({ error: 'enabled нь модулийн id-уудын массив байх ёстой' }, 400);
  }
  const ids: string[] = requested.filter((v): v is string => typeof v === 'string');

  const unknown = requested.filter(
    (v) => typeof v !== 'string' || !(MODULE_IDS as readonly string[]).includes(v),
  );
  if (unknown.length > 0) {
    return c.json({ error: `Танихгүй модуль: ${unknown.map(String).join(', ')}` }, 400);
  }

  // `core` зэрэг үргэлж асаалттай модулийг хасах гэсэн оролдлогыг чимээгүй
  // зөвшөөрөхгүй — `parseModules` тэдгээрийг эргүүлж нэмдэг ч, админд
  // ойлгомжтой байлгахын тулд ЭНД шууд алдаа буцаана.
  const missingAlwaysOn = ALWAYS_ON.filter((m) => !ids.includes(m));
  if (missingAlwaysOn.length > 0) {
    return c.json(
      { error: `Эдгээр модулийг унтраах боломжгүй: ${missingAlwaysOn.join(', ')}` },
      400,
    );
  }

  // ⚠️ ХООСОН массив нь «юу ч нээхгүй» гэсэн утгатай ч, хадгалагдах утга нь
  //    хоосон МӨР болж «хязгаарлалтгүй» гэж уншигдана.  Тиймээс `core`-ийг
  //    үргэлж бичиж, утга хэзээ ч хоосон болохгүй байхаар баталгаажуулна.
  const value = [...new Set<string>([...ALWAYS_ON, ...ids])].join(',');
  await upsertSetting(c.env.DB, ORG_SETTING_KEYS.enabledModules, value, user.sub);

  const cfg = await loadOrgConfig(c.env, { force: true });
  return c.json({
    unrestricted: cfg.enabledModules === null,
    enabled: cfg.enabledModules === null ? [...MODULE_IDS] : [...cfg.enabledModules],
  });
});

export default router;
