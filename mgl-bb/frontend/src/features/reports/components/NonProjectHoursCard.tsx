import { ClipboardList } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { useLanguage } from '@/shared/i18n';
import { categoryLabel, formatDuration } from '@/features/non-project-work/lib';
import type { EmployeeNonProjectWork } from '../types';

/** Цонхонд төслийн бус ажилд зарцуулсан цаг — татгалзсаныг сервер хассан. */
export function NonProjectHoursCard({
  work,
  windowFrom,
  windowTo,
}: {
  work: EmployeeNonProjectWork;
  windowFrom: string;
  windowTo: string;
}) {
  const { t } = useLanguage();
  return (
    <Card id="sec-reports-npw-hours" className="scroll-mt-24">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <ClipboardList className="h-4 w-4 text-primary" />
          {t('reportsPage.npwHoursTitle')}
          <span className="text-xs font-normal text-muted-foreground">· {formatDuration(work.minutes, t)}</span>
        </CardTitle>
        <CardDescription className="text-xs">
          {t('reportsPage.periodRange', { from: windowFrom, to: windowTo })} · {t('reportsPage.npwHoursHint')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {work.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('reportsPage.npwHoursNone')}</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {work.rows.map((row, i) => (
              <li key={`${row.date}-${i}`} className="flex items-start justify-between gap-2 rounded-md border border-border px-2 py-1.5">
                <span className="min-w-0">
                  <span className="font-medium">{categoryLabel(row.category, row.category, t)}</span>
                  {row.note && <span className="text-muted-foreground"> · {row.note}</span>}
                  <div className="text-[11px] text-muted-foreground">{row.date}</div>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="tabular-nums">{formatDuration(row.minutes, t)}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {t(row.status === 'approved' ? 'nonProjectWork.stage.approved' : 'nonProjectWork.stage.awaiting_review')}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
