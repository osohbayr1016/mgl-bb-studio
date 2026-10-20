/**
 * Scene «30 хоногийн идэвх» — өдөр бүрийн батлагдсан явцын бичилт.
 *
 * ═══ ЗАСВАРЫН ТҮҮХ — дахин давтахгүй байх гурван алдаа ═══
 *
 * (1) recharts `AreaChart` + tooltip (2026-08-25-нд устсан).  Утга нь ЗӨВХӨН
 *     tooltip дотор байсан бөгөөд энэ бол ЗААГЧГҮЙ kiosk — hover хэзээ ч
 *     болохгүй тул график дээрх ямар ч тоог унших арга байгаагүй.  Мөн муруй
 *     нь `hsl(var(--primary))`-ээр зурагддаг байсан: энэ хуудас `<html>`-ийн
 *     theme классыг өвлөдөг тул оператор light горимд байхад --primary нь
 *     бараг цагаан болж, харанхуй самбар дээр муруй арилдаг байв.
 *
 * (2) Багана бүрийн ТОЛГОЙ ДЭЭР шошго (мөн өдөр устсан).  Тоо нь баганынхаа
 *     өндрийг дагадаг тул 30 тоо шатлан дээш доош үсэрч, «дээр доор бичигдсэн»
 *     эмх замбараагүй мөр үүсгэдэг байв.  ⇒ ТОО БҮР ЯГ НЭГ ШУГАМ ДЭЭР, суурийн
 *     доор, tabular mono-гоор бичигдэнэ.  Багана дээр юу ч бичихгүй.  Энэ бол
 *     гоо зүйн дур сонирхол БИШ — уншигдах чадварын шаардлага.
 *
 * (3) Амралтын өдөр тэмдэглэгдээгүй байсан.  Компани хагас сайн/бүтэн сайн
 *     өдөр амардаг тул долоо хоног бүр хоёр өдөр 0 болдог; тасархай муруй
 *     үүнийг «ажил зогссон» мэт харуулдаг байв.  «Идэвхтэй өдөр» нь бас `/30`
 *     хуваарьтай байсан — амралтыг «алдсан өдөр» гэж тоолдог.  ⇒ амралтын
 *     өдөр өөрийн бүдэг туузтай, тооны мөрөнд «·» тавигдана, дундаж болон
 *     хуваарь хоёулаа ЗӨВХӨН ажлын өдрөөр тооцогдоно.
 *
 * ЗОХИОМЖ (дээрээс доош):
 *   тайлбарын мөр → үзүүлэлтийн тууз → багана + ажлын өдрийн дундаж шугам →
 *   суурийн шугам → ТОО (нэг эгнээ) → гараг → огноо.
 *   Долоо хоног бүрийн эхэнд (Даваа) босоо үсний ширхэг зураас — сарын хэмнэл
 *   нүдэнд шууд харагдана.
 *
 * ⚠ 2026-09-10-нд ЭЗНИЙ ШИЙДВЭРЭЭР устсан, буцааж нэмэхгүй: «ХЭМЖИГДЭХҮҮН»
 *   тайлбарын нүд, «Хамгийн олон хувь нэмэр» нүд (`contributor_count`
 *   уншигдахаа болив) болон доод түлхүүр (legend) + амралтын өдрийн тэмдэглэл.
 *   Амралтын өдөр графикт бүдэг туузаараа, тооны мөрөнд «·»-ээр ялгагдсаар.
 *
 * ⚠ Багана, тоо, гараг, огноо ДӨРВҮҮЛЭЭ НЭГ `grid`-ийн ижил баганад суудаг.
 *   Тусдаа flex мөрүүдээр өргөнийг «тааруулах» гэвэл 30 нүдэн дээр 1px-ээр
 *   гулсаж, тоо баганаасаа хазайдаг.
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '@/shared/i18n';
import { CountUp } from './CountUp';
import { TV, TV_CHART, TV_SIZE, metaStyle, tvNumber } from './theme';
import { SceneMeta } from './SceneMeta';
import { formatMd } from './format';

export interface ActivityDay {
  date: string;
  entry_count: number;
}

/** Баганын өргөн — нүдийг бүтнээр нь дүүргэхгүй, үлдсэнийг агаар болгоно. */
const BAR_W = '1.4vw';
/** Хамгийн бага харагдах өндөр (%) — 1 бичилттэй өдөр алга болохгүй. */
const MIN_H = 1.5;

/** UTC-гээр гараг (0=Ням).  Backend-ийн `workSchedule.isWeekend`-тэй ИЖИЛ
 *  тэнхлэг — цагийн бүсээр гулсвал амралтын өдөр нэг нүд зөрнө. */
