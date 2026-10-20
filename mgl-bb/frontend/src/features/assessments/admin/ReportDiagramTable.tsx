import { AlertTriangle } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';

import type { ResultPart } from '../lib/aggregate';
import { fmtPct, fmtPoints } from '../lib/exportAssessmentXlsx';
import { bandForMean, fmtMean, partMean, partScaleMax, sectionMean, sectionScaleMax } from '../lib/behaviorScale';
import { BehaviorBandTag, LevelTag } from '../components/LevelTag';

interface Props {
  part: ResultPart;
  /** true — 8 багана (Excel-тэй ижил); false — 4 багана. */
  detail?: boolean;
  className?: string;
}

/** Ур чадварын (weighted) part-ын хүснэгт — Жин + Үнэлгээний хувь + Level. */
function WeightedTable({ part, detail, t }: { part: ResultPart; detail: boolean; t: (k: string, p?: Record<string, string | number>) => string }) {
  return (
    <Table className="min-w-[720px]">
      <TableHeader>
        <TableRow>
          <TableHead>{t('assessments.colSection')}</TableHead>
          {detail && <TableHead className="text-right">{t('assessments.colMust')}</TableHead>}
          {detail && <TableHead className="text-right">{t('assessments.colSelf')}</TableHead>}
          {detail && <TableHead className="text-right">{t('assessments.colSenior')}</TableHead>}
          {detail && <TableHead className="text-right">{t('assessments.colAverage')}</TableHead>}
          <TableHead className="text-right">{t('assessments.colWeight')}</TableHead>
          <TableHead className="text-right">{t('assessments.colScorePct')}</TableHead>
          <TableHead>{t('assessments.colLevel')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {part.sections.map((section) => (
          <TableRow key={section.section_id}>
            <TableCell className="font-medium">{section.title}</TableCell>
            {detail && (
              <TableCell className="text-right tabular-nums">{fmtPoints(section.must)}</TableCell>
            )}
            {detail && (
              <TableCell className="text-right tabular-nums">{fmtPoints(section.self)}</TableCell>
            )}
            {detail && (
              <TableCell className="text-right tabular-nums">{fmtPoints(section.senior)}</TableCell>
            )}
            {detail && (
              <TableCell className="text-right tabular-nums">{fmtPoints(section.average)}</TableCell>
            )}
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {fmtPct(section.weight)}
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {fmtPct(section.pct)}
            </TableCell>
            <TableCell>
              <LevelTag level={section.level} />
            </TableCell>
          </TableRow>
        ))}
        <TableRow className="border-t-2 font-semibold">
          <TableCell>{t('assessments.colTotal')}</TableCell>
          {detail && (
            <TableCell className="text-right tabular-nums">{fmtPoints(part.totals.must)}</TableCell>
          )}
          {detail && (
            <TableCell className="text-right tabular-nums">{fmtPoints(part.totals.self)}</TableCell>
          )}
          {detail && (
            <TableCell className="text-right tabular-nums">{fmtPoints(part.totals.senior)}</TableCell>
          )}
          {detail && (
            <TableCell className="text-right tabular-nums">{fmtPoints(part.totals.average)}</TableCell>
          )}
          <TableCell className="text-right tabular-nums">{fmtPct(part.weight_sum)}</TableCell>
          <TableCell className="text-right tabular-nums">{fmtPct(part.overall_pct)}</TableCell>
          <TableCell>
            <LevelTag level={part.overall_level} />
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

/** Зан чанарын (weighted: false) part-ын хүснэгт — 1.0–5.0 дундаж + Монгол band. */
function BehaviorTable({ part, detail, t }: { part: ResultPart; detail: boolean; t: (k: string, p?: Record<string, string | number>) => string }) {
  const total = partMean(part);
  const totalMax = partScaleMax(part);
  return (
    <div className={cn(!detail && 'overflow-x-visible', detail && 'overflow-x-auto')}>
      <Table className={cn(detail ? 'min-w-[900px]' : 'min-w-[560px]')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('assessments.colSection')}</TableHead>
            <TableHead className="text-right">{t('assessments.colMaxScore')}</TableHead>
            <TableHead className="text-right">{t('assessments.colSelf')}</TableHead>
            <TableHead className="text-right">{t('assessments.colSenior')}</TableHead>
            <TableHead className="text-right">{t('assessments.colAverage')}</TableHead>
            <TableHead>{t('assessments.colBandLabel')}</TableHead>
            <TableHead>{t('assessments.colBandDescription')}</TableHead>
            {detail && <TableHead className="text-right text-muted-foreground">{t('assessments.colMust')}</TableHead>}
            {detail && <TableHead className="text-right text-muted-foreground">{t('assessments.colSelf')}</TableHead>}
            {detail && <TableHead className="text-right text-muted-foreground">{t('assessments.colSenior')}</TableHead>}
            {detail && <TableHead className="text-right text-muted-foreground">{t('assessments.colAverage')}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {part.sections.map((section) => {
            const band = bandForMean(sectionMean(section));
            return (
              <TableRow key={section.section_id}>
                <TableCell className="font-medium">{section.title}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {fmtMean(sectionScaleMax(section))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtMean(sectionMean(section, 'self'))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtMean(sectionMean(section, 'senior'))}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {fmtMean(sectionMean(section, 'average'))}
                </TableCell>
                <TableCell>
                  <BehaviorBandTag band={band} />
                </TableCell>
                <TableCell className="text-muted-foreground">{band?.description ?? '—'}</TableCell>
                {detail && (
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {fmtPoints(section.must)}
                  </TableCell>
                )}
                {detail && (
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {fmtPoints(section.self)}
                  </TableCell>
                )}
                {detail && (
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {fmtPoints(section.senior)}
                  </TableCell>
                )}
                {detail && (
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {fmtPoints(section.average)}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
          <TableRow className="border-t-2 font-semibold">
            <TableCell>{t('assessments.colTotal')}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtMean(totalMax)}</TableCell>
            <TableCell />
            <TableCell />
            <TableCell className="text-right tabular-nums">{fmtMean(total)}</TableCell>
            <TableCell>
              <BehaviorBandTag band={bandForMean(total)} />
            </TableCell>
            <TableCell />
            {detail && (
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {fmtPoints(part.totals.must)}
              </TableCell>
            )}
            {detail && <TableCell />}
            {detail && <TableCell />}
            {detail && (
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {fmtPoints(part.totals.average)}
              </TableCell>
            )}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

export function ReportDiagramTable({ part, detail = true, className }: Props) {
  const { t } = useLanguage();
  const weightOff = part.weighted && Math.abs(part.weight_sum - 100) > 0.01;

  return (
    <div className={cn('space-y-2', className)}>
      {weightOff && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-micro text-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          <span>{t('assessments.weightSumWarning', { sum: part.weight_sum.toFixed(1) })}</span>
        </div>
      )}
      {part.weighted ? (
        <WeightedTable part={part} detail={detail} t={t} />
      ) : (
        <>
          <p className="text-micro text-muted-foreground">
            {t('assessments.behaviorScaleLegendTitle')}
          </p>
          <BehaviorTable part={part} detail={detail} t={t} />
        </>
      )}
    </div>
  );
}

export default ReportDiagramTable;
