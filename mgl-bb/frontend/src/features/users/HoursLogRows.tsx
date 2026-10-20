import { Link } from 'react-router-dom';
import { ClipboardList, Wrench } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { fmtHours } from '@/features/reports/lib/format';
import { STAGE_TONE, categoryLabel } from '@/features/non-project-work/lib';
import { fmtRate, type NonProjectLogItem, type RepairLogItem } from './hoursLog';

/**
 * «Өдрийн тайлан» табын засвар / төслийн бус ажлын мөрүүд: ажилласан цаг +
 * тэр мөчийн өдрийн дундаж хувь + олгосон хувь (= дундаж × цаг / 8).
 * Өгөгдлийн хэлбэр ба форматлагч нь `./hoursLog.ts`-д.
 */

function roundHours(h: number): number {
  return Math.round(h * 100) / 100;
}

function HoursCell({ hours }: { hours: number }) {
  return (
    <div
      className={cn(
        'text-xs font-semibold px-2 py-1 rounded flex-shrink-0 tabular-nums',
        hours > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
      )}
    >
      {hours > 0 ? fmtHours(hours) : '— '}
    </div>
  );
}

function RateLine({ rate, hours, pct }: { rate: number | null; hours: number; pct: number | null }) {
  const { t } = useLanguage();
  return (
    <p className="text-xs text-foreground/80 mt-0.5 tabular-nums" data-testid="hours-log-rate">
      {t('userProfileViewPage.rateLine', {
        rate: fmtRate(rate ?? 0),
        hours: roundHours(hours),
        pct: fmtRate(pct ?? 0),
      })}
    </p>
  );
}

export function RepairLogRow({ item }: { item: RepairLogItem }) {
  const { t } = useLanguage();
  const title = item.task_name || item.project_name || t('userProfileViewPage.unnamedItem');
  const isMark = item.kind === 'mark';
  const isBackfill = item.hours_source === 'backfill';

  return (
    <div
      className="px-5 py-3 flex items-start gap-3 hover:bg-muted/30 transition-colors"
      data-testid="hours-log-repair"
    >
      <div className="h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 bg-primary/15 text-primary">
        <Wrench className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-foreground truncate flex-1 min-w-0">{title}</p>
          <Badge variant="outline" className="text-label bg-primary/10 text-primary border-primary/30">
            {item.is_repair_project
              ? t('userProfileViewPage.kindRepairProject')
              : t('userProfileViewPage.kindRepair')}
          </Badge>
          {item.hours_source === 'auto' && !isMark && (
            <Badge variant="outline" className="text-label bg-info/10 text-info border-info/30">
              {t('userProfileViewPage.hoursAuto')}
            </Badge>
          )}
          {isBackfill && (
            <Badge variant="outline" className="text-label bg-muted text-muted-foreground border-border">
              {t('userProfileViewPage.hoursBackfill')}
            </Badge>
          )}
        </div>
        {item.task_name && item.project_name && (
          <p className="text-micro text-muted-foreground truncate mt-0.5">
            {item.project_id ? (
              <Link to={`/app/projects/${item.project_id}`} className="hover:underline">
                {item.project_name}
              </Link>
            ) : (
              item.project_name
            )}
          </p>
        )}
        {item.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
        )}
        {isMark ? (
          <p className="text-xs text-muted-foreground mt-0.5">{t('userProfileViewPage.repairMarkZero')}</p>
        ) : isBackfill || item.daily_rate == null ? (
          <p className="text-xs text-muted-foreground mt-0.5">{t('userProfileViewPage.repairBackfillNote')}</p>
        ) : (
          <RateLine rate={item.daily_rate} hours={item.hours} pct={item.computed_pct} />
        )}
      </div>
      <HoursCell hours={item.hours} />
    </div>
  );
}

export function NonProjectLogRow({ item }: { item: NonProjectLogItem }) {
  const { t } = useLanguage();
  const label = categoryLabel(item.category, item.category_label, t);
  const hours = item.minutes / 60;
  const timeText =
    item.start_time && item.end_time
      ? `${item.start_time}–${item.end_time}`
      : item.minutes > 0
        ? t('userProfileViewPage.npwTimeless')
        : t('nonProjectWork.noTime');

  return (
    <div
      className="px-5 py-3 flex items-start gap-3 hover:bg-muted/30 transition-colors"
      data-testid="hours-log-npw"
      data-stage={item.stage}
    >
      <div className="h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 bg-info/15 text-info">
        <ClipboardList className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-foreground truncate flex-1 min-w-0">
            {label}
            {item.note && <span className="font-normal text-muted-foreground"> · {item.note}</span>}
          </p>
          <Badge variant="outline" className="text-label bg-info/10 text-info border-info/30">
            {t('userProfileViewPage.kindNonProject')}
          </Badge>
          <Badge variant="outline" className={cn('text-label', STAGE_TONE[item.stage])}>
            {t(`nonProjectWork.stage.${item.stage}`)}
          </Badge>
        </div>
        <p className="text-micro text-muted-foreground mt-0.5 tabular-nums">{timeText}</p>
        {item.report && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.report}</p>
        )}
        {item.stage === 'approved' && item.computed_pct != null ? (
          <RateLine rate={item.daily_rate} hours={hours} pct={item.computed_pct} />
        ) : item.stage === 'rejected' ? (
          <p className="text-xs text-destructive/90 mt-0.5">
            {item.review_note
              ? t('userProfileViewPage.reviewerNote', { note: item.review_note })
              : t('userProfileViewPage.npwRejected')}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground mt-0.5">{t('userProfileViewPage.npwPendingRate')}</p>
        )}
      </div>
      <HoursCell hours={item.status === 'rejected' ? 0 : hours} />
    </div>
  );
}
