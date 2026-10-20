/**
 * Профайлын «Ур чадварын тодорхойлолт» табын агуулга.
 *
 * Гурван блок:
 *   1. Бөглөх шаардлагатай  — надад оногдсон маягтууд
 *   2. Миний үнэлэх хүмүүс  — багийн ахлагчийн жагсаалт (ХООСОН бол огт гарахгүй)
 *   3. Миний ур чадвар      — шатлалын тайлбар + чадвар тус бүрийн түвшин/хувь
 *
 * ⚠️ 3-Р БЛОК 2026-08-12-Д ДАХИН ӨӨРЧЛӨГДСӨН (эзний шийдвэр).  НИЙТ хувь,
 *    НИЙТ түвшин, «шатлалын 3/5», «дараагийн түвшинд X% дутуу», ахиц
 *    дэвшлийн зөрүү, «Ахлахтайгаа ярилцах» / «Гарын авлага» товч БҮГД
 *    ХАСАГДСАН.  Тэдгээрийг агуулж байсан `components/LevelProgressCard.tsx`
 *    бүхэлдээ устгагдсан (профайлын «Түвшин» таб мөн хамт — энэ таб түүнийг
 *    залгамжилсан).  Оронд нь:
 *      • `LevelScaleInfo` — түвшин ЮУГААР тодорхойлогддог вэ (статик тайлбар
 *        + схемийн хувийн босго).  Ажилтны ямар ч тоо агуулаагүй;
 *      • `SkillLevelList` — ур чадвар тус бүрийн түвшин + хувь, «дараагийн
 *        түвшинд хамгийн ойр»-оор АВТОМАТААР эрэмбэлэгдсэн.
 *    Нийт хувь/түвшнийг буцааж нэмэхгүй: нэг дундаж тоо нь юуг засахаа
 *    хэлдэггүй тул зориудаар хаясан.
 *
 * ⚠️ ХИЛ НЬ ХЭВЭЭР — **зөвхөн өөрийн**:
 *      • Энэ блок нь `/assessments/my/results`-ээс л уншина.  Тэр гарц нь
 *        `subject_user_id = user.sub`-т хатуу bind хийгдсэн.
 *      • Бусад ажилтны хувь/оноо, эрэмбэ (rank/percentile), багийн дундаж
 *        (`benchmark` цуврал) энд ХЭЗЭЭ Ч ГАРАХГҮЙ.
 *      • Зан чанарын (weighted:false) хэсэгт ХУВЬ гаргахгүй — тэнд үнэлгээ нь
 *        1.0–5.0 дундаж (`BEHAVIOR_BANDS`), өөр системийн хэмжигдэхүүн.
 *        (`round.sections` нь серверийн зүгээс аль хэдийн зөвхөн жинтэй
 *        хэсгүүдийг агуулдаг тул доорх жагсаалтад тэд орохгүй.)
 *    Бүрэн жагсаалт: `backend/src/routes/assessments.ts` → `/my/results`
 *    (I1–I5), docs/dev/assessments-spec.md §3.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  LineChart,
  Layers,
  Loader2,
  PenLine,
  Users,
} from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { EmptyState } from '@/shared/components/EmptyState';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { Progress } from '@/ui/progress';

import {
  assessmentKeys,
  fetchMyAssignments,
  fetchMyResults,
  fetchMyReviews,
  type MyResultRound,
} from './api';
import type { AssessmentAssignment } from './types';
import { LevelScaleInfo } from './components/LevelScaleInfo';
import { SkillLevelList } from './components/SkillLevelList';
import { DEFAULT_LEVELS } from './lib/score';

/** Бөглөөгүйг нь дээр нь — хамгийн шинэ round эхэнд. */
function sortAssignments(list: AssessmentAssignment[]): AssessmentAssignment[] {
  return [...list].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'draft' ? -1 : 1;
    return b.round_id - a.round_id;
  });
}

