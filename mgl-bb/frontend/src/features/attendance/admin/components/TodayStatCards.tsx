import type { ComponentType, ReactNode } from 'react';
import { AlertTriangle, Timer, UserCheck, UserX } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import type { AttendanceSession, AttendanceStats } from '@/shared/types';

function StatCard({
  title,
  icon: Icon,
  bubbleClass,
  iconClass,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  bubbleClass: string;
  iconClass: string;
  children: ReactNode;
}) {
  return (
    <Card className="border-border bg-card/60 backdrop-blur">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={`h-8 w-8 rounded-full ${bubbleClass} flex items-center justify-center`}>
          <Icon className={`h-4 w-4 ${iconClass}`} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold text-foreground">{children}</div>
      </CardContent>
    </Card>
  );
}

/** Өнөөдрийн 4 тоолуур — ирсэн / ирээгүй / хоцорсон / ажиллаж байгаа. */
export default function TodayStatCards({
  todaySessions,
  stats,
}: {
  todaySessions: AttendanceSession[];
  stats: AttendanceStats | null;
}) {
  const { t } = useLanguage();
  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      <StatCard
        title={t('attendanceAdminPage.cardPresent')}
        icon={UserCheck}
        bubbleClass="bg-emerald-500/10"
        iconClass="text-emerald-500"
      >
        {todaySessions.length}
      </StatCard>
      <StatCard
        title={t('attendanceAdminPage.cardAbsent')}
        icon={UserX}
        bubbleClass="bg-destructive/10"
        iconClass="text-destructive"
      >
        {stats?.absent_today.length ?? 0}
      </StatCard>
      <StatCard
        title={t('attendanceAdminPage.cardLate')}
        icon={AlertTriangle}
        bubbleClass="bg-yellow-500/10"
        iconClass="text-yellow-500"
      >
        {stats?.late_today.length ?? 0}
      </StatCard>
      <StatCard
        title={t('attendanceAdminPage.cardWorking')}
        icon={Timer}
        bubbleClass="bg-primary/10"
        iconClass="text-primary"
      >
        {todaySessions.filter((s) => !s.clock_out).length}
      </StatCard>
    </div>
  );
}
