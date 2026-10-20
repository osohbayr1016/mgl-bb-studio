import { useEffect } from 'react';
import { useAuth } from '@/shared/context/AuthContext';
import { todayUB, nowTimeUB } from '@/shared/lib/time';
import { showWebNotification } from '@/shared/lib/webNotifications';
import { SHIFT_START_MINUTES, type ScheduleKey } from '@/features/attendance/shifts';

/* =============================================================
 * Ажил эхлэхээс 5 МИНУТЫН ӨМНӨ web notification.
 *
 * Ээлж: 'early' = 08:00, 'mid' = 08:30, 'standard' = 09:00.  Тиймээс
 * сануулга 07:55 / 08:25 / 08:55-д очно.  Зөвхөн ажлын өдөр (Да–Ба), өдөрт
 * нэг удаа (localStorage flag).
 *
 * ⚠️ ЗУНЫ ДҮРМИЙГ ЭНД ДАХИН ХЭРЭГЖҮҮЛЭХГҮЙ (2026-08-26).  `GET /auth/me` нь
 *    `effectiveSchedule()`-ээр дамжуулж БОДИТ ээлжийг буцаадаг болсон —
 *    зуны албадлага, `user_work_schedules`-ийн эффектив огноо хоёулаа тэнд
 *    шийдэгдэнэ.  Урьд нь энэ hook 6/7/8 сарыг ХАТУУ бичсэн байсан ба
 *    `ORG_SUMMER_MONTHS` тохиргоог үл тоомсорлодог байв.
 *
 * App-open-only: зөвхөн browser/tab нээлттэй үед.  Найдвартай байхын тулд
 * урт setTimeout биш, 30 секунд тутамд цаг шалгана (laptop унтаад сэрэхэд
 * ч ажиллана).
 * ============================================================= */

const CHECK_MS = 30_000;
const REMINDER_LEAD_MIN = 5;
const FLAG_PREFIX = 'work-start-reminder:';

/** YYYY-MM-DD огнооны 7 хоногийн өдөр (0=Ня … 6=Бя). UB календарь. */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** "HH:mm" → шөнө дундаас хойших минут. */
function minutesOf(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return -1;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

export function useWorkStartReminder(): void {
  const { user } = useAuth();
  const role = user?.role ?? null;
  const workSchedule = user?.work_schedule ?? 'standard';

  useEffect(() => {
    if (!user) return;
    if (role === 'client') return; // client-д ажлын цаг хамаарахгүй

    const tick = () => {
      const today = todayUB();
      const dow = weekdayOf(today);
      if (dow === 0 || dow === 6) return; // амралтын өдөр

      const flagKey = `${FLAG_PREFIX}${today}`;
      if (localStorage.getItem(flagKey) === '1') return;

      const scheduleKey = workSchedule as ScheduleKey;
      const startMin =
        typeof user.shift_start_minutes === 'number'
          ? user.shift_start_minutes
          : (SHIFT_START_MINUTES[scheduleKey] ?? SHIFT_START_MINUTES.standard);
      const remindMin = startMin - REMINDER_LEAD_MIN;
      const startLabel = `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(
        startMin % 60,
      ).padStart(2, '0')}`;

      const cur = minutesOf(nowTimeUB());
      if (cur < 0) return;
      // [start-5, start) цонхонд орвол нэг удаа мэдэгдэнэ.
      if (cur >= remindMin && cur < startMin) {
        try {
          localStorage.setItem(flagKey, '1');
        } catch {
          /* ignore */
        }
        void showWebNotification(`Ажил эхлэхэд ${REMINDER_LEAD_MIN} минут үлдлээ`, {
          body: `Өнөөдрийн ажил ${startLabel}-д эхэлнэ. Ирцээ бүртгэхэд бэлд.`,
          tag: 'work-start-reminder',
          link: '/app/attendance',
        });
      }
    };

    tick(); // mount дээр шууд нэг шалгана
    const iv = window.setInterval(tick, CHECK_MS);
    return () => window.clearInterval(iv);
  }, [user, role, workSchedule]);
}
