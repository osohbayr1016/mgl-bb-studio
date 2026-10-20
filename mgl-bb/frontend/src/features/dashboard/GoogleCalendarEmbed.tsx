import { useTheme } from '@/shared/context/ThemeContext';
import { useBrand } from '@/shared/config/useBrand';

/**
 * Embed-ийн URL.  Календарийн хаяг ба цагийн бүс хоёулаа тохиргооноос гарна
 * (`org.calendar_id` / `org.timezone`, эсвэл backend-ийн `GOOGLE_CALENDAR_ID`).
 * MGL дээр үр дүн нь өмнөх hardcode-той байт байтаараа ижил.
 */
function buildEmbedUrl(calendarId: string, timezone: string): string {
  const q = new URLSearchParams({
    src: calendarId,
    ctz: timezone,
    wkst: '1',
    mode: 'MONTH',
    showPrint: '0',
    showTitle: '0',
    showTz: '0',
  });
  return `https://calendar.google.com/calendar/embed?${q.toString()}`;
}

/**
 * GoogleCalendarEmbed — replaces the old in-app month-grid calendar widget
 * with the team's shared Google Calendar, embedded directly. Google's embed
 * UI already has its own header/nav, so this wrapper only needs to match the
 * surrounding dashboard card look (rounded, bordered, `bg-card`, subtle
 * shadow) and let the iframe fill the available height.
 *
 * Google's embed is light-only (no dark theme param). In the app's dark mode
 * we render it light (`colorScheme: 'light'`) then invert it in CSS with a
 * hue-rotate — the standard trick to fit a light-only third-party iframe into
 * a dark UI while keeping event colours roughly right. In light mode no filter
 * is applied so it renders normally.
 */
export default function GoogleCalendarEmbed() {
  const { resolved } = useTheme();
  // Дундаж горим ч гэсэн харанхуй гэр бүлд хамаарна — гэрэл-зөвхөн iframe-ийг
  // урвуулах шаардлага ижил. Тиймээс `=== 'dark'` биш `!== 'light'`.
  const dark = resolved !== 'light';
  const { calendarId, timezone } = useBrand();

  // Календарь тохируулаагүй бол (өөр компани Google Calendar хэрэглэхгүй байж
  // болно) виджетийг огт зурахгүй — «refused to connect» хоосон хайрцаг
  // үзүүлэхээс дээр.
  if (!calendarId) return null;

  return (
    <div className="h-full overflow-hidden rounded-2xl border border-border bg-card shadow-apple">
      <iframe
        title="Google Calendar"
        src={buildEmbedUrl(calendarId, timezone)}
        // The app is cross-origin-isolated (COEP: credentialless, for the APS 3D
        // viewer). A document-level COEP still blocks embedding a third-party
        // iframe that doesn't send its own COEP — Google Calendar doesn't — so
        // without this the frame fails with "refused to connect". The per-element
        // `credentialless` attribute loads it in an ephemeral, cookie-less context
        // (fine here: the calendar is public). Set via ref because the attribute
        // isn't in React's iframe prop types. Chromium-only (Chrome/Edge).
        ref={(el) => el?.setAttribute('credentialless', '')}
        className="h-full min-h-[560px] w-full border-0"
        style={{
          colorScheme: 'light',
          // Dark mode: invert the light-only Google embed so it blends with the
          // dark UI; hue-rotate(180) keeps event colours roughly correct.
          filter: dark ? 'invert(0.9) hue-rotate(180deg)' : undefined,
        }}
        loading="lazy"
      />
    </div>
  );
}
