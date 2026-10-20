import { useMemo } from 'react';
import { Activity, ArrowLeft, CalendarRange, Loader2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import ActivityHeatmap from '@/features/daily-log/ActivityHeatmap';
import LogDigest from '@/features/daily-log/LogDigest';
import { heatScale } from '@/features/daily-log/lib';
import { useManagementMember } from '../api';
import type { ReportWindow } from '../types';

const DAY_ID = 'mgmt-day-';

/**
 * Менежментийн багийн нэг гишүүний ӨӨРИЙН нэгтгэл: тухайн хугацаанд нийт юу
 * хийсэн (өдрөөр бүлэглэсэн бүх ажил) + сүүлийн жилийн contribution heatmap
 * (hover → тэр өдрийн ажил; дарахад нэгтгэл дэх тэр өдөр рүү гүйлгэнэ).
 * Хувь, хамралт, хоцорсон өдөр гэх мэт KPI ЗОРИУД байхгүй (эзэн 2026-10-08).
 */
export function ManagementMemberView({
  userId,
  window,
  anchor,
  onBack,
}: {
  userId: number;
  window: ReportWindow;
  anchor: string;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const q = useManagementMember(userId, window, anchor);
  const data = q.data;

  const { counts, itemsByDate } = useMemo(() => {
    const logs = data?.logs ?? [];
    return {
      counts: new Map(logs.map((l) => [l.log_date, l.items.length])),
      itemsByDate: new Map(logs.map((l) => [l.log_date, l.items])),
    };
  }, [data]);
  const scale = useMemo(() => heatScale(counts.values()), [counts]);

  const back = (
    <Button type="button" variant="ghost" size="sm" onClick={onBack} className="-ml-2">
      <ArrowLeft className="h-4 w-4" />
      {t('mgmtLogs.back')}
    </Button>
  );

  if (q.isLoading) {
    return (
      <div className="space-y-3">
        {back}
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }
  if (q.isError || !data) {
    return (
      <div className="space-y-3">
        {back}
        <p className="py-10 text-center text-sm text-destructive">{t('mgmtLogs.loadFailed')}</p>
      </div>
    );
  }

  const { member, range } = data;
  const scrollTo = (date: string) => {
    document
      .getElementById(`${DAY_ID}${date}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          {back}
          <h2 className="mt-1 flex flex-wrap items-center gap-2 text-title">
            {member.name}
            {member.is_ceo && <Badge variant="outline">{t('mgmtLogs.ceo')}</Badge>}
            {!member.active && <Badge variant="outline">{t('mgmtLogs.inactive')}</Badge>}
          </h2>
          {member.position && <p className="text-sm text-muted-foreground">{member.position}</p>}
        </div>
        <span className="inline-flex items-center gap-1 text-micro tabular-nums text-muted-foreground">
          <CalendarRange className="h-3.5 w-3.5" aria-hidden />
          {range.from === range.to ? range.from : `${range.from} – ${range.to}`}
        </span>
      </div>

      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-success" aria-hidden />
            {t('mgmtLogs.memberHeat')}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <ActivityHeatmap
            today={data.heat.to}
            counts={counts}
            itemsByDate={itemsByDate}
            scale={scale}
            loading={q.isFetching}
            onPick={(d) => {
              if (d >= range.from && d <= range.to) scrollTo(d);
            }}
          />
        </CardContent>
      </Card>

      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-base">{t('mgmtLogs.memberDigest')}</CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <LogDigest
            logs={data.logs}
            from={range.from}
            to={range.to}
            dayIdPrefix={DAY_ID}
            emptyText={t('mgmtLogs.noLogs')}
          />
        </CardContent>
      </Card>
    </div>
  );
}
