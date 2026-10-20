/**
 * Scene «Компанийн самбар» — өнөөдрийн байдал.
 *
 * ӨМНӨХ ХУВИЛБАРЫН АСУУДАЛ: 2×2 сүлжээнд дөрвөн `text-[10rem]` тоо.  Тоо
 * дангаараа контекстгүй — 81% гэдэг нь сайн уу, муу юу, өчигдрөөс өссөн үү
 * гэдгийг хэлж чадахгүй.  Дөрвөн ижил хайрцаг нь мөн дэлгэцийн шатлалыг
 * тэгшилж, юу нь чухал болохыг харуулахаа больдог.
 *
 * ФОРМЫГ АЖЛААР НЬ СОНГОСОН (өнгийг хамгийн сүүлд):
 *   • Ирц = хязгаартай харьцуулсан НЭГ харьцаа  → нумтай хэмжүүр + нэгжийн
 *     цэгэн диаграм.  63 цэг, ирсэн нь асна — «81%» гэсэн хийсвэр тооноос
 *     хамаагүй хурдан уншигдаж, хүн бүрийг нэг цэгээр төлөөлүүлснээр
 *     самбарыг хүнлэг болгоно.
 *   • Төслийн явц = ЗОРИЛТТОЙ харьцуулах → хэвтээ багана, тэнхлэг нь үргэлж
 *     0-100%.  БҮГД НЭГ өнгөтэй: уртад нь аль хэдийн кодлогдсон мэдээллийг
 *     өнгөөр давхарлах нь цорын ганц сул сувгийг дэмий үрнэ.
 *     ⚠ Энд ТӨСӨЛ ТУС БҮРИЙН ХҮНИЙ ТООГ ГАРГАХГҮЙ (2026-08-19-ны шийдвэр):
 *     өмнө байсан «Талбай дээр» багана болон 6 дахь кадар хоёулаа түүний
 *     улмаас устсан.  Буцааж нэмэхгүй.
 *
 * ⚠ 2026-09-10-нд ЭЗНИЙ ШИЙДВЭРЭЭР устсан, буцааж нэмэхгүй:
 *   · «14 хоногийн бичилт» багана + «өнөөдөр N» тэмдэглэл (баруун доод
 *     хэсэг) — төслийн явц одоо баруун баганыг бүтнээр эзэлнэ;
 *   · ирцийн доорх «N хүн ирээгүй / Бүрэн бүрэлдэхүүн» мөр;
 *   · доод туузны «Хэтэрсэн даалгавар» нүд (`totals.tasks_overdue` уншигдахаа
 *     болив).
 *
 * ХОЛБОГДОХ ХЯЗГААР: энэ бол kiosk — заагч байхгүй тул tooltip/hover давхарга
 * ОГТ БАЙХГҮЙ.  Иймд утга бүр шууд шошготой байх ёстой (tooltip-д нуугдах
 * боломжгүй), тэнхлэг нь ойлгомжтой байх ёстой.
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '@/shared/i18n';
import { CountUp, useCountUp } from './CountUp';
import { TV, TV_CHART, TV_SIZE, metaStyle, tvNumber } from './theme';

/* ──────────────────────────  дата хэлбэр  ────────────────────────── */

export interface PulseData {
  totals: {
    projects_active: number;
    projects_total: number;
    tasks_total: number;
    drawings_total: number;
  };
  people: {
    attendance_today: { present: number; total: number; percentage: number };
  };
  /** Төслүүд явцынхаа хувьтай — /overview-ийн `portfolio`.
   *  ⚠ Энэ жагсаалт ИДЭВХТЭЙ төслөөр шүүгдээгүй ирдэг (route-ийн SQL-д WHERE
   *  байхгүй), тиймээс энэ scene өөрөө `status === 'active'`-ээр шүүнэ — эс
   *  тэгвэл архивласан 100%-тай төсөл жагсаалтын толгойд суух болно. */
  portfolio: Array<{ id: number; name: string; status: string | null; progress: number }>;
}

/** Mount хийсний дараа `true` болно — CSS шилжилтийг өдөөнө. */
function useEnter(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}

/** Явцын баганын дээд тоо.  Баруун багана бүтнээрээ энэ хэсгийнх болсон тул
 *  1080p дээр 8 мөр (мөр бүр ~1.5vh зайтай) чөлөөтэй багтана. */
const MAX_PROGRESS_ROWS = 8;

/* ════════════════════════════  scene  ════════════════════════════ */

