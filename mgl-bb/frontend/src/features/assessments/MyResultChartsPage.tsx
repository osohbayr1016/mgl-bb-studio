/**
 * `/app/assessments/results/:roundId` — ажилтны өөрийн үр дүнгийн
 * level-BAND график (scatter + radar).
 *
 * ⚠️ ДҮРЭМ 2026-08-д ӨӨРЧЛӨГДСӨН (эзний шийдвэр): ажилтан ӨӨРИЙН хувийг
 *    хардаг болсон.  Тиймээс доорх хэсгийн жагсаалтад хувь ба «дараагийн
 *    түвшин хүртэл хэдэн хувь дутуу» гарна.
 *
 *    Хэвээр үлдэж буй ЖИНХЭНЭ хил нь «зөвхөн ӨӨРИЙН»:
 *    - `showBenchmark` ХЭЗЭЭ Ч true болгохгүй.  Энэ хуудсан дээрх цорын ганц
 *      нууцлалын хяналт нь ЭНЭ — «Багийн дундаж» цуврал нь бусад ажилтны
 *      оноог шууд бус задруулна (`routes/assessments.ts` → `/my/results` I2).
 *    - Өгөгдөл нь ЗӨВХӨН `fetchMyResults()`-ээс ирнэ.  Админы
 *      `/rounds/:id/results`-ыг энд хэзээ ч холбохгүй.
 *
 *    Графикууд өөрсдөө level-BAND хэвээр (тоон тэнхлэг биш) — энэ нь одоо
 *    нууцлалын хяналт БИШ, зүгээр л зохиомжийн сонголт: тав хуваасан band
 *    тэнхлэг нь «би хаана байна» гэдгийг тоон тэнхлэгээс илүү шууд уншуулна.
 *    Тоог хажуугийн жагсаалтад нарийвчилж өгсөн. Хэрэв хэзээ нэгэн цагт
 *    тоон тэнхлэг рүү шилжвэл дараах хоёрыг санах хэрэгтэй:
 *    - `SkillScatterChart`-д `hideNumbers` true болговол Y тэнхлэгийн level
 *      НЭРС алга болно — ажилтанд хамгийн хэрэгтэй зүйл нь тэр.
 *    - `BehaviorRadarChart`-ын `levelAxis`-ыг унтраавал радиусын тэнхлэг дээр
 *      ХУВЬ гарна — зан чанарын хэсэг хувиар хэмжигддэггүй (I5), тэр нь
 *      буруу нэгж болно.  Тэнд `valueMode="mean"` л зөв.
 *    - Аль ч графикт `seriesCounts` ДАМЖУУЛАХГҮЙ — легенд эмх замбараагүй болно.
 *    - Админы `PartChart`/`PartResultCard`/`SkillDualCharts` зэрэг
 *      scatter+radar-ыг НЭГТГЭСЭН wrapper-ийг ЭНД ашиглахгүй: тэдгээрийн
 *      `showAverage: showSelf && showSenior && showAverage` AND-гейт нь
 *      ажилтны тохиргоонд (`showSelf=false, showSenior=false`) `showAverage`-ыг
 *      чимээгүйхэн false болгож, ямар ч цуваагүй хоосон график үлдээнэ.
 *      Тиймээс `SkillScatterChart`/`BehaviorRadarChart`-ыг ШУУД дуудна.
 */
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Layers, Loader2 } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { PageContainer } from '@/shared/components/PageContainer';
import { EmptyState } from '@/shared/components/EmptyState';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';

import { assessmentKeys, fetchMyResults, type MyResultPart, type MyResultRound } from './api';
import { bandsOf, myPartToChartSections, myPartToChartSectionsMean } from './lib/levelBandChart';
import { fmtMean } from './lib/behaviorScale';
import { LevelBadge } from './components/LevelBadge';
import { LevelUpPlanCard } from './components/LevelUpPlanCard';
import { NextBandHint, NextLevelHint } from './components/NextLevelHint';
import { fmtPct } from './lib/selfResult';
import { SkillScatterChart } from './components/SkillScatterChart';
import { BehaviorRadarChart } from './components/BehaviorRadarChart';

/** Профайлын «Ур чадварын үнэлгээ» таб — бүгд эндээс буцна. */
const PROFILE_TAB = '/app/profile?tab=assessment';

