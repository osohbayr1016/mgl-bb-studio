/** The Block / Drawing / Component heading rows inside the grouped task
 *  table. Extracted verbatim from `ProjectDetailPage.tsx`
 *  (`GroupedTasksTable`) when that file was split into per-component
 *  modules — no behavioural change. */
import { Boxes, Clock, FileText, Layers3 } from 'lucide-react';

import { Badge } from '@/ui/badge';
import { TableCell, TableRow } from '@/ui/table';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

export function BlockHeadingRow({ label }: { label: string }) {
  return (
    <TableRow className="bg-muted/60 hover:bg-muted/60">
      <TableCell
        colSpan={6}
        className="py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold"
      >
        <span className="inline-flex items-center gap-1.5">
          <Boxes className="h-3.5 w-3.5" />
          {label}
        </span>
      </TableCell>
    </TableRow>
  );
}

export function DrawingHeadingRow({ label }: { label: string }) {
  return (
    <TableRow className="bg-sky-500/5 hover:bg-sky-500/10">
      <TableCell colSpan={6} className="py-1.5 text-xs text-sky-700 dark:text-sky-300 font-medium">
        <span className="inline-flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          {label}
        </span>
      </TableCell>
    </TableRow>
  );
}

export function ComponentHeadingRow({
  label,
  taskCount,
  sumDrawing,
  sumProj,
  wAvgProgress,
  sumHours,
  showWeights = true,
}: {
  label: string;
  taskCount: number;
  sumDrawing: number;
  sumProj: number;
  wAvgProgress: number;
  /** Цагаар бодогддог засварын төсөл (2026-09-24): гурван Σ хувийн оронд
   *  бүрдлийн таскуудын нийт АЖИЛЛАСАН ЦАГ.  Ердийн төсөлд undefined. */
  sumHours?: number;
  /** Σ жин (Зураг %, Төсөл %) — ЗӨВХӨН админ/ахлахад (2026-10-02). */
  showWeights?: boolean;
}) {
  const { t } = useLanguage();
  const labelCells = (
    <>
      <TableCell colSpan={2} className="py-2 text-sm font-semibold text-foreground">
        <span className="inline-flex items-center gap-2">
          <Layers3 className="h-4 w-4 text-primary" />
          {label}
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] tabular-nums">
            {taskCount}
          </Badge>
        </span>
      </TableCell>
      <TableCell className="hidden lg:table-cell" />
    </>
  );
  if (sumHours !== undefined) {
    return (
      <TableRow className="bg-primary/5 hover:bg-primary/10 border-t border-primary/20">
        {labelCells}
        <TableCell
          colSpan={3}
          className="px-1 text-micro font-semibold text-primary/80 tabular-nums"
        >
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />Σ {t('repair.hoursValue', { hours: sumHours })}
          </span>
        </TableCell>
      </TableRow>
    );
  }
  return (
    <TableRow className="bg-primary/5 hover:bg-primary/10 border-t border-primary/20">
      {labelCells}
      {showWeights && (
        <>
          <TableCell
            className="px-0.5 text-center text-[11px] text-muted-foreground tabular-nums"
            title={t('projectDetailPage.sumDrawingTitle')}
          >
            Σ {sumDrawing.toFixed(2)}%
          </TableCell>
          <TableCell
            className="px-0.5 text-center text-[11px] text-primary/80 font-semibold tabular-nums"
            title={t('projectDetailPage.sumProjectTitle')}
          >
            Σ {sumProj.toFixed(2)}%
          </TableCell>
        </>
      )}
      <TableCell className="px-0.5 text-[11px] text-muted-foreground" colSpan={showWeights ? 1 : 3}>
        <span className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full',
              wAvgProgress >= 100
                ? 'bg-emerald-500'
                : wAvgProgress > 0
                  ? 'bg-amber-500'
                  : 'bg-muted-foreground/40',
            )}
          />
          {t('projectDetailPage.sumProgress', { pct: wAvgProgress.toFixed(0) })}
        </span>
      </TableCell>
    </TableRow>
  );
}