export function PulseScene({ data }: { data: PulseData }) {
  const { t } = useLanguage();
  const { attendance_today: att } = data.people;
  // Хамгийн их явцтай нь дээрээ.  /overview аль хэдийн явцаар эрэмбэлж
  // өгдөг ч энд ил бичсэн нь зориудынх — энэ кадрын эрэмбэ backend-ийн
  // эрэмбийн хажуугийн үр дагавар байх ёсгүй.
  const activeProjects = data.portfolio.filter((p) => p.status === 'active');
  const topProjects = [...activeProjects]
    .sort((a, b) => b.progress - a.progress)
    .slice(0, MAX_PROGRESS_ROWS);

  return (
    <div className="flex h-full flex-col">
      {/* ── Гол хэсэг: ирц (зүүн) · төслийн явц (баруун) ── */}
      <div className="grid min-h-0 flex-1 grid-cols-[5fr_7fr] gap-[2.4vw]">
        <Panel title={t('companyTvPage.pulseAttendance')}>
          <AttendanceBlock present={att.present} total={att.total} pct={att.percentage} />
        </Panel>

        <Panel
          title={t('companyTvPage.pulseClosestToDone')}
          note={t('companyTvPage.projectsSuffix', { count: activeProjects.length })}
        >
          <ProjectProgressBars rows={topProjects} />
        </Panel>
      </div>

      {/* ── Доод туузан үзүүлэлт ── */}
      <div className="mt-[2.6vh] flex" style={{ borderTop: `1px solid ${TV.line}` }}>
        <StripStat
          label={t('companyTvPage.pulseActiveProjects')}
          value={data.totals.projects_active}
          sub={t('companyTvPage.pulseOfTotal', { count: data.totals.projects_total })}
          first
        />
        <StripStat label={t('companyTvPage.eraDrawings')} value={data.totals.drawings_total} />
        <StripStat label={t('companyTvPage.eraTasks')} value={data.totals.tasks_total} />
      </div>
    </div>
  );
}

/* ────────────────────────────  бүрхүүл  ──────────────────────────── */

/** Гарчиг + сонголтоор тайлбартай хэсэг.  Хайрцаг БИШ — зөвхөн дээд шугам. */
function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header
        className="flex items-baseline justify-between pb-[1.2vh]"
        style={{ borderBottom: `1px solid ${TV.line}` }}
      >
        <h2 style={{ ...metaStyle, color: TV.ink2 }}>{title}</h2>
        {note && <span style={{ ...metaStyle, color: TV.ink3 }}>{note}</span>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col pt-[2vh]">{children}</div>
    </section>
  );
}

/* ──────────────────────  Ирц: нум + нэгжийн цэг  ────────────────── */

/**
 * Нумтай хэмжүүр.  Дараалсан НЭГ өнгө — хэмжүүр бол хэмжээ, ялгах зүйл биш.
 * 240° нээлттэй нум: доод хэсэг нээлттэй байх нь дүүрсэн хэсгийг тодруулна.
 */
function AttendanceArc({ pct }: { pct: number }) {
  const on = useEnter();
  const R = 42;
  const SWEEP = 240; // градус
  const len = 2 * Math.PI * R * (SWEEP / 360);
  const clamped = Math.max(0, Math.min(100, pct));

  return (
    <svg viewBox="0 0 100 100" style={{ width: '13vw', height: '13vw' }} aria-hidden>
      <g transform="rotate(150 50 50)">
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke={TV_CHART.track}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${len} 999`}
        />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke={TV_CHART.primary}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${len} 999`}
          strokeDashoffset={on ? len * (1 - clamped / 100) : len}
          style={{ transition: 'stroke-dashoffset 1400ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </g>
    </svg>
  );
}

function AttendanceBlock({ present, total, pct }: { present: number; total: number; pct: number }) {
  const shownPct = useCountUp(pct);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-[1.6vw]">
        {/* Нум ба түүний голд хувь — хоёулаа НЭГ утгыг хэлнэ, тиймээс
            хамтдаа сууна (тусдаа хайрцагт биш). */}
        <div className="relative shrink-0">
          <AttendanceArc pct={pct} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              style={{
                fontSize: '3.4vw',
                fontWeight: 700,
                lineHeight: 1,
                letterSpacing: '-0.03em',
                // Тоо шууд өсөж байгаа тул tabular — эс бөгөөс орон солигдох
                // бүрт өргөн нь хэлбэлзэж «чичирнэ».
                fontVariantNumeric: 'tabular-nums',
                color: TV.ink,
              }}
            >
              {Math.round(shownPct)}
              <span style={{ fontSize: '1.6vw', color: TV.ink3 }}>%</span>
            </span>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-baseline gap-[0.5vw]">
            <CountUp
              value={present}
              format={tvNumber}
              style={{
                fontSize: '4.6vw',
                fontWeight: 700,
                lineHeight: 1,
                letterSpacing: '-0.03em',
                fontVariantNumeric: 'tabular-nums',
                color: TV_CHART.primary,
              }}
            />
            <span style={{ fontSize: '2vw', fontWeight: 500, color: TV.ink3 }}>/ {total}</span>
          </div>
        </div>
      </div>

      <UnitDots present={present} total={total} />
    </div>
  );
}

