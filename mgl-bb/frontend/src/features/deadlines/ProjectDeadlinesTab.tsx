/**
 * Төслийн «Хугацаа» таб — шаардлага #2 ба #4.
 *
 * Урт төслийн хувьд гурван түвшнийг НЭГ жагсаалтад нэгтгэнэ:
 *   · ЭХНИЙ ДУУСАХ ХУГАЦАА — хамгийн ойрын дуусаагүй мөр (дээд самбар)
 *   · ДУНДЫН DEADLINE-УУД — блокийн уламжлагдсан муж + таскийн огноо
 *   · ТАСК БҮРИЙН ХУГАЦАА + дэд шалгах цэгүүд
 *
 * ⚠️ ХОЁР ГАДАРГУУ, ЗОРИУДААР.  «Төслийн хугацаанууд» карт нь
 *    `project_milestones` (migration 0173)-ийг ЗАСВАРЛАХ мод; доорх
 *    нэгдсэн жагсаалт нь таван эх сурвалжийг эрсдэлээр эрэмбэлсэн
 *    СКАНДАХ жагсаалт.  Milestone хоёуланд нь харагдана — тэд «юу
 *    зохион байгуулагдсан бэ» ба «юу яаралтай вэ» гэсэн ӨӨР асуултад
 *    хариулдаг.  `backend/src/routes/deadlines.ts`-ийн толгойг үз.
 */
import { AlertTriangle, CalendarClock, CalendarRange, Flag } from 'lucide-react';

import { Card, CardContent } from '@/ui/card';
import { ErrorState } from '@/shared/components/ErrorState';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { ATTENTION_STATES, RISK_TONE, riskDetail, riskLabelKey } from '@/features/timeline/lib/riskDisplay';

import { DeadlineHistoryCard } from './DeadlineHistoryCard';
import { DeadlineList } from './DeadlineList';
import { MilestoneManager } from './MilestoneManager';
import { useProjectDeadlines } from './api';
import type { DeadlineItem } from './types';

/** Дээд самбарын нэг хайрцаг. */
function SummaryTile({
  icon,
  label,
  value,
  sub,
  toneClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  toneClass?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={cn('mt-1 text-lg font-semibold tabular-nums', toneClass)}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function ProjectDeadlinesTab({ projectId }: { projectId: number }) {
  const { t } = useLanguage();
  const { data, isLoading, error, refetch } = useProjectDeadlines(projectId);

  const items: DeadlineItem[] = data?.items ?? [];

  // «Эхний дуусах хугацаа» = огноотой, дуусаагүй мөрүүдийн хамгийн эрт нь.
  // Сервер эрсдэлээр эрэмбэлж өгсөн тул огноогоор дахин хайна (эрсдэлийн
  // эрэмбэ нь «хамгийн яаралтай» — «хамгийн эрт» хоёр өөр асуулт).
  const nextItem = items
    .filter((i) => !i.done && i.due_date)
    .reduce<DeadlineItem | null>(
      (best, i) => (best === null || (i.due_date ?? '') < (best.due_date ?? '') ? i : best),
      null,
    );

  const attentionCount = items.filter(
    (i) => !i.done && ATTENTION_STATES.includes(i.risk_state),
  ).length;

  const proj = data?.project;
  const projTone = proj ? RISK_TONE[proj.risk_state] : null;

  if (error) {
    // Серверийн түүхий мөрийг («Access denied») ганцаараа харуулахын оронд
    // статусаар нь тайлбарлана + дахин оролдох товч.
    return (
      <Card>
        <CardContent>
          <ErrorState compact error={error} onRetry={() => void refetch()} />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Дээд самбар — гурван тоо: төслийн эцсийн хугацаа, хамгийн ойрын
          дуусах зүйл, анхаарал шаардсан мөрийн тоо. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile
          icon={<Flag className="h-3.5 w-3.5" />}
          label={t('deadlines.projectFinish')}
          value={proj?.finish_date ?? t('deadlines.noDate')}
          sub={
            proj
              ? riskDetail(t, proj.risk_state, proj.days_left, null, proj.days_to_start) ||
                t(riskLabelKey(proj.risk_state))
              : undefined
          }
          toneClass={projTone ? projTone.chip.split(' ').find((c) => c.startsWith('text-')) : ''}
        />
        <SummaryTile
          icon={<CalendarClock className="h-3.5 w-3.5" />}
          label={t('deadlines.nextDue')}
          value={nextItem?.due_date ?? t('deadlines.noDate')}
          sub={nextItem?.title}
        />
        <SummaryTile
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label={t('deadlines.needsAttention')}
          value={String(attentionCount)}
          sub={t('deadlines.needsAttentionSub')}
          toneClass={attentionCount > 0 ? 'text-warning' : undefined}
        />
      </div>

      {/* Дуусах хугацааны сунгалт + түүх (migration 0337) — «Сунгах» товч,
          анхны/одоогийн хугацаа, өөрчлөлт бүр. */}
      <DeadlineHistoryCard
        projectId={projectId}
        projectTitle={proj ? proj.display_title?.trim() || proj.name : ''}
        onChanged={() => void refetch()}
      />

      {/* Төслийн хугацаанууд — засварлах мод (admin + senior). */}
      <MilestoneManager
        projectId={projectId}
        items={items}
        canManage={data?.can_manage_milestones ?? false}
        loading={isLoading}
      />

      {/* Нэгтгэсэн жагсаалт. */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <CalendarRange className="h-3.5 w-3.5" />
            {t('deadlines.allDeadlines')}
          </div>
          <DeadlineList
            items={items}
            loading={isLoading}
            emptyLabel={t('deadlines.emptyProject')}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default ProjectDeadlinesTab;
