/**
 * Scene «Компанийн эрин» — TV самбарын нээлтийн кадр.
 *
 * ЗОРИЛГО (захирлын шууд хүсэлт): «хэдэн цаг ажилласан, хэдэн төсөл хийсэн»
 * гэдгийг хананд асар томоор.  Энэ хоёр тоо хоёулаа өгөгдлийн санд байсаар
 * атлаа TV самбар дээр огт гардаггүй байсан.
 *
 * ⚠ «ХИЙСЭН ТӨСӨЛ»-ийг `projects.status='completed'`-оор бүү тоол — production
 * дээр тэр статусыг хэн ч тавьдаггүй тул үргэлж 0 гардаг (2026-08-19-нд
 * баталгаажсан).  Backend `/api/company/lifetime` нь жинлэсэн явц 100% хүрсэн
 * төслийг `projects_delivered` гэж тоолдог боловч эзний 2026-09-10-ны
 * шийдвэрээр «Хүлээлгэн өгсөн» нүд нь НИЙТ төслийн тоог (`projects_total`,
 * 89) харуулна — компанийн бүх хугацаанд хийсэн төсөл гэсэн утгаар; лоббид
 * зогсох тоо тэг байж болохгүй.  «Идэвхтэй төсөл» нүд нь одоо явж буй тоог
 * нийтийн хажууд гаргана.  Мөн өдөр «удаагийн ирц» гэсэн хэмжээсийн текст
 * устсан — хэмжээсийн шугам зөвхөн хүний тоог хэлнэ.
 *
 * ЗОХИОМЖ: карт БАЙХГҮЙ.  Ганц том тоо, доор нь техникийн зургийн хэмжээсийн
 * шугам, хамгийн доор нь үсний ширхэг шугамаар тусгаарласан дэмжих тоонууд.
 * Энэ бол сэтгүүлийн нээлтийн зураас — «хайрцаг доторх KPI» биш.
 */
import { useLanguage } from '@/shared/i18n';
import { CountUp } from './CountUp';
import { TV, TV_SIZE, metaStyle, tvNumber } from './theme';

/** `GET /api/company/lifetime`-ийн хариу. */
export interface CompanyLifetime {
  generated_at: string;
  /** Хамгийн эртний ирцийн бүртгэлийн огноо (ISO), дата байхгүй бол null. */
  since: string | null;
  hours_worked: number;
  attendance_sessions: number;
  people_ever: number;
  projects_total: number;
  projects_active: number;
  projects_delivered: number;
  drawings_total: number;
  blocks_total: number;
  tasks_total: number;
  entries_total: number;
  people_active: number;
  teams_total: number;
}

export function EraScene({ data }: { data: CompanyLifetime | null }) {
  const { t } = useLanguage();

  if (!data) {
    return (
      <div
        className="flex h-full items-center justify-center"
        style={{ fontSize: TV_SIZE.h2, color: TV.ink3 }}
      >
        {t('common.loading')}
      </div>
    );
  }

  const sinceYear = data.since ? new Date(data.since).getFullYear() : null;

  // Дэмжих тоонууд.  «Идэвхтэй төсөл» нь нийт тоогоо хажуудаа жижгээр
  // авч явна — толгойн тайлбарыг үз.
  const stats: Array<{ label: string; value: number; sub?: string }> = [
    {
      label: t('companyTvPage.eraProjects'),
      value: data.projects_active,
      sub: t('companyTvPage.pulseOfTotal', { count: tvNumber(data.projects_total) }),
    },
    { label: t('companyTvPage.eraDelivered'), value: data.projects_total },
    { label: t('companyTvPage.eraDrawings'), value: data.drawings_total },
    { label: t('companyTvPage.eraTasks'), value: data.tasks_total },
    { label: t('companyTvPage.eraPeople'), value: data.people_active },
    { label: t('companyTvPage.eraTeams'), value: data.teams_total },
  ];

  return (
    <div className="flex h-full flex-col justify-center">
      {/* ── Хөмсөг: хугацааны хүрээ ──
          ⚠ «MGL ENGINEERING» энд БАЙХГҮЙ: лого нь дээд мөрөнд, хуудасны
          гарчгийн хажууд аль хэдийн байгаа тул давхардуулбал нэг дэлгэцэнд
          брэнд хоёр удаа гарна. */}
      <div className="flex items-center gap-[1vw]">
        <span style={{ flex: 1, height: '1px', background: TV.line }} />
        <span style={{ ...metaStyle, color: TV.ink3 }}>
          {sinceYear
            ? t('companyTvPage.eraSince', { year: sinceYear })
            : t('companyTvPage.eraAllTime')}
        </span>
      </div>

      {/* ── Hero: нийт ажилласан цаг ── */}
      <div className="mt-[3vh] flex items-end gap-[2vw]">
        <CountUp
          value={data.hours_worked}
          format={tvNumber}
          style={{
            fontSize: TV_SIZE.hero,
            fontWeight: 700,
            lineHeight: 0.82,
            letterSpacing: '-0.035em',
            fontVariantNumeric: 'tabular-nums',
            color: TV.ink,
          }}
        />
        <span
          className="pb-[1.6vh]"
          style={{
            fontSize: TV_SIZE.h1,
            fontWeight: 600,
            color: TV.gold,
            letterSpacing: '0.02em',
          }}
        >
          {t('companyTvPage.eraHoursUnit')}
        </span>
      </div>

      {/* ── Хэмжээсийн шугам — техникийн зургийн задлан ── */}
      <DimensionLine
        text={t('companyTvPage.eraDimension', { people: tvNumber(data.people_ever) })}
      />

      {/* ── Дэмжих тоонууд — үсний ширхэг шугамаар тусгаарлагдсан ── */}
      <div className="mt-[5vh] flex items-stretch" style={{ borderTop: `1px solid ${TV.line}` }}>
        {stats.map((s, i) => (
          <div
            key={s.label}
            className="flex flex-1 flex-col gap-[0.8vh] px-[1.6vw] pt-[2.4vh]"
            style={i > 0 ? { borderLeft: `1px solid ${TV.line}` } : undefined}
          >
            <span style={{ ...metaStyle, color: TV.ink3 }}>{s.label}</span>
            <div className="flex items-baseline gap-[0.7vw]">
              <CountUp
                value={s.value}
                format={tvNumber}
                style={{
                  fontSize: TV_SIZE.h1,
                  fontWeight: 600,
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '-0.02em',
                  color: TV.ink,
                }}
              />
              {s.sub && (
                <span className="whitespace-nowrap" style={{ ...metaStyle, color: TV.ink3 }}>
                  {s.sub}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Хэмжээсийн шугам — хоёр талдаа зогсоолын зураастай, голдоо тайлбар бүхий
 * хэвтээ шугам.  Барилгын зураг дээрх «размер» тэмдэглэгээг давтана: энэ бол
 * hero тооны задаргааг харуулах ба нэгэн зэрэг компанийн ажлын хэлийг санагдуулах
 * дүрслэл.
 */
function DimensionLine({ text }: { text: string }) {
  const tick = <span style={{ width: '1px', height: '1.4vh', background: TV.lineStrong }} />;
  return (
    <div className="mt-[2.6vh] flex items-center gap-[0.9vw]">
      {tick}
      <span style={{ flex: 1, height: '1px', background: TV.line }} />
      <span style={{ ...metaStyle, color: TV.ink2, whiteSpace: 'nowrap' }}>{text}</span>
      <span style={{ flex: 1, height: '1px', background: TV.line }} />
      {tick}
    </div>
  );
}
