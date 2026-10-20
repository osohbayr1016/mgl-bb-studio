import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';

import type { ParticipantResult } from '../api';
import type { AssessmentLevelBand, AssessmentSchema } from '../types';
import { averageParts, seriesMemberCounts, sidesPresent, type Cohort } from '../lib/aggregate';
import { behaviorPartFromResult, findBehaviorPart } from '../lib/behaviorPart';
import { chartKeyFor } from '../lib/chartImage';
import { BehaviorParticipantsTable } from './BehaviorParticipantsTable';
import { BehaviorPersonDialog } from './BehaviorPersonDialog';
import { PartResultCard } from './PartResultCard';

interface Props {
  round: { name: string; period: string };
  schema: AssessmentSchema;
  cohortFiltered: ParticipantResult[];
  cohort: Cohort;
  teamLabel: string;
  levels: AssessmentLevelBand[];
  detailNumbers: boolean;
  onOpenPerson: (userId: number) => void;
}

export function BehaviorResultsSection({
  round,
  schema,
  cohortFiltered,
  cohort,
  teamLabel,
  levels,
  detailNumbers,
  onOpenPerson,
}: Props) {
  const { t } = useLanguage();
  const [dialogUserId, setDialogUserId] = useState<number | null>(null);

  const teamBehavior = useMemo(
    () => findBehaviorPart(averageParts(cohort.members, levels)),
    [cohort.members, levels],
  );

  const dialogPerson = useMemo(
    () => cohortFiltered.find((r) => r.user_id === dialogUserId) ?? null,
    [cohortFiltered, dialogUserId],
  );

  const sides = useMemo(() => sidesPresent(teamBehavior ? [teamBehavior] : []), [teamBehavior]);
  const showAverage = sides.self && sides.senior;

  if (!teamBehavior && !cohortFiltered.some((r) => behaviorPartFromResult(r))) {
    return null;
  }

  const scopeLabel = t('assessments.behaviorScopeTeam', {
    team: teamLabel,
    count: cohort.members.length,
  });

  return (
    <section className="space-y-4 border-t border-border pt-8">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-section">{t('assessments.behaviorSectionTitle')}</h3>
        <span className="text-micro text-muted-foreground">{scopeLabel}</span>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" aria-hidden />
            {t('assessments.behaviorParticipantsTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          <BehaviorParticipantsTable
            rows={cohortFiltered}
            onSelect={(userId) => setDialogUserId(userId)}
          />
        </CardContent>
      </Card>

      {teamBehavior && (
        <PartResultCard
          part={teamBehavior}
          levels={levels}
          showSelf={sides.self}
          showSenior={sides.senior}
          showAverage={showAverage}
          seriesCounts={seriesMemberCounts(cohort.members)}
          chartKey={chartKeyFor('round', teamBehavior.part_id)}
          chartScope="round"
          detailNumbers={detailNumbers}
        />
      )}

      <BehaviorPersonDialog
        open={dialogUserId != null}
        onOpenChange={(open) => !open && setDialogUserId(null)}
        person={dialogPerson}
        cohortFiltered={cohortFiltered}
        levels={levels}
        round={round}
        schema={schema}
        detailNumbers={detailNumbers}
        onOpenFullPage={onOpenPerson}
      />
    </section>
  );
}

export default BehaviorResultsSection;
