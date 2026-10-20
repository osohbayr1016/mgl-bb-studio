/**
 * Зургийн жагсаалт (drawing register) — архитектурын товчооны «хуудасны
 * бүртгэл» хэлбэр.  Мөр бүр дарж дэлгэхэд бүрдэл → ажил хүртэл харагдана.
 * Хүний нэр, хариуцагч ХЭЗЭЭ Ч гарахгүй (backend нь өөрөө буцаадаггүй).
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { Button } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';
import { teamHex } from '@/shared/lib/team-colors';
import { cn } from '@/shared/lib/utils';

import type { BlockComponent, BlockDrawing } from '../client-dashboard.types';
import { ProgressLine, SubHeader, WorkDot } from '../components/primitives';
import { pctInt, stripTeamPrefix } from '../lib/clientFormat';
import { countLabel } from '../lib/labels';

export function DrawingRegister({ drawings }: { drawings: BlockDrawing[] }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const expandable = drawings.filter((d) => d.components.some((c) => c.tasks.length > 0));
  const allOpen = expandable.length > 0 && expandable.every((d) => open.has(d.id));

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div data-testid="client-drawing-register">
      <SubHeader
        title={t('clientRoom.progressTab.register')}
        meta={String(drawings.length).padStart(2, '0')}
        action={
          expandable.length > 0 ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto pointer-coarse:h-auto px-0 has-[>svg]:px-0 text-body text-foreground"
              onClick={() => setOpen(allOpen ? new Set() : new Set(expandable.map((d) => d.id)))}
            >
              {allOpen ? t('clientRoom.progressTab.collapseAll') : t('clientRoom.progressTab.expandAll')}
            </Button>
          ) : null
        }
      />

      {drawings.length === 0 ? (
        <p className="py-10 text-sm text-muted-foreground">{t('clientRoom.progressTab.noDrawings')}</p>
      ) : (
        <>
          <div
            aria-hidden
            className="hidden grid-cols-[2.5rem_4.5rem_minmax(0,1fr)_4rem_minmax(0,9rem)_3.5rem_1.25rem] items-center gap-4 border-b border-foreground/10 py-2.5 font-mono text-label uppercase tracking-[0.12em] text-muted-foreground md:grid"
          >
            <span>{t('clientRoom.progressTab.colNo')}</span>
            <span>{t('clientRoom.progressTab.colCode')}</span>
            <span>{t('clientRoom.progressTab.colName')}</span>
            <span className="text-right">{t('clientRoom.progressTab.colTasks')}</span>
            <span>{t('clientRoom.progressTab.colProgress')}</span>
            <span className="text-right">%</span>
            <span />
          </div>
          <ul className="divide-y divide-foreground/10 border-b border-foreground/10">
            {drawings.map((d, i) => {
              const hasTasks = d.components.some((c) => c.tasks.length > 0);
              const isOpen = open.has(d.id);
              const panelId = `drawing-${d.id}-tasks`;
              const display = stripTeamPrefix(d.name, d.team_code);
              return (
                <li key={d.id}>
                  <Button
                    variant="ghost"
                    onClick={() => hasTasks && toggle(d.id)}
                    aria-expanded={hasTasks ? isOpen : undefined}
                    aria-controls={hasTasks ? panelId : undefined}
                    disabled={!hasTasks}
                    className="grid h-auto pointer-coarse:h-auto w-full grid-cols-[2.5rem_minmax(0,1fr)_3.5rem_1.25rem] items-center gap-x-4 gap-y-2 whitespace-normal rounded-none px-0 py-4 has-[>svg]:px-0 text-left font-normal hover:bg-foreground/[0.03] disabled:opacity-100 md:grid-cols-[2.5rem_4.5rem_minmax(0,1fr)_4rem_minmax(0,9rem)_3.5rem_1.25rem]"
                  >
                    <span className="font-mono text-micro tabular-nums text-muted-foreground">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="hidden items-center gap-2 font-mono text-micro text-foreground md:flex">
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0"
                        style={{ backgroundColor: teamHex(d.team_code) }}
                      />
                      {d.team_code ?? '—'}
                    </span>
                    <span className="min-w-0 text-sm leading-snug text-foreground" title={d.name}>
                      <span className="line-clamp-2">{display}</span>
                      <span className="mt-1 block font-mono text-micro text-muted-foreground md:hidden">
                        {d.team_code ? `${d.team_code} · ` : ''}
                        {countLabel(t, 'clientRoom.progressTab.tasksCount', d.task_count)}
                      </span>
                    </span>
                    <span className="hidden text-right font-mono text-micro tabular-nums text-muted-foreground md:block">
                      {d.task_count}
                    </span>
                    <ProgressLine
                      value={d.progress}
                      color={teamHex(d.team_code)}
                      className="col-span-2 col-start-2 row-start-2 md:col-span-1 md:col-start-auto md:row-start-auto"
                    />
                    <span className="text-right font-display text-lg font-light tabular-nums text-foreground">
                      {pctInt(d.progress)}%
                    </span>
                    <ChevronDown
                      aria-hidden
                      className={cn(
                        'h-4 w-4 text-muted-foreground transition-transform',
                        !hasTasks && 'opacity-0',
                        isOpen && 'rotate-180',
                      )}
                      strokeWidth={1.5}
                    />
                  </Button>
                  {hasTasks && isOpen ? (
                    <div id={panelId} className="mb-4 border-l border-foreground/15 pl-4 md:ml-[3.5rem]">
                      {d.components.map((co) => (
                        <ComponentBlock key={co.id} component={co} drawingName={d.name} color={teamHex(d.team_code)} />
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-label uppercase tracking-[0.12em] text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <WorkDot progress={100} /> {t('clientRoom.progressTab.legendDone')}
            </span>
            <span className="inline-flex items-center gap-2">
              <WorkDot progress={50} /> {t('clientRoom.progressTab.legendActive')}
            </span>
            <span className="inline-flex items-center gap-2">
              <WorkDot progress={0} /> {t('clientRoom.progressTab.legendTodo')}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function ComponentBlock({
  component,
  drawingName,
  color,
}: {
  component: BlockComponent;
  drawingName: string;
  color: string;
}) {
  const { t } = useLanguage();
  const trimmed = (component.name ?? '').trim();
  // Нэр нь зургийнхтай ижил эсвэл «—» бол толгой нь илүүц.
  const redundant =
    !trimmed ||
    trimmed === '—' ||
    trimmed === '-' ||
    trimmed.toLowerCase() === drawingName.trim().toLowerCase();

  return (
    <div className="py-2">
      {!redundant ? (
        <div className="flex items-center justify-between gap-4 py-2">
          <span className="min-w-0 truncate font-mono text-label uppercase tracking-[0.12em] text-muted-foreground" title={component.name}>
            {component.name}
          </span>
          <span className="shrink-0 font-mono text-micro tabular-nums text-muted-foreground">
            {pctInt(component.progress)}%
          </span>
        </div>
      ) : null}
      <ul>
        {component.tasks.map((task) => (
          <li
            key={task.id}
            className="grid grid-cols-[0.75rem_minmax(0,1fr)_3rem] items-center gap-3 py-1.5 md:grid-cols-[0.75rem_minmax(0,1fr)_5rem_minmax(0,7rem)_3rem]"
          >
            <WorkDot progress={task.progress} />
            <span className="min-w-0 truncate text-body text-foreground" title={task.name}>
              {task.name}
            </span>
            <span className="hidden text-right font-mono text-micro tabular-nums text-muted-foreground md:block">
              {t('clientRoom.progressTab.weight', { value: task.weight_percent.toFixed(1) })}
            </span>
            <ProgressLine value={task.progress} size="hair" color={color} className="hidden md:block" />
            <span className="text-right font-mono text-micro tabular-nums text-foreground">
              {pctInt(task.progress)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
