/**
 * Scene «Төслийн явц» — идэвхтэй төсөл тус бүр хаана хүрсэн бэ.
 *
 * 2026-08-25-нд `CompanyTvPage.tsx`-ээс энэ файл руу зөөж, `tv/`-ийн Blueprint
 * системд оруулав.  Өмнө нь ганцаараа өөр төрхтэй байсан: тайлбарын мөр ч,
 * хүснэгтийн толгой ч байхгүй, дугуй ирмэгтэй бүдүүн тууз, бүх мөр өөр өнгөтэй.
 *
 * ⇒ Одоо `SectorsScene`-тэй ЯГ ИЖИЛ бүтэцтэй: тайлбарын мөр → шошготой
 *   хүснэгтийн толгой → мөрүүд.  Хоёр кадар ээлжлэн солигдох үед зохиомж
 *   «үсэрдэггүй».  Аль нэгийг нь өөрчилвөл нөгөөг нь мөн адил өөрчил.
 *   (Нэг өгүүлбэрийн тодорхойлолт, «ХЭМЖИГДЭХҮҮН» шошго болон доод тайлбарын
 *   мөр 2026-09-10-нд эзний шийдвэрээр устсан — буцааж нэмэхгүй; тайлбарын
 *   мөрөнд «НЭГДСЭН ЯВЦ» гэсэн хэмжигдэхүүний нэр шошгогүйгээр үлдэнэ.)
 *
 * ХОЁР ДҮРЭМ (`SectorsScene`-ийн толгойд дэлгэрэнгүй):
 *   · Багана НЭГ өнгөтэй.  Явцын шат (улаан→шар→ногоон) нь уртаараа аль хэдийн
 *     хэлсэн зүйлийг өнгөөр давхарладаг — статусын өнгө нь ЭЦСИЙН ХУГАЦААНЫ
 *     баганад л утгатай, тэнд байна.
 *   · Тэнхлэг ҮРГЭЛЖ 0-100%, хамгийн урт мөрөөр нормчлохгүй.
 *
 * ⚠ `portfolio` нь `/overview`-оос ИДЭВХТЭЙГЭЭР ШҮҮГДЭЭГҮЙ ирдэг (SQL-д WHERE
 *   байхгүй, зөвхөн `ORDER BY (status='active') DESC`) тул шүүлт энд ЗААВАЛ
 *   хийгдэнэ — эс тэгвэл архивласан 100%-тай төсөл жагсаалтын толгойд суудаг.
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '@/shared/i18n';
import { TV, TV_CHART, TV_SIZE, metaStyle } from './theme';
import { SceneMeta } from './SceneMeta';
import { useRowCapacity } from './useRowCapacity';

export interface PortfolioProject {
  id: number;
  name: string;
  status: string | null;
  progress: number;
  finish_date: string | null;
  days_left: number | null;
}

/** 25%-ийн тор — `SectorsScene`-тэй ижил байрлалд. */
const TICKS = [25, 50, 75] as const;

/** Багануудын өргөн — толгой ба мөр ХОЁУЛАА үүнийг ашиглана. */
const GRID = '2.6vw 30% 11vw 1fr 5.4vw';

/** Хэдэн мөр багтаах вэ.  1080p дээр удирдлагын мөр гарсан үед ч (pb 11.5vh)
 *  сүүлийн мөр таслагдахгүй байх тоо. */
const MAX_ROWS = 7;

function useEnter(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}

