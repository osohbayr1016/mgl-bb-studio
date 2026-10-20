/**
 * Албан таймерын цайны цонх (ирцийн `app_settings.lunch_*`-тэй ЯГ ижил тохиргоо) + клиентийн тоолуурт өгөх хэлбэр.
 * `routes/taskTimer.ts` ба `routes/taskAllocations.ts` хоёр хуваалцана — тусад нь давтаж бичвэл нэг нь зөрнө.
 */
import { getAttendanceSettings } from './settings';
import { orgUtcOffsetMinutes } from './reportWindows';
import { officialLunchOf, type OfficialLunch } from './taskTimer';

export async function loadOfficialLunch(db: D1Database): Promise<OfficialLunch | null> {
  return officialLunchOf(await getAttendanceSettings(db), orgUtcOffsetMinutes());
}

/** Клиентийн тоолуурын ихэр (`features/task-timer/stopwatch.ts` `lunchRuleOf`). */
export function lunchWire(l: OfficialLunch | null) {
  return l ? { start_min: l.startMin, end_min: l.endMin, from: l.fromDate, offset_min: l.offsetMinutes } : null;
}
