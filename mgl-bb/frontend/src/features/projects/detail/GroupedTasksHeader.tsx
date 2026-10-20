/** Two-row header for the per-discipline grouped task table.
 *  Extracted verbatim from `ProjectDetailPage.tsx` (`GroupedTasksTable`)
 *  when that file was split into per-component modules — no behavioural
 *  change. */
import { TableHead, TableHeader, TableRow } from '@/ui/table';
import { useLanguage } from '@/shared/i18n';

export function GroupedTasksHeader({
  onAjilResize,
  hoursMode = false,
  showWeights = true,
}: {
  /** Drag handler from the parent TasksFlatTable — widens the Ажил
   *  column (via the shared --ajil-extra-w CSS variable) so the
   *  right-side columns slide rightward as a unit. The flat table
   *  and this grouped table share the same handler so both react in
   *  lockstep. */
  onAjilResize?: (e: React.PointerEvent<HTMLDivElement>) => void;
  /** Цагаар бодогддог засварын төсөл (2026-09-24): гурван хувийн баганы оронд
   *  НЭГ «Ажилласан цаг» багана (colSpan 3) — толгой нэг мөртэй. */
  hoursMode?: boolean;
  /** Дотоод жингийн баганууд («Зураг %», «Төсөл %») — ЗӨВХӨН админ/ахлахад (2026-10-02).  false бол «Явц» ганц багана. */
  showWeights?: boolean;
}) {
  const { t } = useLanguage();
  const rows = hoursMode || !showWeights ? 1 : 2;
  return (
    <TableHeader>
      {/* Two-row header so we can group the three percent columns
            under one shared "Хувь" label.  Each percent column is then
            labelled in plain Mongolian (Зураг % / Төсөл % / Явц) so an
            admin scanning the table never has to re-derive what the
            number means. */}
      <TableRow className="bg-muted/40 hover:bg-muted/40 border-b-0">
        <TableHead
          rowSpan={rows}
          className="w-[44px] text-center text-[11px] uppercase tracking-wider text-muted-foreground align-middle"
        >
          #
        </TableHead>
        <TableHead rowSpan={rows} className="text-[11px] uppercase tracking-wider align-middle">
          {t('projectDetailPage.colTask')}
        </TableHead>
        <TableHead
          rowSpan={rows}
          className="hidden lg:table-cell text-[11px] uppercase tracking-wider align-middle relative"
        >
          {onAjilResize && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('projectDetailPage.resizeAjilColumn')}
              onPointerDown={onAjilResize}
              title={t('projectDetailPage.resizeAjilHint')}
              className="group absolute top-0 left-0 -translate-x-1/2 h-full w-3 cursor-col-resize touch-none select-none z-10 flex items-center justify-center"
            >
              <div className="h-5 w-0.5 bg-primary/50 group-hover:bg-primary group-hover:w-1 group-active:bg-primary group-active:w-1 transition-all" />
            </div>
          )}
          {t('projectDetailPage.colAssignee')}
        </TableHead>
        {hoursMode ? (
          <TableHead
            colSpan={3}
            className="w-[188px] text-label uppercase align-middle px-1"
            title={t('projectDetailPage.colWorkedHoursTitle')}
          >
            {t('projectDetailPage.colWorkedHours')}
          </TableHead>
        ) : showWeights ? (
          <TableHead
            colSpan={3}
            className="text-center text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/40 py-1 px-1"
          >
            {t('projectDetailPage.colPercent')}
          </TableHead>
        ) : (
          <TableHead
            colSpan={3}
            className="w-[188px] px-1 text-[11px] uppercase tracking-wider align-middle"
            title={t('projectDetailPage.colProgressTitle')}
          >
            {t('projectDetailPage.colProgress')}
          </TableHead>
        )}
      </TableRow>
      {!hoursMode && showWeights && (
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableHead
            className="w-[44px] px-0.5 text-center text-[11px] uppercase tracking-wider text-muted-foreground"
            title={t('projectDetailPage.colDrawingPctTitle')}
          >
            {t('projectDetailPage.colDrawingPct')}
          </TableHead>
          <TableHead
            className="w-[44px] px-0.5 text-center text-[11px] uppercase tracking-wider"
            title={t('projectDetailPage.colProjectPctTitle')}
          >
            {t('projectDetailPage.colProjectPct')}
          </TableHead>
          <TableHead
            className="w-[100px] px-0.5 text-[11px] uppercase tracking-wider"
            title={t('projectDetailPage.colProgressTitle')}
          >
            {t('projectDetailPage.colProgress')}
          </TableHead>
        </TableRow>
      )}
    </TableHeader>
  );
}

export default GroupedTasksHeader;