function weekdayIndex(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function isRestDay(iso: string): boolean {
  const d = weekdayIndex(iso);
  return d === 0 || d === 6;
}

/** Mount хийсний дараа `true` — CSS шилжилтийг өдөөнө (PulseScene-тэй ижил
 *  хэв маяг).  Кадар солигдох бүрт `key` шинэчлэгддэг тул багана бүр дахин
 *  ургана — хананд өлгөөтэй самбарыг «амьд» байлгах хөдөлгөөн. */
function useEnter(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}

export function ActivityScene({ days }: { days: ActivityDay[] }) {
  const { t } = useLanguage();
  const on = useEnter();

  if (days.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center"
        style={{ fontSize: TV_SIZE.h2, color: TV.ink3 }}
      >
        {t('companyTvPage.actNoData')}
      </div>
    );
  }

  const initials = t('companyTvPage.weekdayInitials').split(',');
  const todayIdx = days.length - 1;

  const workDays = days.filter((d) => !isRestDay(d.date));
  const workAvg =
    workDays.length > 0 ? workDays.reduce((s, d) => s + d.entry_count, 0) / workDays.length : 0;
  const activeWorkDays = workDays.filter((d) => d.entry_count > 0).length;

  const total = days.reduce((s, d) => s + d.entry_count, 0);
  const peak = days.reduce<ActivityDay | null>(
    (m, d) => (m === null || d.entry_count > m.entry_count ? d : m),
    null,
  );
  const peakCount = peak?.entry_count ?? 0;

  // Тэнхлэгийн дээд утга.  Багана дээр шошго БАЙХГҮЙ тул толгойн зай бага —
  // оргил нь талбайн ~92%-ийг эзэлж, дундажийн шошгонд амьсгал үлдэнэ.
  const scaleMax = Math.max(1, peakCount) * 1.08;
  const meanPct = (workAvg / scaleMax) * 100;

  return (
    <div className="flex h-full flex-col">
      <SceneMeta
        items={[
          {
            label: t('companyTvPage.metaPeriod'),
            value: t('companyTvPage.metaPeriodValue', {
              from: formatMd(days[0]?.date),
              to: formatMd(days[todayIdx]?.date),
              days: days.length,
            }),
          },
        ]}
      />

      {/* ── Үзүүлэлтийн тууз.  «Ажлын өдөр»-ийн хуваарь нь АЖЛЫН өдрийн
             тоо (амралт биш) — өмнөх /30 нь амралтыг алдагдал гэж тоолдог. */}
      <div className="mt-[1.8vh] flex shrink-0" style={{ borderTop: `1px solid ${TV.line}` }}>
        <Tile label={t('companyTvPage.actTotal')} value={total} first />
        <Tile
          label={t('companyTvPage.actWorkdayAvg')}
          value={Math.round(workAvg * 10) / 10}
          decimals={1}
          tone={TV_CHART.primary}
        />
        <Tile
          label={t('companyTvPage.actActiveDays')}
          value={activeWorkDays}
          sub={t('companyTvPage.actOfWorkdays', { count: workDays.length })}
        />
        <Tile
          label={t('companyTvPage.actPeak')}
          value={peakCount}
          sub={peak ? formatMd(peak.date) : undefined}
          tone={TV_CHART.emphasis}
        />
      </div>

      {/* ══════════════ График ══════════════ */}
      <div
        className="mt-[2.4vh] grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
          gridTemplateRows: 'minmax(0, 1fr) auto auto auto',
          columnGap: '0.28vw',
        }}
      >
        {/* — 1-р мөр: багана — */}
        {days.map((d, i) => {
          const rest = isRestDay(d.date);
          const today = i === todayIdx;
          const isPeak = !rest && d.entry_count > 0 && d.entry_count === peakCount;
          const h = Math.max(d.entry_count > 0 ? MIN_H : 0, (d.entry_count / scaleMax) * 100);
          const fill = today
            ? `linear-gradient(to top, rgba(192,134,0,0.45), ${TV_CHART.emphasis})`
            : rest
              ? TV_CHART.muted
              : `linear-gradient(to top, rgba(62,143,224,0.35), ${TV_CHART.primary})`;
          return (
            <div
              key={`bar-${d.date}`}
              className="relative"
              style={{
                gridRow: 1,
                gridColumn: i + 1,
                // Долоо хоногийн эхлэл (Даваа) — сарын хэмнэлийн зураас.
                borderLeft:
                  i > 0 && weekdayIndex(d.date) === 1 ? `1px solid ${TV.line}` : undefined,
              }}
            >
              {rest && (
                <span
                  className="absolute inset-0"
                  style={{ background: 'rgba(147, 175, 214, 0.05)' }}
                />
              )}
              <span
                className="absolute bottom-0 left-1/2"
                style={{
                  width: BAR_W,
                  marginLeft: `calc(${BAR_W} / -2)`,
                  height: on ? `${h}%` : '0%',
                  background: fill,
                  borderRadius: '3px 3px 0 0',
                  // Өнөөдрийг гэрэлтүүлнэ — 3-5 метрээс «одоо» гэдэг шууд
                  // олдох ёстой.  Оргил өдөр нимгэн туяатай.
                  boxShadow: today
                    ? '0 0 1.4vw rgba(192,134,0,0.55)'
                    : isPeak
                      ? '0 0 0.9vw rgba(62,143,224,0.40)'
                      : undefined,
                  transition: `height 620ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 22}ms`,
                }}
              />
            </div>
          );
        })}

        {/* — Ажлын өдрийн дундаж: бүх баганыг ГАТАЛСАН нэг шугам — */}
        {workAvg > 0 && (
          <div
            className="pointer-events-none relative"
            style={{ gridRow: 1, gridColumn: '1 / -1', zIndex: 5 }}
          >
            <span
              className="absolute inset-x-0"
              style={{
                bottom: `${meanPct}%`,
                height: '1px',
                background: TV.lineStrong,
                opacity: on ? 1 : 0,
                transition: 'opacity 500ms ease-out 700ms',
              }}
            />
            <span
              className="absolute right-0"
              style={{
                bottom: `calc(${meanPct}% + 0.4vh)`,
                ...metaStyle,
                fontSize: '0.74vw',
                color: TV.ink3,
                opacity: on ? 1 : 0,
                transition: 'opacity 500ms ease-out 700ms',
              }}
            >
              {t('companyTvPage.actAvgLine', {
                value: (Math.round(workAvg * 10) / 10).toFixed(1),
              })}
            </span>
          </div>
        )}

        {/* — Суурийн шугам: тооны мөрийг графикаас тусгаарлана — */}
        <div
          style={{ gridRow: 2, gridColumn: '1 / -1', height: '1px', background: TV.lineStrong }}
        />

        {/* — 3-р мөр: ТОО.  Бүгд ЯГ НЭГ шугам дээр. — */}
        {days.map((d, i) => {
          const rest = isRestDay(d.date);
          const today = i === todayIdx;
          const isPeak = !rest && d.entry_count > 0 && d.entry_count === peakCount;
          return (
            <span
              key={`num-${d.date}`}
              className="text-center"
              style={{
                gridRow: 3,
                gridColumn: i + 1,
                paddingTop: '0.9vh',
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: '0.86vw',
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
                fontWeight: today || isPeak ? 700 : 400,
                color: today
                  ? TV_CHART.emphasis
                  : rest
                    ? 'rgba(87, 105, 127, 0.55)'
                    : d.entry_count > 0
                      ? TV.ink2
                      : TV_CHART.bad,
                opacity: on ? 1 : 0,
                transition: `opacity 400ms ease-out ${300 + i * 22}ms`,
              }}
            >
              {/* Амралтын өдрийн 0 бол ТОО БИШ — «·».  Ажлын өдрийн 0 нь
                  жинхэнэ 0 бөгөөд улаанаар үлдэнэ. */}
              {rest && d.entry_count === 0 ? '·' : d.entry_count}
            </span>
          );
        })}

        {/* — 4-р мөр: гараг + огноо — */}
        {days.map((d, i) => {
          const rest = isRestDay(d.date);
          const today = i === todayIdx;
          return (
            <div
              key={`ax-${d.date}`}
              className="flex flex-col items-center gap-[0.15vh]"
              style={{ gridRow: 4, gridColumn: i + 1, paddingTop: '0.8vh' }}
            >
              <span
                style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: '0.7vw',
                  lineHeight: 1,
                  color: today ? TV_CHART.emphasis : rest ? 'rgba(87,105,127,0.65)' : TV.ink3,
                  fontWeight: today ? 700 : 400,
                }}
              >
                {initials[weekdayIndex(d.date)] ?? ''}
              </span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: '0.7vw',
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                  color: today ? TV_CHART.emphasis : 'rgba(87,105,127,0.65)',
                  fontWeight: today ? 700 : 400,
                }}
              >
                {d.date.slice(8, 10)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
  decimals,
  first,
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: string;
  /** Аравтын орон — «ажлын өдрийн дундаж» нь бүхэл тоо байх албагүй. */
  decimals?: number;
  first?: boolean;
}) {
  return (
    <div
      className="flex flex-1 flex-col gap-[0.5vh] px-[1.4vw] pt-[1.5vh]"
      style={first ? undefined : { borderLeft: `1px solid ${TV.line}` }}
    >
      <span style={{ ...metaStyle, color: TV.ink3 }}>{label}</span>
      <div className="flex items-baseline gap-[0.6vw]">
        <CountUp
          value={value}
          format={decimals ? (n) => n.toFixed(decimals) : tvNumber}
          style={{
            fontSize: '2.3vw',
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
            color: tone ?? TV.ink,
          }}
        />
        {sub && <span style={{ ...metaStyle, color: TV.ink3 }}>{sub}</span>}
      </div>
    </div>
  );
}
