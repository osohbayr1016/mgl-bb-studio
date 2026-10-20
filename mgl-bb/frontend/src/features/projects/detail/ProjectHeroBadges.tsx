/** Status / headcount / block / task / complexity badges plus the client
 *  chips under the project title. Extracted verbatim from
 *  `ProjectDetailPage.tsx` when that file was split into per-component
 *  modules — no behavioural change. */
import { Building2, Layers3, Target, User as UserIcon, Users } from 'lucide-react';

import type { ProjectDetailResponse } from '@/shared/types';
import { Badge } from '@/ui/badge';
import {
  DEFAULT_COMPLEXITY_PCT,
  clampComplexityPct,
  complexityPctColor,
} from '@/shared/lib/complexity';
import { useLanguage } from '@/shared/i18n';
import { DeadlineChip } from '@/features/deadlines/DeadlineChip';

export function ProjectHeroBadges({
  project,
  clients,
  isAdmin,
  memberCount,
  blockCount,
  taskCount,
}: {
  project: ProjectDetailResponse['project'];
  clients: NonNullable<ProjectDetailResponse['clients']>;
  isAdmin: boolean;
  memberCount: number;
  blockCount: number;
  taskCount: number;
}) {
  const { t } = useLanguage();
  const complexity = clampComplexityPct(project.complexity_pct ?? DEFAULT_COMPLEXITY_PCT);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <Badge variant="outline" className="capitalize border-primary/30 bg-primary/10 text-primary">
          {project.status}
        </Badge>
        {/* Дуусах хугацаа — статусын ЯГ хажууд, эрсдэлийн өнгөтэй
            (шаардлага #1: хугацаа төсөл дотор ШУУД харагдана).
            Паспортын огноо хоосон эсвэл хог утга ('-') бол chip өөрөө
            нуугдана.  `GET /api/projects/:id` нь паспортын огноог
            буцаадаггүй тул chip нь «Хугацаа» табтай ИЖИЛ query-ээс
            уншина — кэш хуваалцагдаж, хоёр дуудлага явахгүй. */}
        <DeadlineChip projectId={project.id} />
        <Badge variant="outline" className="gap-1.5">
          <Users className="w-3 h-3" />
          {t('projectDetailPage.membersCount', { count: memberCount })}
        </Badge>
        <Badge variant="outline" className="gap-1.5">
          <Layers3 className="w-3 h-3" />
          {t('projectDetailPage.blocksCount', { count: blockCount })}
        </Badge>
        <Badge variant="outline" className="gap-1.5">
          <Target className="w-3 h-3" />
          {t('projectDetailPage.tasksCount', { count: taskCount })}
        </Badge>
        {/* Complexity weight — зөвхөн admin-tier-д (инженер,
            архитектор, ахлах, харилцагчид харагдахгүй). */}
        {isAdmin && (
          <Badge
            variant="outline"
            className={`gap-1.5 tabular-nums ${complexityPctColor(complexity)}`}
            title={t('projectDetailPage.complexityBaseWeight', { pct: complexity })}
          >
            {t('projectDetailPage.complexityWeight')} · {complexity}%
          </Badge>
        )}
      </div>
      {clients.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mr-1">
            {t('projectDetailPage.clientLabel')}
          </span>
          {clients.map((cl) => (
            <Badge
              key={cl.id}
              variant="outline"
              className="gap-1.5 bg-card/50"
              title={`${
                cl.type === 'company'
                  ? t('projectDetailPage.clientCompany')
                  : t('projectDetailPage.clientIndividual')
              } — ${cl.share_percent}%`}
            >
              {cl.type === 'company' ? (
                <Building2 className="w-3 h-3 text-primary" />
              ) : (
                <UserIcon className="w-3 h-3 text-primary" />
              )}
              <span className="truncate max-w-[180px]">{cl.name}</span>
              <span className="text-muted-foreground tabular-nums">· {cl.share_percent}%</span>
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}

export default ProjectHeroBadges;