export default function MyAssessmentsSection() {
  const { t } = useLanguage();

  const myQuery = useQuery({
    queryKey: assessmentKeys.my,
    queryFn: fetchMyAssignments,
    retry: false,
  });
  const reviewsQuery = useQuery({
    queryKey: assessmentKeys.myReviews,
    queryFn: fetchMyReviews,
    retry: false,
  });
  const resultsQuery = useQuery({
    queryKey: assessmentKeys.myResults,
    queryFn: fetchMyResults,
    retry: false,
  });

  const assignments = useMemo(
    () => sortAssignments(myQuery.data?.assignments ?? []),
    [myQuery.data],
  );
  // Senior биш хүнд сервер хоосон буцаана — блок бүхэлдээ алга болно.
  const reviews = useMemo(
    () => sortAssignments(reviewsQuery.data?.assignments ?? []),
    [reviewsQuery.data],
  );
  const resultRounds = resultsQuery.data?.rounds ?? [];
  // Шатлалын тайлбар нь үр дүн ирээгүй байсан ч харагдана — раунд байхгүй
  // (эсвэл схемдээ level тодорхойлоогүй) үед клиентийн анхдагч band-ууд.
  // ⚠️ `DEFAULT_LEVELS` нь серверийн `assessmentScore.ts`-ийн ижил хуулбар.
  const scaleBands = resultRounds.find((r) => r.levels?.length)?.levels ?? DEFAULT_LEVELS;

  if (myQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---------------- 1. Бөглөх шаардлагатай ---------------- */}
      <Card className="border-border bg-card/60 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ClipboardList className="h-5 w-5 text-primary" />
            {t('assessments.toFill')}
          </CardTitle>
          <CardDescription>{t('assessments.toFillHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <EmptyState
              compact
              icon={ClipboardList}
              title={t('assessments.toFillEmpty')}
              description={t('assessments.toFillEmptyHint')}
            />
          ) : (
            <ul className="space-y-2">
              {assignments.map((a) => (
                <AssignmentRow key={a.response_id} assignment={a} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ---------------- 2. Миний үнэлэх хүмүүс (зөвхөн senior) ---------------- */}
      {reviews.length > 0 && (
        <Card className="border-border bg-card/60 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5 text-primary" />
              {t('assessments.myReviews')}
            </CardTitle>
            <CardDescription>{t('assessments.myReviewsHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {reviews.map((a) => (
                <AssignmentRow key={a.response_id} assignment={a} showSubject />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ---------------- 3. Миний ур чадвар ---------------- */}
      <Card className="border-border bg-card/60 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Layers className="h-5 w-5 text-primary" />
            {t('assessments.mySkills')}
          </CardTitle>
          <CardDescription>{t('assessments.mySkillsHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Шатлалын тайлбар — үр дүнгээс ХАМААРАЛГҮЙ, үргэлж харагдана. */}
          <LevelScaleInfo bands={scaleBands} />

          {resultsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : resultsQuery.isError ? (
            // ⚠️ Хүсэлт БҮТЭЭГҮЙ (500 / офлайн) төлөвийг «үр дүн алга» гэж
            //    харуулж БОЛОХГҮЙ — `retry: false` тул алдаа мөнхөрч, түвшин
            //    бүхий ажилтанд «үнэлгээ хэзээ ч дүгнэгдээгүй» гэж хэлнэ.
            //    Алдаа = дахин оролдох товч.
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{t('common.error')}</span>
              </span>
              <Button size="sm" variant="outline" onClick={() => void resultsQuery.refetch()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : resultRounds.length === 0 ? (
            <EmptyState
              compact
              icon={Layers}
              title={t('assessments.myLevelsEmpty')}
              description={t('assessments.myLevelsEmptyHint')}
            />
          ) : (
            <div className="space-y-5">
              {resultRounds.map((round) => (
                <ResultRound key={round.round_id} round={round} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Нэг маягтын мөр — нэр, явц, «Бөглөх» товч. */
function AssignmentRow({
  assignment: a,
  showSubject,
}: {
  assignment: AssessmentAssignment;
  showSubject?: boolean;
}) {
  const { t } = useLanguage();
  const done = a.status === 'submitted';
  const closed = a.round_status !== 'open';
  const pct = a.total_count > 0 ? (a.answered_count / a.total_count) * 100 : 0;

  return (
    <li className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {showSubject && (
            <p className="truncate text-sm font-semibold text-foreground">{a.subject_name}</p>
          )}
          <p
            className={
              showSubject
                ? 'truncate text-micro text-muted-foreground'
                : 'truncate text-sm font-semibold text-foreground'
            }
          >
            {a.round_name}
          </p>
          <p className="mt-0.5 truncate text-micro text-muted-foreground">
            {a.round_period}
            {a.template_title ? ` · ${a.template_title}` : ''}
          </p>
        </div>

        {/* ⚠️ Энд ӨӨРИЙН НИЙТ түвшний badge байсан — 2026-08-12-нд хасагдсан
            (нийт түвшин гэсэн ойлголт ажилтны дэлгэцээс бүхэлдээ гарсан). */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {done ? (
            <Badge variant="secondary" className="gap-1 bg-success/15 text-success">
              <CheckCircle2 className="h-3 w-3" />
              {t('assessments.submitted')}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {closed ? t('assessments.roundClosed') : t('assessments.draft')}
            </Badge>
          )}
          <Button asChild size="sm" variant={done || closed ? 'outline' : 'default'}>
            <Link to={`/app/assessments/${a.response_id}`}>
              <PenLine className="mr-1 h-3.5 w-3.5" />
              {done || closed ? t('assessments.view') : t('assessments.fill')}
            </Link>
          </Button>
        </div>
      </div>

      {/* Явц — бөглөсөн МӨРИЙН тоо (оноо БИШ). */}
      {!done && a.total_count > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <Progress value={pct} className="h-1.5 flex-1" />
          <span className="shrink-0 text-micro tabular-nums text-muted-foreground">
            {t('assessments.answeredOf', { answered: a.answered_count, total: a.total_count })}
          </span>
        </div>
      )}
    </li>
  );
}

/** Нэг round — чадвар тус бүрийн түвшин/хувь (нийт түвшин БАЙХГҮЙ). */
function ResultRound({ round }: { round: MyResultRound }) {
  const { t } = useLanguage();
  const hasCharts = (round.parts?.length ?? 0) > 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h4 className="text-sm font-semibold text-foreground">{round.round_name}</h4>
          <span className="text-micro text-muted-foreground">{round.round_period}</span>
        </div>
        {hasCharts && (
          <Button asChild size="sm" variant="outline">
            <Link to={`/app/assessments/results/${round.round_id}`}>
              <LineChart className="mr-1 h-3.5 w-3.5" />
              {t('assessments.viewResultCharts')}
            </Link>
          </Button>
        )}
      </div>

      {/* ⚠️ Ахлагч илгээгээгүй байхад серверийн `pct` нь ажилтны ӨӨРИЙН
          хариултын хувь (`average = self`) — «дүгнэгдсэн үр дүн» БИШ.  Үүнийг
          тэмдэглэхгүй бол ажилтан түр зуурын тоог эцсийн түвшин гэж ойлгоно
          (MyResultChartsPage-ийн ижил сэрэмжлүүлэгтэй нэг мөр). */}
      {!round.senior_submitted && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t('assessments.myResultPending')}</span>
        </div>
      )}

      {round.sections.length === 0 ? (
        <p className="text-micro text-muted-foreground">{t('assessments.myLevelsEmptyHint')}</p>
      ) : (
        <SkillLevelList sections={round.sections} bands={round.levels} />
      )}
    </div>
  );
}
