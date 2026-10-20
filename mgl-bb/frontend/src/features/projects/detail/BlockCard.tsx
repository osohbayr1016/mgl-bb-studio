/** Horizontal block card in the project overview rail.
 *  Extracted verbatim from `ProjectDetailPage.tsx` when that file was split
 *  into per-component modules — no behavioural change. */
import { memo, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Boxes, Clock, FileText, Layers3, Target, User as UserIcon } from 'lucide-react';

import { apiFetch } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import type { BlockProgress } from '@/shared/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { Progress } from '@/ui/progress';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

import { BLOCK_ACCENTS } from './constants';
import { progressColor } from './helpers';
import { sumHoursOfTasks } from './taskHours';
import type { TaskHoursInfo } from './types';

export const BlockCard = memo(function BlockCard({
  block,
  index,
  selected,
  onSelect,
  projectId,
  canManage,
  hoursMode = false,
  taskHours,
}: {
  block: BlockProgress;
  index: number;
  selected: boolean;
  /** Receives the block id so the parent can pass ONE stable handler for the
   *  whole list instead of a fresh per-card closure (which would defeat memo). */
  onSelect: (blockId: number) => void;
  projectId: string;
  /** admin/senior — картан дээр хариуцагчийг шууд засах эрхтэй. */
  canManage: boolean;
  /** Цагаар бодогддог засварын төсөл (2026-09-24): блок/зургийн жин % ба явц %-ийн
   *  оронд тэдгээрийн таскуудын АЖИЛЛАСАН ЦАГ. */
  hoursMode?: boolean;
  taskHours?: ReadonlyMap<number, TaskHoursInfo>;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const totalComponents = block.drawings.reduce((sum, d) => sum + d.components.length, 0);
  const totalTasks = block.drawings.reduce(
    (sum, d) => sum + d.components.reduce((s, c) => s + c.tasks.length, 0),
    0,
  );
  const accent = BLOCK_ACCENTS[index % BLOCK_ACCENTS.length];
  const taskIdsOf = (d: BlockProgress['drawings'][number]) =>
    d.components.flatMap((c) => c.tasks.map((tk) => tk.id));
  const blockHours = hoursMode ? sumHoursOfTasks(block.drawings.flatMap(taskIdsOf), taskHours) : 0;

  // Хариуцагч — admin/senior картан дээр INLINE шууд бичнэ (чөлөөт нэр).
  const [respInput, setRespInput] = useState(block.responsible_name ?? '');
  const [savingResp, setSavingResp] = useState(false);
  useEffect(() => {
    setRespInput(block.responsible_name ?? '');
  }, [block.responsible_name]);
  const saveResponsible = async (raw: string) => {
    const name = raw.trim();
    if (name === (block.responsible_name ?? '')) return; // өөрчлөгдөөгүй бол алгасна
    setSavingResp(true);
    try {
      await apiFetch(`/projects/${projectId}/blocks/${block.id}/responsible`, {
        method: 'PUT',
        data: { name: name || null },
      });
      await queryClient.invalidateQueries({ queryKey: ['/projects'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'));
      setRespInput(block.responsible_name ?? '');
    } finally {
      setSavingResp(false);
    }
  };

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(block.id);
        }
      }}
      className={cn(
        'relative border-border/60 transition-all cursor-pointer hover:shadow-md overflow-hidden',
        'shrink-0 w-[260px] snap-start',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? [accent.border, accent.bg, 'shadow-lg ring-2', accent.ring]
          : ['hover:border-primary/40'],
      )}
      onClick={() => onSelect(block.id)}
    >
      <div className={cn('h-1.5 w-full', accent.solid)} />
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={cn(
                'w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors',
                selected ? `${accent.solid} text-white` : `${accent.bg} ${accent.text}`,
              )}
            >
              <Layers3 className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm truncate leading-tight">{block.name}</CardTitle>
              {/* Дотоод жин — ЗӨВХӨН админ/ахлахад (2026-10-02, ажилтанд харагдахгүй). */}
              {!hoursMode && canManage && (
                <CardDescription className="text-[11px] leading-tight">
                  {t('projectDetailPage.weight')} {block.weight_percent}%
                </CardDescription>
              )}
              {canManage ? (
                <div
                  className="mt-0.5 flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <UserIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <input
                    type="text"
                    value={respInput}
                    onChange={(e) => setRespInput(e.target.value)}
                    onBlur={(e) => saveResponsible(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    disabled={savingResp}
                    placeholder={t('projectDetailPage.responsible')}
                    className="h-5 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-[11px] text-muted-foreground placeholder:text-muted-foreground/50 hover:border-border/70 focus:border-primary/50 focus:bg-background focus:text-foreground focus:outline-none"
                  />
                </div>
              ) : (
                block.responsible_name && (
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <UserIcon className="h-3 w-3 shrink-0" />
                    <span className="truncate">{block.responsible_name}</span>
                  </div>
                )
              )}
            </div>
          </div>
          {hoursMode ? (
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary tabular-nums shrink-0">
              <Clock className="h-3.5 w-3.5" />
              {t('repair.hoursValue', { hours: blockHours })}
            </span>
          ) : (
            <span className="text-sm font-semibold text-primary tabular-nums shrink-0">
              {block.progress.toFixed(0)}%
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 px-3 pb-3">
        {!hoursMode && (
          <Progress
            value={block.progress}
            className="h-1.5"
            indicatorClassName={progressColor(block.progress)}
          />
        )}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="w-3 h-3" /> {block.drawings.length}
          </span>
          <span className="flex items-center gap-1">
            <Boxes className="w-3 h-3" /> {totalComponents}
          </span>
          <span className="flex items-center gap-1">
            <Target className="w-3 h-3" /> {totalTasks}
          </span>
        </div>

        {block.drawings.length > 0 && (
          <div
            className="space-y-1 pt-1.5 border-t border-border/60"
            onClick={(e) => e.stopPropagation()}
          >
            {block.drawings.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-[11px]">
                <span className="truncate flex-1 text-foreground/80">{d.name}</span>
                {hoursMode ? (
                  <span className="text-right text-muted-foreground tabular-nums">
                    {t('repair.hoursValue', { hours: sumHoursOfTasks(taskIdsOf(d), taskHours) })}
                  </span>
                ) : (
                  <>
                    <Progress
                      value={d.progress}
                      className="h-1 w-10"
                      indicatorClassName={progressColor(d.progress)}
                    />
                    <span className="w-7 text-right text-muted-foreground tabular-nums">
                      {d.progress.toFixed(0)}%
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
});

export default BlockCard;