/**
 * Нэгжийн цэгэн диаграм — ажилтан бүр нэг цэг.
 *
 * Хүн БҮРИЙГ нэг тэмдгээр төлөөлүүлэх нь хувийг харааны МАСС болгож хувиргана:
 * «81%» гэдгийг тархиар тооцох шаардлагагүй, асаагүй цэгүүд шууд харагдана.
 * Цэгүүд нэрлэгдээгүй (лоббид нэр гаргахгүй) тул эхний N нь асна — нэгжийн
 * диаграмд хэн аль цэг болох нь ач холбогдолгүй.
 */
function UnitDots({ present, total }: { present: number; total: number }) {
  const on = useEnter();
  if (total <= 0) return null;
  // Дэлгэцийн өргөнд тохирсон багана — 63 хүнд 16 багана ≈ 4 мөр.
  const cols = Math.min(20, Math.max(10, Math.ceil(Math.sqrt(total * 3.4))));
  return (
    <div
      className="mt-[3vh] grid gap-[0.55vw]"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      role="img"
      aria-label={`${present}/${total}`}
    >
      {Array.from({ length: total }, (_, i) => {
        const lit = i < present;
        return (
          <span
            key={i}
            style={{
              aspectRatio: '1',
              borderRadius: '9999px',
              background: lit ? TV_CHART.primary : 'transparent',
              border: lit ? 'none' : `1px solid ${TV_CHART.track}`,
              opacity: on ? 1 : 0,
              transform: on ? 'scale(1)' : 'scale(0.4)',
              // Долгион маягаар асна — бүгд зэрэг гарахаас илүү анзаарагдана.
              transition: `opacity 420ms ease-out ${i * 14}ms, transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 14}ms`,
            }}
          />
        );
      })}
    </div>
  );
}

/* ────────────────────  Төслийн явц: хэвтээ багана  ──────────────── */

/**
 * Аль төсөл хэдэн хувьтай явж байгаа нь.  Төслийн нэр урт, монгол хэл дээр
 * тул босоо биш ХЭВТЭЭ (нэр таслагдахгүй).  Эрэмбэ нь хамгийн их явцтай
 * төслийг дээр гаргана.
 *
 * ⚠ ТЭНХЛЭГ НЬ ҮРГЭЛЖ 0-100%, хамгийн урт баганаар НОРМЧИЛДОГГҮЙ.  Нормчилвол
 * 22%-тай төсөл бүтэн урттай зурагдаж «дуусах дөхсөн» гэсэн ХУДАЛ уншилт
 * өгнө — энэ багана нь тогтмол зорилттой (100%) харьцуулсан хэмжигдэхүүн.
 *
 * БҮХ БАГАНА НЭГ ӨНГӨТЭЙ: уртад аль хэдийн байгаа мэдээллийг өнгөнд
 * давхарлах нь ялгах чөлөөт сувгийг дэмий үрнэ.
 */
function ProjectProgressBars({ rows }: { rows: PulseData['portfolio'] }) {
  const { t } = useLanguage();
  const on = useEnter();
  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center" style={{ fontSize: TV_SIZE.h3, color: TV.ink3 }}>
        {t('companyTvPage.noActiveProjects')}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-[1.5vh] overflow-hidden">
      {rows.map((p, i) => (
        <div key={p.id} className="flex items-center gap-[1vw]">
          <span
            className="truncate"
            style={{ width: '38%', fontSize: TV_SIZE.h3, fontWeight: 500, color: TV.ink }}
          >
            {p.name}
          </span>
          <div className="relative flex-1" style={{ height: '1.5vh' }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: TV_CHART.track,
                borderRadius: '2px',
              }}
            />
            <div
              style={{
                position: 'absolute',
                insetBlock: 0,
                left: 0,
                width: on ? `${Math.max(0, Math.min(100, p.progress))}%` : '0%',
                background: TV_CHART.primary,
                borderRadius: '2px',
                transition: `width 900ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 90}ms`,
              }}
            />
          </div>
          {/* Утга бүр ШУУД шошготой — kiosk-д tooltip байхгүй тул нуух газар алга. */}
          <span
            style={{
              // «100%» багтахаар — 3.2vw дээр гурван орон + тэмдэг таслагдана.
              width: '4.4vw',
              textAlign: 'right',
              fontSize: TV_SIZE.h3,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: TV.ink,
            }}
          >
            {Math.round(p.progress)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────  доод тууз  ────────────────────────── */

function StripStat({
  label,
  value,
  sub,
  first,
}: {
  label: string;
  value: number;
  sub?: string;
  first?: boolean;
}) {
  return (
    <div
      className="flex flex-1 flex-col gap-[0.5vh] px-[1.6vw] pt-[1.8vh]"
      style={first ? undefined : { borderLeft: `1px solid ${TV.line}` }}
    >
      <span style={{ ...metaStyle, color: TV.ink3 }}>{label}</span>
      <div className="flex items-baseline gap-[0.7vw]">
        <CountUp
          value={value}
          format={tvNumber}
          style={{
            fontSize: '2.5vw',
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
            color: TV.ink,
          }}
        />
        {sub && <span style={{ ...metaStyle, color: TV.ink3 }}>{sub}</span>}
      </div>
    </div>
  );
}
