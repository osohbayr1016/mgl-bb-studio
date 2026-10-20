/**
 * Захиалагчийн порталын ЦЭВЭР туслахууд (React-гүй) — нэр задлах, огноо,
 * хувь, файлын хэмжээ.  Компонент файлаас тусад нь байх нь Fast Refresh-ийн
 * `only-export-components` дүрмийн шаардлага.
 */
import { brand } from '@/shared/config/brand';
import { formatProjectShortName } from '@/shared/lib/formatting';
import { isProjectCategory, type ProjectCategory } from '@/shared/lib/project-categories';

export interface ProjectTitleParts {
  /** `MGL-251006` — байхгүй бол null. */
  code: string | null;
  /** Хүнд уншигдах нэр: код, ангиллын сүүл хасагдсан. */
  title: string;
  /** `_ZA`, ` IZ` гэх мэт сүүлээс таньсан ангилал. */
  category: ProjectCategory | null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Төслийн нэрийг «код · нэр · ангилал» болгож задлана.
 *
 *   MGL-251006_EVERGREEN_ZA                 → MGL-251006 · EVERGREEN · ZA
 *   MGL-250828 Талбайн теннисний ордон IZ   → MGL-250828 · Талбайн теннисний ордон · IZ
 *   MGL-260501_44 давхар орон сууц          → MGL-260501 · 44 давхар орон сууц · —
 *
 * `displayTitle` (админы өгсөн гарчиг) байвал нэр нь түүгээр солигдоно, код
 * ба ангилал нь `name`-ээс хэвээр гарна.  ЗӨВХӨН харагдацад — бүтэн нэрийг
 * `title` атрибутад үлдээнэ (код нь албан харилцаанд хэрэглэгддэг).
 */
export function splitProjectTitle(name: string, displayTitle?: string | null): ProjectTitleParts {
  const full = name.trim();
  const prefix = brand().projectCodePrefix;
  let code: string | null = null;
  if (prefix) {
    const m = full.match(new RegExp(`^(${escapeRe(prefix)}-\\d{6})`, 'i'));
    if (m?.[1]) code = m[1].toUpperCase();
  }

  let title = formatProjectShortName(full);
  let category: ProjectCategory | null = null;
  const cm = title.match(/[_\s-](AZ|ZA|ET|EZ|IZ)$/i);
  if (cm?.[1] && cm.index !== undefined) {
    const c = cm[1].toUpperCase();
    if (isProjectCategory(c)) {
      category = c;
      title = title.slice(0, cm.index);
    }
  }
  title = title.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  const custom = displayTitle?.trim();
  return { code, title: custom || title || full, category };
}

/** 0…100 хооронд барина — захиалагчид ХЭЗЭЭ Ч 100-аас их хувь харуулахгүй. */
export function clampPct(value: number | null | undefined): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, n));
}

/** Бүхэл хувь («47»). */
export function pctInt(value: number | null | undefined): string {
  return String(Math.round(clampPct(value)));
}

/** Нэг оронтой хувь («47.3», бүхэл бол «47»). */
export function pctOne(value: number | null | undefined): string {
  const v = Math.round(clampPct(value) * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * Паспортын огноо чөлөөт бичиглэлтэй байж болно (`2026-07-09`, `2026.07.09`,
 * `2026/7/9`).  Таньсан бол орон нутгийн шөнө дундын `Date`, эс бөгөөс null.
 */
export function parseLooseDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const m = input.trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `YYYY-MM-DD` (орон нутгийн). */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Хоёр өдрийн хоорондох бүхэл хоног (b − a). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export interface ScheduleState {
  start: Date;
  finish: Date;
  totalDays: number;
  /** Өнөөдрийн байрлал 0…100 (эхлэхээс өмнө 0, дууссаны дараа 100). */
  elapsedPct: number;
  /** Дуусах хүртэл үлдсэн хоног (өнгөрсөн бол 0). */
  daysLeft: number;
  /** Эхлэх хүртэл үлдсэн хоног (эхэлсэн бол 0). */
  daysToStart: number;
  phase: 'upcoming' | 'running' | 'past';
}

/** Эхлэх/дуусах огноо хоёулаа танигдвал хуваарийн төлөв, эс бөгөөс null. */
export function scheduleState(
  startRaw: string | null | undefined,
  finishRaw: string | null | undefined,
  todayIso: string,
): ScheduleState | null {
  const start = parseLooseDate(startRaw);
  const finish = parseLooseDate(finishRaw);
  const today = parseLooseDate(todayIso);
  if (!start || !finish || !today || finish.getTime() < start.getTime()) return null;
  const totalDays = Math.max(1, daysBetween(start, finish));
  const done = daysBetween(start, today);
  const elapsedPct = Math.max(0, Math.min(100, (done / totalDays) * 100));
  const phase = today < start ? 'upcoming' : today > finish ? 'past' : 'running';
  return {
    start,
    finish,
    totalDays,
    elapsedPct,
    daysLeft: Math.max(0, daysBetween(today, finish)),
    daysToStart: Math.max(0, daysBetween(today, start)),
    phase,
  };
}

/** `1.2 MB` маягийн хэмжээ; хоосон/0 бол ''. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Нэрийн эхний хоёр үсэг (аватарын оронд). */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/[\s.]+/).filter(Boolean);
  if (parts.length === 0) return '·';
  const letters = parts.length === 1 ? parts[0]!.slice(0, 2) : `${parts[0]![0]}${parts[1]![0]}`;
  return letters.toUpperCase();
}

/** Зургийн нэрээс багийн угтварыг («BA - », «BB_») хасна — баг нь тусдаа харагддаг. */
export function stripTeamPrefix(name: string, teamCode: string | null | undefined): string {
  if (!teamCode) return name;
  const stripped = name.replace(new RegExp(`^${escapeRe(teamCode)}[\\s_-]+`, 'i'), '');
  return stripped || name;
}
