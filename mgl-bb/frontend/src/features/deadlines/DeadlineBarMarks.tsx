/**
 * Хугацааны тэмдэглэгээ — ХУВААРИЙН БААРНЫ дээр босоо зураас.
 *
 * ЯАГААД ЗӨВХӨН ХУВААРИЙН БААР ДЭЭР ВЭ:
 * Эцсийн хугацаа бол ОГНОО.  «Нийт ажлын явц» баарны тэнхлэг нь хувь
 * (0-100%) тул тэнд огноог байрлуулах утга учир байхгүй — 2026-08-14
 * гэдэг нь 40% мөн үү, 70% мөн үү гэдэг асуулт хариугүй.  Харин
 * «Төслийн хугацаа» баарны тэнхлэг нь ЯГ цаг хугацаа:
 *
 *     0%  = project.start_date          100% = project.finish_date
 *     дүүргэлтийн ирмэг = ӨНӨӨДӨР      (`getScheduleProgress`)
 *
 * Иймд тэмдэглэгээ нь дүүргэлтийн ирмэгээс ЗҮҮН талд бол «хугацаа нь
 * өнгөрсөн», БАРУУН талд бол «хараахан ирээгүй» гэж шууд уншигдана.
 * Энэ хоёр баарны утгыг сольж хутгавал тэр бүхэн утгагүй болно.
 *
 * ⚠️ Мужаас ГАДНАХ цэгийг ЗУРАХГҮЙ (`pct < 0 || pct > 100`).  Энэ нь
 *    `GanttRow.tsx`-ийн `x < 0 || x > chartWidth` шалгалттай ЗӨРИУД ижил:
 *    хуурамч байрлалд наасан цэг нь «энэ хугацаа төслийн дотор байна»
 *    гэсэн худал мэдээлэл өгнө.  Мужаас гарсан хугацаа нь баарны hover
 *    хөзөр (`ProjectDeadlineHover`) болон «Эцсийн хугацаа» хуудсанд
 *    бүтнээрээ хэвээр харагдана — мэдээлэл алдагдахгүй.
 *
 * ⚠️ Өнгө нь эрсдэлийнх, ХЭМЖЭЭ нь шатлалынх (дэд хугацаа = богино
 *    зураас).  Хоёуланг өнгөөр ялгавал улаан дэд хугацаа, улаан үндсэн
 *    хугацаа хоёр ялгагдахаа болино — `GanttRow`-ийн адил дүрэм.
 */
import { cn } from '@/shared/lib/utils';
import { RISK_TONE } from '@/features/timeline/lib/riskDisplay';

import type { DeadlinePoint } from './types';

/** Хоёр тэмдэглэгээний ХАМГИЙН БАГА зай (баарны өргөний хувиар).
 *  Зураас нь 2px тул ~200px баарны 1.5% ≈ 3px — зэрэгцээ хоёр зураас
 *  нийлж бүдүүн толбо болохоос сэргийлнэ.  Цэгүүд серверээс огноогоор
 *  эрэмбэлэгдэж ирдэг тул үлдэх нь ҮРГЭЛЖ хамгийн эрт нь. */
const MIN_GAP_PCT = 1.5;

const MARK_WIDTH = 2;
/** Үндсэн хугацаа баарнаас (h-1.5 = 6px) дээш доош 2px-ээр цухуйна. */
const MARK_HEIGHT = 10;
const SUB_MARK_HEIGHT = 6;

/**
 * 'YYYY-MM-DD' → эрин үеэс хойшх ӨДРИЙН дугаар.
 *
 * `new Date('2026-08-14')` нь UTC-ээр, `new Date(2026, 7, 14)` нь орон
 * нутгийн цагаар уншигддаг тул хоёрыг хольвол UB (UTC+8) дээр огноо нэг
 * хоногоор гулсана.  Тиймээс ГУРВУУЛАНГ нь `Date.UTC`-ээр нэг хэлээр
 * уншиж, бүхэл өдрөөр харьцуулна.
 */
function dayNumber(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return Date.UTC(y, mo - 1, d) / 86_400_000;
}

export function DeadlineBarMarks({
  points,
  startDate,
  finishDate,
}: {
  points: DeadlinePoint[] | undefined;
  startDate: string | null | undefined;
  finishDate: string | null | undefined;
}) {
  if (!points || points.length === 0) return null;

  const start = dayNumber(startDate);
  const finish = dayNumber(finishDate);
  // Хуваарьгүй төсөлд баар өөрөө хоосон (`getScheduleProgress` null) —
  // тэнхлэг байхгүй тул тэмдэглэгээ ч байх ёсгүй.
  if (start === null || finish === null || finish <= start) return null;

  const span = finish - start;
  const marks: { point: DeadlinePoint; pct: number }[] = [];
  let lastPct = Number.NEGATIVE_INFINITY;

  for (const p of points) {
    const due = dayNumber(p.due_date);
    if (due === null) continue;
    const pct = ((due - start) / span) * 100;
    if (pct < 0 || pct > 100) continue;
    if (pct - lastPct < MIN_GAP_PCT) continue;
    lastPct = pct;
    marks.push({ point: p, pct });
  }

  if (marks.length === 0) return null;

  return (
    // `aria-hidden` — бүтэн жагсаалт нь баарны hover хөзөрт байгаа тул
    // дэлгэц уншигчид эдгээр зураасыг давхар уншуулах шаардлагагүй.
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {marks.map(({ point, pct }) => (
        <span
          key={point.id}
          // Radix `<Tooltip>` ЗОРИУДААР биш: жагсаалтад 20 төсөл × 10 цэг =
          // 200 нэмэлт portal болно (`GanttRow`-ийн ижил шийдвэр).
          title={`${point.due_date} · ${point.title}`}
          className={cn(
            'pointer-events-auto absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full',
            // Дууссан хугацаа — тайван ногоон.  Эрсдэлийн өнгө нь зөвхөн
            // ХИЙГДЭЭГҮЙ мөрөнд утгатай.
            point.done ? 'bg-success/60 opacity-70' : RISK_TONE[point.risk_state].bar,
          )}
          style={{
            left: `${pct}%`,
            width: MARK_WIDTH,
            height: point.is_sub ? SUB_MARK_HEIGHT : MARK_HEIGHT,
          }}
        />
      ))}
    </span>
  );
}

export default DeadlineBarMarks;
