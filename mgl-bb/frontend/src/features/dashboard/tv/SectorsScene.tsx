/**
 * Scene «Багуудын явц» — мэргэжлийн баг тус бүр хаана хүрсэн бэ.
 *
 * ═══ ЭНЭ КАДАР ЯМАР АСУУЛТАД ХАРИУЛДАГ ВЭ ═══
 *   «Барилга архитектур, Цахилгаан, Цэвэр бохир ус … эдгээр багууд компанийн
 *    идэвхтэй бүх төсөл дээр нийлээд хэдэн хувьтай явж байна вэ?»
 * Хариулт нь мөр бүрийн БҮТЭН нэр, гүйцэтгэсэн даалгаврын тоо, 0-100%-ийн
 * багана, хувь, сүүлийн 30 хоногийн өөрчлөлт — зургаан багана, тус бүр нь
 * толгойдоо шошготой.
 *
 * ═══ ЗАСВАРЫН ТҮҮХ — хоёр удаа бүтэлгүйтсэн, шалтгаан нь бүртгэгдсэн ═══
 *
 * (1) recharts multi-line (анхны хувилбар).  11 хүртэлх багийн шугам нэг
 *     тэнхлэг дээр давхарлагдаж спагетти болдог; ангилалын өнгөний тааз 7-8
 *     бөгөөд kiosk дээр hover БАЙХГҮЙ тул legend-ийн өнгийг муруйтай нүдээр
 *     тааруулах болно.  Мөн X тэнхлэг нь зөвхөн `getDate()` (27 28 … 01 02)
 *     байсан тул сар давахад цуваа эргэсэн мэт харагддаг байв.
 *
 * (2) «Өмнөх → одоо» хоёр өнгийн багана (2026-08-25).  Хугацаа, хэмжигдэхүүн
 *     ил бичигдсэн ч ХЭРЭГЛЭГЧ ОЙЛГООГҮЙ: нэг багана дотор хоёр өнгө байгаа
 *     нь legend уншихыг шаарддаг, `▲ 4.2` нь нэгжгүй, «TSBU» гэдэг код нь
 *     танихгүй хүнд утгагүй, харин «62%» нь ЮУНЫ 62% болох нь хаана ч
 *     бичигдээгүй.
 *
 * ⇒ ОДООГИЙН ДҮРЭМ (зөрчихөөс өмнө бод):
 *     · Багана НЭГ өнгөтэй, НЭГ утга (одоогийн гүйцэтгэл).  Хоёр өнгө = хоёр
 *       санаа = legend = алдагдсан секунд.
 *     · Багана бүрийн ДЭЭР шошготой хүснэгтийн толгой байна.  Тайлбаргүй тоо
 *       гаргахгүй.
 *     · Хувийн хажууд нь үргэлж «N / M даалгавар» гарна — хувийг газардуулах
 *       цорын ганц зүйл.  M = `teams[].task_count` (багийн эзэмшлийн даалгавар
 *       идэвхтэй төслүүд дээр).  ⚠ N нь `done_count` БИШ (2026-09-10-ны
 *       шийдвэр): 100%-д хаагдсан даалгавар ховор тул тэр тоо ихэнх багт 0–2
 *       гарч, хажуугийн 30–60%-тай зөрж «худал» уншигддаг байв.  Одоо N =
 *       ГҮЙЦЭТГЭЛИЙН ЭКВИВАЛЕНТ = round(now% × M / 100) — өөрөөр хэлбэл «M
 *       даалгаврын хэдэн даалгавартай тэнцэх ажил хийгдсэн бэ».  N/M нь хувьтай
 *       ЯГ таардаг (38/60 ↔ 63%).  Backend-ийн `done_count` хэвээр ирдэг,
 *       зүгээр л энд уншигдахгүй.
 *     · Ангилалын өнгө ОГТ БАЙХГҮЙ.  Багийг НЭР нь нэрлэнэ, мөн уртаараа аль
 *       хэдийн хэлсэн зүйлийг өнгөөр давхарлахгүй.
 *     · «Код» багана (TSBU, HAS …) ба доод тайлбарын мөр 2026-09-10-нд эзний
 *       шийдвэрээр устсан — буцааж нэмэхгүй.
 *
 * Дата: `GET /api/company/charts/timeseries?days=30`.
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '@/shared/i18n';
import type { CompanyChartsTimeseries } from '@/shared/types';
import { TV, TV_CHART, TV_SIZE, metaStyle } from './theme';
import { SceneMeta } from './SceneMeta';
import { useRowCapacity } from './useRowCapacity';
import { formatMd } from './format';

/** 25%-ийн тор — багана бүрийн ард яг нэг ижил байрлалд. */
const TICKS = [25, 50, 75] as const;

