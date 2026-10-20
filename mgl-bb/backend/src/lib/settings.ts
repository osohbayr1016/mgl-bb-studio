import { LATE_PENALTY_PER_MINUTE } from '../types';

export interface AttendanceSettings {
  lateGraceMinutes: number;
  latePenaltyPerMinute: number;
  /** Хэрэв true бол ирц бүртгэхэд оффисын IP (office_ips) шалгана.  false бол
   *  хаанаас ч (дурын сүлжээ/төхөөрөмж) бүртгэхийг зөвшөөрнө. */
  requireOfficeIp: boolean;
  /** Цайны цагийг ажилласан цагаас хасах эсэх (default: true).  Идэвхтэй бол
   *  hours_worked тооцохдоо [clock_in, clock_out]-ийн доорх цайны цонхтой
   *  давхцсан хэсгийг хасна (9 цаг → цайны 1 цаг хасвал 8 цаг). */
  lunchEnabled: boolean;
  /** Цайны эхлэх/дуусах цаг, UB 'HH:MM' (default 12:00–13:00). */
  lunchStart: string;
  lunchEnd: string;
  /** Ижил компьютерийн ШИНЭ браузерыг (техник хангамжийн профайл таарвал)
   *  автоматаар холбох эсэх (default: true).  false бол зөвхөн яг таарсан
   *  browser_id — `lib/attendanceDevice.ts`-ийн хязгаарын тайлбарыг үз. */
  deviceHwMatch: boolean;
}

const ATTENDANCE_KEYS = [
  'late_grace_minutes',
  'late_penalty_per_minute',
  'require_office_ip',
  'lunch_enabled',
  'lunch_start',
  'lunch_end',
  'attendance_device_hw_match',
] as const;

function parseNonNegativeInt(raw: unknown, fallback: number): number {
  if (typeof raw !== 'string') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** 'HH:MM' (24 цаг) форматыг шалгаж, буруу бол fallback буцаана. */
const TIME_HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
function parseTimeHHMM(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && TIME_HHMM_RE.test(raw) ? raw : fallback;
}

/**
 * Load all attendance-related settings in a single query, falling back to
 * the constants in `types.ts` when a key is missing or malformed.  Cheap
 * enough to call per request — D1 is local to the worker.
 */
export async function getAttendanceSettings(db: D1Database): Promise<AttendanceSettings> {
  const placeholders = ATTENDANCE_KEYS.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT key, value FROM app_settings WHERE key IN (${placeholders})`)
    .bind(...ATTENDANCE_KEYS)
    .all<{ key: string; value: string }>();

  const map = new Map<string, string>();
  for (const r of results ?? []) map.set(r.key, r.value);

  return {
    lateGraceMinutes: parseNonNegativeInt(map.get('late_grace_minutes'), 0),
    latePenaltyPerMinute: parseNonNegativeInt(
      map.get('late_penalty_per_minute'),
      LATE_PENALTY_PER_MINUTE,
    ),
    // Байхгүй/буруу бол default-аар шалгана (хуучин зан төлөв).  Зөвхөн
    // тодорхой '0' үед л шалгалтыг унтраана.
    requireOfficeIp: map.get('require_office_ip') !== '0',
    // Цайны хасалт default-аар идэвхтэй (зөвхөн '0' үед унтраана);
    // цонх default 12:00–13:00.
    lunchEnabled: map.get('lunch_enabled') !== '0',
    lunchStart: parseTimeHHMM(map.get('lunch_start'), '12:00'),
    lunchEnd: parseTimeHHMM(map.get('lunch_end'), '13:00'),
    // Зөвхөн тодорхой '0' үед л унтарна.
    deviceHwMatch: map.get('attendance_device_hw_match') !== '0',
  };
}

/** Firm-wide branding shown on report PDFs (cover + footer). */
export interface BrandingSettings {
  /** Public R2 URL to the firm logo (or `null` if not configured). */
  logoUrl: string | null;
  /** Public R2 URL to the firm's official stamp / тамга (or `null`).
   *
   *  ⚠️ БАЙГУУЛЛАГЫН тохиргоо, хэрэглэгчийнх БИШ.  Тамга нь компанийн нэг
   *  тул «Баталгаажуулалт» хуудсанд хэн гарын үсэг зурснаас үл хамааран
   *  ижил тамга гарна.  `users.stamp_url` (migration 0173) нь үнийн санал /
   *  ASR-ийн ХУУЧИН зам болж үлдэнэ — тэднийг энэ өөрчлөлт хөндөөгүй. */
  stampUrl: string | null;
}

const BRANDING_KEYS = ['report_logo_url', 'report_stamp_url'] as const;

/** Хоосон мөр = «тохируулаагүй» (тохиргоог цэвэрлэхэд '' бичдэг). */
function brandValue(map: Map<string, string>, key: string): string | null {
  const raw = map.get(key);
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

export async function getBrandingSettings(db: D1Database): Promise<BrandingSettings> {
  const placeholders = BRANDING_KEYS.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT key, value FROM app_settings WHERE key IN (${placeholders})`)
    .bind(...BRANDING_KEYS)
    .all<{ key: string; value: string }>();
  const map = new Map<string, string>();
  for (const r of results ?? []) map.set(r.key, r.value);
  return {
    logoUrl: brandValue(map, 'report_logo_url'),
    stampUrl: brandValue(map, 'report_stamp_url'),
  };
}

/** Upsert (key, value) pair, recording the editor for audit. */
export async function upsertSetting(
  db: D1Database,
  key: string,
  value: string,
  updatedBy: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at, updated_by)
     VALUES (?, ?, datetime('now'), ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = datetime('now'),
       updated_by = excluded.updated_by`,
    )
    .bind(key, value, updatedBy)
    .run();
}
