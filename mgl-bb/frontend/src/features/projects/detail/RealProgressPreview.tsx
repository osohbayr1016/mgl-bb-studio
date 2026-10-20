/** Цагаар бодогддог засварын төслийн (`progress_mode = 'hours'`) толгойн явцын
 *  самбар — `TeamProgressPreview`-ийн оронд.  Эзний шийдвэр (2026-09-28):
 *  FURNITURE LAND-аас бусад засварын төсөлд ЗӨВХӨН бодит явц харагдана —
 *  «ажилчдын дундаж хувь × ажилласан цаг» (backend `hoursProgressSql`).
 *  Багуудын мөр (таскийн хуучин хувиар бодсон) энд ОРОХГҮЙ: цагаар бодогддог
 *  таск дээр хувь оруулдаггүй тул тэр тоо бодит явцтай зөрж, андуурагддаг байв. */
import { Clock, Users2 } from 'lucide-react';

import type { RepairHoursSummary } from '@/shared/types';
import { Badge } from '@/ui/badge';
import { Progress } from '@/ui/progress';
import { useLanguage } from '@/shared/i18n';

export function RealProgressPreview({
  projectProgress,
  hours,
  hoursLoading,
}: {
  /** Сервер бодсон төслийн явц (`GET /projects/:id` → hours горимд цагаас). */
  projectProgress: number;
  hours: RepairHoursSummary | undefined;
  hoursLoading: boolean;
}) {
  const { t } = useLanguage();
  // Засварын явц өдөрт ~0.1%-иар өсдөг тул бүхэл тоонд дугуйлбал хөдлөхгүй мэт
  // харагдана — нэг орон аравтын бутархай.
  const headline = Math.round(Math.max(0, projectProgress) * 10) / 10;
  const totalHours = hours?.total_hours ?? 0;
  const peopleCount = hours?.people.length ?? 0;

  return (
    <div
      className="h-full min-h-[112px] rounded-lg border border-border/60 bg-card/70 backdrop-blur px-3 py-2 overflow-hidden"
      data-testid="real-progress-preview"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-label uppercase text-muted-foreground">
            {t('projectDetailPage.realProgress')}
          </div>
          <div className="mt-0.5 text-lg font-semibold leading-none tabular-nums">{headline}%</div>
          <div className="mt-0.5 text-label font-normal tracking-normal text-muted-foreground">
            {t('projectDetailPage.realProgressHint')}
          </div>
        </div>
        <Badge variant="outline" className="h-5 px-1.5 text-label font-normal tracking-normal">
          {t('projectDetailPage.realProgressBadge')}
        </Badge>
      </div>
      <Progress value={Math.min(100, headline)} className="mt-2 h-1.5" />
      <div className="mt-2 flex items-center gap-3 text-label font-normal tracking-normal text-muted-foreground tabular-nums">
        {hoursLoading ? (
          <span className="h-3 w-24 animate-pulse rounded bg-muted/50" />
        ) : totalHours > 0 ? (
          <>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3 text-primary" />
              <span className="font-semibold text-foreground">
                {t('repair.hoursValue', { hours: totalHours })}
              </span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Users2 className="h-3 w-3" />
              {t('repair.hoursPeopleCount', { count: peopleCount })}
            </span>
          </>
        ) : (
          <span>{t('projectDetailPage.realProgressNoHours')}</span>
        )}
      </div>
    </div>
  );
}

export default RealProgressPreview;