/** Мөрийн баганын өргөн — толгой ба өгөгдлийн мөр ХОЁУЛАА үүнийг ашиглана,
 *  тиймээс шошго нь баганаасаа хэзээ ч салахгүй. */
const GRID = '2.6vw 22% 9.5vw 1fr 5vw 8vw';

interface TeamRow {
  /** Зөвхөн түлхүүр ба `points`-ийн баганын нэр — дэлгэцэнд гардаггүй. */
  code: string;
  name: string;
  now: number;
  was: number;
  taskCount: number;
  /** Гүйцэтгэлийн эквивалент даалгавар — толгойн тайлбарыг үз. */
  doneEquivalent: number;
}

function num(v: number | string | undefined): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function useEnter(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}

/** Багийн тоо (одоогоор 11) бүтнээрээ багтвал бүгдийг нь харуулна — тааз нь
 *  зөвхөн дэлгэц багтаахгүй үед л ажиллана. */
const MAX_TEAM_ROWS = 11;

export function SectorsScene({ charts }: { charts: CompanyChartsTimeseries | null }) {
  const { t } = useLanguage();
  const on = useEnter();
  const { ref: listRef, capacity } = useRowCapacity(MAX_TEAM_ROWS);

  if (!charts) return <Center text={t('common.loading')} />;

  const { teams, points } = charts.teams;
  if (teams.length === 0 || points.length === 0) {
    return <Center text={t('companyTvPage.noTeamData')} />;
  }

  const firstRow = points[0];
  const lastRow = points[points.length - 1];
  const spanDays = points.length;

  const rows: TeamRow[] = teams
    .map((team) => {
      const now = num(lastRow?.[team.code]);
      const taskCount = Math.max(0, team.task_count ?? 0);
      return {
        code: team.code,
        name: team.name,
        now,
        was: num(firstRow?.[team.code]),
        taskCount,
        doneEquivalent: Math.min(taskCount, Math.round((now / 100) * taskCount)),
      };
    })
    .sort((a, b) => b.now - a.now || b.taskCount - a.taskCount);

  return (
    <div className="flex h-full flex-col">
      <SceneMeta
        items={[
          {
            label: t('companyTvPage.metaPeriod'),
            value: t('companyTvPage.metaPeriodValue', {
              from: formatMd(charts.from),
              to: formatMd(charts.to),
              days: spanDays,
            }),
          },
          { label: t('companyTvPage.metaTeams'), value: String(rows.length) },
        ]}
      />

      {/* ── Энэ кадар ЮУГ харуулж байгааг нэг мөрөөр.  Тайлбаргүй бол «62%»
             гэдэг нь юуны 62% болох нь мэдэгдэхгүй. ── */}
      <p
        className="mt-[1.8vh] shrink-0"
        style={{ fontSize: TV_SIZE.h3, fontWeight: 500, color: TV.ink2, lineHeight: 1.35 }}
      >
        {t('companyTvPage.teamsExplain')}
      </p>

      {/* ── Хүснэгтийн толгой — багана бүр НЭРЛЭГДСЭН байна ── */}
      <div
        className="mt-[2.2vh] grid shrink-0 items-baseline gap-x-[1vw] pb-[1vh]"
        style={{ gridTemplateColumns: GRID, borderBottom: `1px solid ${TV.lineStrong}` }}
      >
        <span style={{ ...metaStyle, color: TV.ink3, textAlign: 'right' }}>#</span>
        <span style={{ ...metaStyle, color: TV.ink3 }}>{t('companyTvPage.metaTeams')}</span>
        <span style={{ ...metaStyle, color: TV.ink3 }}>{t('companyTvPage.teamsColDone')}</span>
        <span style={{ ...metaStyle, color: TV.ink3 }}>{t('companyTvPage.teamsColBar')}</span>
        <span style={{ ...metaStyle, color: TV.ink3, textAlign: 'right' }}>
          {t('companyTvPage.colProgress')}
        </span>
        <span
          className="whitespace-nowrap"
          style={{ ...metaStyle, color: TV.ink3, textAlign: 'right' }}
        >
          {t('companyTvPage.teamsColDelta', { days: spanDays })}
        </span>
      </div>

      {/* ── Мөрүүд ──
             ⚠ `overflow-hidden` + `useRowCapacity` ЗААВАЛ.  Багийн тоо 11
             хүрч, эсвэл удирдлагын мөр гарч ирэхэд жагсаалт `justify-center`
             савнаасаа ХОЁР ТИЙШ халиад хүснэгтийн толгой дээр давхарладаг
             (Төслийн явц кадарт яг ийм эвдрэл гарсан).  Доод тайлбар устсан тул
             багтаагүй баг гэдгийг одоо дээрх «БАГ N» тоо л хэлнэ. */}
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden">
        {rows.slice(0, capacity).map((r, i) => (
          <TeamRowView key={r.code} row={r} rank={i + 1} index={i} on={on} />
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────  нэг багийн мөр  ────────────────────────── */

function TeamRowView({
  row,
  rank,
  index,
  on,
}: {
  row: TeamRow;
  rank: number;
  index: number;
  on: boolean;
}) {
  const { t } = useLanguage();
  const delta = Math.round((row.now - row.was) * 10) / 10;
  const grew = delta > 0.05;
  const shrank = delta < -0.05;

  return (
    <div
      data-tv-row
      className="grid items-center gap-x-[1vw] py-[0.9vh]"
      style={{ gridTemplateColumns: GRID, borderBottom: `1px solid ${TV.line}` }}
    >
      {/* Байр — «хэн тэргүүлж байна» нь эхний нүдэнд. */}
      <span
        style={{
          textAlign: 'right',
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: TV_SIZE.body,
          fontVariantNumeric: 'tabular-nums',
          color: rank === 1 ? TV_CHART.emphasis : TV.ink3,
          fontWeight: rank === 1 ? 700 : 400,
        }}
      >
        {rank}
      </span>

      {/* БҮТЭН нэр — өмнө нь зөвхөн «TSBU» гэсэн код харагддаг байсан бөгөөд
          лоббид зогсох зочин түүнийг уншиж чадахгүй. */}
      <span
        className="truncate"
        style={{ fontSize: TV_SIZE.h3, lineHeight: 1.1, fontWeight: 600, color: TV.ink }}
      >
        {row.name}
      </span>

      {/* Хувийг ГАЗАРДУУЛАХ тоо (гүйцэтгэлийн эквивалент — толгойг үз).
          Backend хуучин байвал 0/0 гарах тул огт үзүүлэхгүй — «0 / 0» гэдэг
          нь худал мэдээлэл. */}
      <span
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: TV_SIZE.body,
          fontVariantNumeric: 'tabular-nums',
          color: TV.ink2,
        }}
      >
        {row.taskCount > 0 ? `${row.doneEquivalent} / ${row.taskCount}` : '—'}
      </span>

      {/* Тэнхлэг нь ҮРГЭЛЖ 0-100%.  НЭГ өнгө. */}
      <div className="relative" style={{ height: '1.7vh' }}>
        <span
          className="absolute inset-0"
          style={{ background: TV_CHART.track, borderRadius: '2px' }}
        />
        {TICKS.map((tick) => (
          <span
            key={tick}
            className="absolute bottom-0 top-0"
            style={{ left: `${tick}%`, width: '1px', background: TV.bg, opacity: 0.9 }}
          />
        ))}
        <span
          className="absolute bottom-0 left-0 top-0"
          style={{
            width: on ? `${row.now}%` : '0%',
            background: `linear-gradient(to right, rgba(62,143,224,0.55), ${TV_CHART.primary})`,
            borderRadius: '2px',
            transition: `width 820ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 70}ms`,
          }}
        />
      </div>

      <span
        style={{
          textAlign: 'right',
          // ⚠ vw хэмжээ + ТОДОРХОЙ lineHeight.  Анхдагч 1.5 нь мөрийн өндрийг
          //   ~80px болгож, 11 багтай үед жагсаалт `overflow-hidden` савнаас
          //   давж сүүлийн мөр чимээгүй тасардаг (Watchlist дээр нэг удаа
          //   тохиолдсон алдаа).  Мөр ≤51px байхаар тооцоолсон.
          fontSize: '1.9vw',
          lineHeight: 1,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          color: TV.ink,
        }}
      >
        {Math.round(row.now)}
        <span style={{ fontSize: '0.55em', color: TV.ink3 }}>%</span>
      </span>

      {/* Өөрчлөлт — чиглэлийг ӨНГӨ БОЛОН тэмдэг ХОЁУЛАА хэлнэ, нэгж нь толгойн
          «30 ХОНОГТ» шошгоос гарна. */}
      <span
        style={{
          textAlign: 'right',
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: TV_SIZE.body,
          fontVariantNumeric: 'tabular-nums',
          color: grew ? TV_CHART.good : shrank ? TV_CHART.bad : TV.ink3,
        }}
      >
        {grew
          ? `▲ ${delta.toFixed(1)}`
          : shrank
            ? `▼ ${Math.abs(delta).toFixed(1)}`
            : t('companyTvPage.teamsNoChange')}
      </span>
    </div>
  );
}

function Center({ text }: { text: string }) {
  return (
    <div
      className="flex h-full items-center justify-center"
      style={{ fontSize: TV_SIZE.h2, color: TV.ink3 }}
    >
      {text}
    </div>
  );
}
