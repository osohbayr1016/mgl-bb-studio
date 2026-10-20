import { Info, UserRoundX, Users } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';

import type { ParticipantResult } from '../api';
import type { Cohort, CohortMode } from '../lib/aggregate';
import { headlinePart } from '../lib/aggregate';
import { fmtPct } from '../lib/exportAssessmentXlsx';
import { LevelTag } from '../components/LevelTag';

export interface CohortPanelProps {
  /** `buildCohort`-ийн үр дүн — гишүүд, хасагдсан, бөглөөгүй хүмүүс. */
  cohort: Cohort;
  /** «Хоёулаа бөглөсөн» горимд орох боломжтой хүний тоо. */
  bothCount: number;
  /** «Өөрийн үнэлгээ бүгд» горимд орох боломжтой хүний тоо. */
  selfCount: number;
  onModeChange: (mode: CohortMode) => void;
  /** Нэр дээр дарахад — хувийн харагдац нээнэ. */
  onSelectUser: (result: ParticipantResult) => void;
  className?: string;
}

/** Хүний «нүүр» болох part — жинтэй нь, эс бөгөөс эхнийх. */
function memberHeadline(result: ParticipantResult) {
  return headlinePart(result);
}

/** Дундажид ОРСОН хүний чип — нэр + нийт хувь + түвшин. */
function MemberChip({
  result,
  onSelect,
}: {
  result: ParticipantResult;
  onSelect: (result: ParticipantResult) => void;
}) {
  const { t } = useLanguage();
  const part = memberHeadline(result);

  return (
    <button
      type="button"
      title={t('assessments.cohortOpenPerson')}
      onClick={() => onSelect(result)}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-border bg-background px-2.5 py-1',
        'text-xs whitespace-nowrap outline-none transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
      )}
    >
      <span className="font-medium">{formatDisplayName(result.full_name)}</span>
      {part?.weighted && (
        <span className="tabular-nums text-muted-foreground">{fmtPct(part.overall_pct)}</span>
      )}
      {part?.overall_level && (
        <span className="text-muted-foreground">
          <LevelTag level={part.overall_level} />
        </span>
      )}
    </button>
  );
}

/** Хасагдсан / бөглөөгүй хүний нэр — бүдэг, гэхдээ мөн адил дарагдана. */
function QuietName({
  result,
  onSelect,
}: {
  result: ParticipantResult;
  onSelect: (result: ParticipantResult) => void;
}) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      title={t('assessments.cohortOpenPerson')}
      onClick={() => onSelect(result)}
      className={cn(
        'rounded underline decoration-dotted underline-offset-2 outline-none transition-colors',
        'hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
      )}
    >
      {formatDisplayName(result.full_name)}
    </button>
  );
}

/** Нэрсийн жагсаалт — таслалаар тусгаарлагдсан дарагддаг нэрс. */
function QuietNameList({
  results,
  onSelect,
}: {
  results: ParticipantResult[];
  onSelect: (result: ParticipantResult) => void;
}) {
  return (
    <>
      {results.map((result, i) => (
        <span key={result.user_id}>
          {i > 0 && <span aria-hidden>, </span>}
          <QuietName result={result} onSelect={onSelect} />
        </span>
      ))}
    </>
  );
}

export function CohortPanel({
  cohort,
  bothCount,
  selfCount,
  onModeChange,
  onSelectUser,
  className,
}: CohortPanelProps) {
  const { t } = useLanguage();

  const memberCount = cohort.members.length;
  /** Дундажид ОРСОН хүмүүсээс ахлагч нь үнэлж амжсан нь хэд вэ. */
  const seniorCount = cohort.members.filter((m) => m.senior_submitted).length;
  const noSenior = cohort.excluded.filter((e) => e.reason === 'no-senior');
  const noSelf = cohort.excluded.filter((e) => e.reason === 'no-self');

  return (
    <Card className={className}>
      <CardContent className="space-y-3 py-4">
        {/* Гарчиг + горим сонгогч */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <h4 className="text-body font-semibold">
            {t('assessments.cohortTitle', { count: memberCount })}
          </h4>
          <div
            className="ml-auto flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label={t('assessments.cohortModeLabel')}
          >
            <Button
              size="xs"
              variant={cohort.mode === 'both' ? 'default' : 'outline'}
              disabled={!cohort.bothAvailable}
              aria-pressed={cohort.mode === 'both'}
              onClick={() => onModeChange('both')}
            >
              {t('assessments.cohortModeBoth', { count: bothCount })}
            </Button>
            <Button
              size="xs"
              variant={cohort.mode === 'self' ? 'default' : 'outline'}
              aria-pressed={cohort.mode === 'self'}
              onClick={() => onModeChange('self')}
            >
              {t('assessments.cohortModeSelf', { count: selfCount })}
            </Button>
          </div>
        </div>

        {/* Дундажид орсон хүмүүс */}
        {memberCount ? (
          <div className="flex flex-wrap gap-1.5">
            {cohort.members.map((result) => (
              <MemberChip key={result.user_id} result={result} onSelect={onSelectUser} />
            ))}
          </div>
        ) : (
          <p className="text-micro text-muted-foreground">
            {t('assessments.cohortEmpty')} {t('assessments.cohortEmptyHint')}
          </p>
        )}

        {/* Тайлбар — яагаад тоонуудад итгэж болох вэ */}
        {memberCount > 0 && (
          <p className="flex items-start gap-1.5 text-micro text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {cohort.mode === 'both'
                ? t('assessments.cohortSameNote', { count: memberCount })
                : seniorCount > 0
                  ? // Ахлагчийн үнэлгээ ХЭСЭГЧИЛСЭН — нэрлэгч ялгаатай гэдгийг
                    // ил хэлнэ, эс бөгөөс «дундаж яагаад хоёрын хооронд биш
                    // байна вэ» гэсэн эргэлзээ төрнө.
                    t('assessments.cohortMixedNote', {
                      count: memberCount,
                      senior: seniorCount,
                    })
                  : t('assessments.cohortSelfOnlyNote')}
            </span>
          </p>
        )}

        {/* Хасагдсан хүмүүс — шалтгаантайгаа */}
        {(noSenior.length > 0 || noSelf.length > 0 || cohort.pending.length > 0) && (
          <div className="space-y-1 border-t border-border pt-3 text-micro text-muted-foreground">
            {noSenior.length > 0 && (
              <p className="flex items-start gap-1.5">
                <UserRoundX className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  {t('assessments.cohortExcludedNoSenior')}{' '}
                  <QuietNameList
                    results={noSenior.map((e) => e.result)}
                    onSelect={onSelectUser}
                  />
                </span>
              </p>
            )}
            {noSelf.length > 0 && (
              <p className="flex items-start gap-1.5">
                <UserRoundX className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  {t('assessments.cohortExcludedNoSelf')}{' '}
                  <QuietNameList results={noSelf.map((e) => e.result)} onSelect={onSelectUser} />
                </span>
              </p>
            )}
            {cohort.pending.length > 0 && (
              <p>{t('assessments.cohortPending', { count: cohort.pending.length })}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default CohortPanel;