export function PortfolioScene({ projects }: { projects: PortfolioProject[] }) {
  const { t } = useLanguage();
  const on = useEnter();
  const { ref: listRef, capacity } = useRowCapacity(MAX_ROWS);

  const active = projects.filter((p) => p.status === 'active');
  const rows = [...active].sort((a, b) => b.progress - a.progress).slice(0, capacity);

  if (rows.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center"
        style={{ fontSize: TV_SIZE.h2, color: TV.ink3 }}
      >
        {t('companyTvPage.noProjectsRegistered')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <SceneMeta
        items={[
          { label: t('companyTvPage.metaProjects'), value: String(active.length) },
          { value: t('companyTvPage.portfolioMeasure') },
        ]}
      />

      {/* ── Хүснэгтийн толгой ── */}
      <div
        className="mt-[2.2vh] grid shrink-0 items-baseline gap-x-[1vw] pb-[1vh]"
        style={{ gridTemplateColumns: GRID, borderBottom: `1px solid ${TV.lineStrong}` }}
      >
        <span style={{ ...metaStyle, color: TV.ink3, textAlign: 'right' }}>#</span>
        <span style={{ ...metaStyle, color: TV.ink3 }}>{t('companyTvPage.colProject')}</span>
        <span style={{ ...metaStyle, color: TV.ink3 }}>{t('companyTvPage.colDeadline')}</span>
        <span style={{ ...metaStyle, color: TV.ink3 }}>{t('companyTvPage.teamsColBar')}</span>
        <span style={{ ...metaStyle, color: TV.ink3, textAlign: 'right' }}>
          {t('companyTvPage.colProgress')}
        </span>
      </div>

      {/* ⚠ `overflow-hidden` ЗААВАЛ: хэмжилт хийгдэх эхний кадарт бүх мөр
             зурагдана.  Үүнгүйгээр `justify-center` нь илүүдлийг ДЭЭШ бас
             ДООШ халиулж, хүснэгтийн толгой дээр давхарлана — 2026-08-25-нд
             яг ийм эвдрэл гарсан.  Багтаагүй төсөл байгааг одоо дээрх
             «ТӨСӨЛ N» тоо л хэлнэ. */}
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden">
        {rows.map((p, i) => (
          <ProjectRowView key={p.id} project={p} rank={i + 1} index={i} on={on} />
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────  нэг төслийн мөр  ────────────────────────── */

function ProjectRowView({
  project,
  rank,
  index,
  on,
}: {
  project: PortfolioProject;
  rank: number;
  index: number;
  on: boolean;
}) {
  const pct = Math.max(0, Math.min(100, project.progress));

  return (
    <div
      data-tv-row
      className="grid items-center gap-x-[1vw] py-[0.9vh]"
      style={{ gridTemplateColumns: GRID, borderBottom: `1px solid ${TV.line}` }}
    >
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

      <span
        className="truncate"
        style={{ fontSize: TV_SIZE.h3, lineHeight: 1.1, fontWeight: 600, color: TV.ink }}
      >
        {project.name}
      </span>

      <DeadlineCell daysLeft={project.days_left} finish={project.finish_date} />

      {/* Тэнхлэг ҮРГЭЛЖ 0-100%, НЭГ өнгө — `SectorsScene`-тэй ижил. */}
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
            width: on ? `${pct}%` : '0%',
            background: `linear-gradient(to right, rgba(62,143,224,0.55), ${TV_CHART.primary})`,
            borderRadius: '2px',
            transition: `width 820ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 70}ms`,
          }}
        />
      </div>

      <span
        style={{
          textAlign: 'right',
          fontSize: '1.9vw',
          lineHeight: 1,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          color: TV.ink,
        }}
      >
        {Math.round(project.progress)}
        <span style={{ fontSize: '0.55em', color: TV.ink3 }}>%</span>
      </span>
    </div>
  );
}

/**
 * Эцсийн хугацааны нүд.
 *
 * Статусын өнгө ЗӨВХӨН энд байна — хугацаа хэтэрсэн эсэх нь жинхэнэ төлөв тул
 * улаан/шар нь утга агуулна.  (Явцын багана нь эсрэгээрээ нэг өнгөтэй: урт нь
 * аль хэдийн хэмжээг хэлж байгаа.)
 *
 * ⚠ `CompanyTvPage.tsx`-ийн `DeadlineLabel` нь ӨӨР — тэр нь Watchlist кадрын
 *   дүрстэй, товч хувилбар.  Хоёуланг нь нэгтгэх гэж оролдвол хоёр кадрын
 *   зохиомж хоёулаа муудна; логик нь ижил тул хамт өөрчил.
 */
function DeadlineCell({ daysLeft, finish }: { daysLeft: number | null; finish: string | null }) {
  const { t } = useLanguage();

  // ⚠ БҮХ САЛБАР `whitespace-nowrap` байх ЁСТОЙ.  «эцсийн хугацаа тогтоогүй»
  //   гэсэн бүтэн өгүүлбэр энэ баганад хоёр мөр болж таслагдаж, мөрийн өндрийг
  //   ~40%-иар өсгөснөөс болж жагсаалт багтахаа больж байсан.  Багана нь юу
  //   болох нь толгойд («ЭЦСИЙН ХУГАЦАА») аль хэдийн бичигдсэн тул энд зөвхөн
  //   төлөв нь хэрэгтэй.
  if (!finish) {
    return (
      <span
        className="truncate whitespace-nowrap italic"
        style={{ fontSize: TV_SIZE.body, color: TV.ink3 }}
      >
        {t('companyTvPage.portfolioNoDeadline')}
      </span>
    );
  }
  if (daysLeft == null) {
    return (
      <span
        className="truncate whitespace-nowrap"
        style={{ fontSize: TV_SIZE.body, color: TV.ink2 }}
      >
        {finish.length >= 10 ? `${finish.slice(5, 7)}/${finish.slice(8, 10)}` : finish}
      </span>
    );
  }

  const color = daysLeft < 0 ? TV_CHART.bad : daysLeft < 14 ? TV.warn : TV.ink2;
  const text =
    daysLeft < 0
      ? t('companyTvPage.daysOverdue', { count: Math.abs(daysLeft) })
      : daysLeft === 0
        ? t('companyTvPage.deadlineToday')
        : t('companyTvPage.daysLeft', { count: daysLeft });

  return (
    <span
      className="truncate whitespace-nowrap"
      style={{ fontSize: TV_SIZE.body, color, fontWeight: daysLeft < 14 ? 600 : 400 }}
    >
      {text}
    </span>
  );
}