export default function MyResultChartsPage() {
  const { roundId } = useParams<{ roundId: string }>();
  const { t } = useLanguage();
  const id = Number(roundId);
  const valid = Number.isInteger(id) && id > 0;

  const query = useQuery({
    queryKey: assessmentKeys.myResults,
    queryFn: fetchMyResults,
    retry: false,
  });

  const round = useMemo(
    () => (valid ? query.data?.rounds.find((r) => r.round_id === id) : undefined),
    [query.data, id, valid],
  );

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!valid || !round) {
    return (
      <PageContainer width="narrow">
        <EmptyState
          icon={Layers}
          title={t('assessments.myResultNotFound')}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to={PROFILE_TAB}>{t('assessments.backToProfile')}</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  return <ResultCharts round={round} />;
}

// ---------------------------------------------------------------------------

/** Тухайн part-ын «түвшин ахих зам». Хуучин раунд (талбаргүй) бол undefined. */
function levelUpOf(round: MyResultRound, partId: string) {
  return round.level_up?.find((p) => p.part_id === partId);
}

function ResultCharts({ round }: { round: MyResultRound }) {
  const { t } = useLanguage();
  const bands = bandsOf(round.levels);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          to={PROFILE_TAB}
          className="inline-flex items-center gap-1 text-micro text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('assessments.backToProfile')}
        </Link>

        <div className="min-w-0 space-y-1">
          <p className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
            {round.round_period}
          </p>
          <h1 className="text-title text-foreground">{t('assessments.myResultChartsTitle')}</h1>
          <p className="text-sm text-muted-foreground">{round.round_name}</p>
        </div>

        <p className="text-sm text-muted-foreground">{t('assessments.myResultChartsHint')}</p>

        {!round.senior_submitted && (
          <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            {t('assessments.myResultPending')}
          </div>
        )}
      </div>

      {round.parts.map((part) => (
        <div key={part.part_id} className="space-y-4">
          <PartCharts part={part} bands={bands} />
          {/* «Юу хийвэл дараагийн түвшинд хүрэх вэ» — тухайн part-ын ард нь
              шууд.  Хувь харуулаад юу хийхийг хэлэхгүй бол ажилтан
              хөгжлийн алхмаа өөрөө таамаглах болно. */}
          {levelUpOf(round, part.part_id) && (
            <LevelUpPlanCard part={levelUpOf(round, part.part_id)!} />
          )}
        </div>
      ))}
    </div>
  );
}

function PartCharts({ part, bands }: { part: MyResultPart; bands: MyResultRound['levels'] }) {
  const { t } = useLanguage();
  // Ур чадвар (weighted) → pct-суурьт schema.levels (Expert…Intern).
  // Зан чанар (!weighted) → 1.0–5.0 дундаж-суурьт BEHAVIOR_BANDS (Илрэхгүй…
  // Үлгэр жишээ) — өөр систем тул ӨӨР хөрвүүлэлт, ӨӨР `valueMode` хэрэгтэй
  // (админ талын `PartResultCard`-ийн `!part.weighted` дүрэмтэй ижил).
  const sections = part.weighted
    ? myPartToChartSections(part, bands)
    : myPartToChartSectionsMean(part);
  // Level тодорхойлогдоогүй (эсвэл хэсэггүй) part-ыг бүхэлд нь алгасна.
  if (sections.length === 0) return null;

  const common = {
    sections,
    showSelf: false,
    showSenior: false,
    showAverage: true,
    showBenchmark: false,
    levels: bands,
    hideNumbers: false,
  } as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{part.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {part.chart === 'scatter' ? (
          <>
            <SkillScatterChart {...common} chartKey={`my-${part.part_id}-scatter`} />
            <BehaviorRadarChart
              {...common}
              levelAxis
              height={380}
              chartKey={`my-${part.part_id}-radar`}
            />
          </>
        ) : (
          <BehaviorRadarChart
            {...common}
            levelAxis
            valueMode="mean"
            scaleMax={5}
            height={360}
            chartKey={`my-${part.part_id}-radar`}
          />
        )}

        <ul className="divide-y divide-border/60 rounded-lg border border-border">
          {part.sections.map((s) => (
            <li key={s.section_id} className="px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{s.title}</span>
                <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
                  {/* Ур чадвар → хувь, зан чанар → 1.0–5.0 дундаж (I5). */}
                  {part.weighted ? fmtPct(s.pct) : fmtMean(s.mean)}
                </span>
                <LevelBadge
                  size="sm"
                  level={{ code: s.level_code, label: s.level_label, color: s.level_color }}
                />
              </div>
              {part.weighted ? (
                <NextLevelHint
                  pct={s.pct}
                  nextLabel={s.next_level_label}
                  nextMinPct={s.next_level_min_pct}
                  pctToNext={s.pct_to_next}
                />
              ) : (
                <NextBandHint
                  mean={s.mean}
                  nextBandLabel={s.next_level_label}
                  meanToNext={s.mean_to_next}
                />
              )}
            </li>
          ))}
        </ul>
        {part.sections.length === 0 && (
          <p className="text-micro text-muted-foreground">{t('assessments.myLevelsEmptyHint')}</p>
        )}
      </CardContent>
    </Card>
  );
}
