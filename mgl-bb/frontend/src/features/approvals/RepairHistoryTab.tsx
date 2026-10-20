import { useMemo, useState } from 'react';
import { Wrench } from 'lucide-react';

import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import type { RepairAdminEntry } from '@/shared/types';
import { Card, CardContent } from '@/ui/card';
import { DataTable, type DataTableColumn } from '@/ui/data-table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { formatDate } from '@/shared/lib/time';
import { formatPoints } from '@/shared/lib/score';
import { formatDisplayName } from '@/shared/lib/formatting';
import { RepairProjectsPanel } from './RepairProjectsPanel';

/**
 * Батлах хуудасны «Засвар» таб — бүх ажилтны засварын түүх (зөвхөн харах).
 * Admin-tier-т л харагдана (ApprovalsPage-ийн view-switch гаргана).  Ажилтан +
 * төслөөр client-side шүүнэ (endpoint 200 мөр буцаадаг).  Хувь нь ӨДРИЙН хувь
 * = hours / day_hours × 100 (`day_hours` = 8, миграци 0196).
 */
export function RepairHistoryTab() {
  const { t } = useLanguage();
  const query = useApiQuery<{ items: RepairAdminEntry[] }>('/repair/all');
  // `?? []` нь render бүрд ШИНЭ массив үүсгэдэг тул доорх бүх useMemo-г
  // ашиггүй болгодог байсан — тогтвортой лавлагаа болгож ороолоо.
  const items = useMemo(() => query.data?.items ?? [], [query.data]);

  const [userFilter, setUserFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');

  // Шүүлтүүрийн сонголтуудыг буцаж ирсэн өгөгдлөөс гаргана (давхардалгүй).
  const users = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of items) map.set(r.user_id, r.user_full_name);
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [items]);
  // ⚠️ ХОСОЛСОН түлхүүр (`p:<id>` / `r:<id>`).  `projects.id` ба
  //    `repair_projects.id` нь тус тусдаа AUTOINCREMENT тул 7 дугаар
  //    ХОЁУЛАНД нь байж болно — цэвэр тоон id-гаар Map-д хийвэл нэг нэр
  //    нөгөөг нь дарж, тэр мөрүүд шүүгдэхээ болино (миграци 0194).
  const projectToken = (r: RepairAdminEntry) =>
    r.repair_project_id != null ? `r:${r.repair_project_id}` : `p:${r.project_id}`;

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of items) map.set(projectToken(r), r.project_name);
    return Array.from(map, ([token, name]) => ({ token, name }));
  }, [items]);

  const filtered = useMemo(
    () =>
      items.filter(
        (r) =>
          (userFilter === 'all' || String(r.user_id) === userFilter) &&
          (projectFilter === 'all' || projectToken(r) === projectFilter),
      ),
    [items, userFilter, projectFilter],
  );

  const pct = (r: RepairAdminEntry) =>
    r.day_hours > 0 ? Math.round((r.hours / r.day_hours) * 100) : 0;

  const columns: DataTableColumn<RepairAdminEntry>[] = useMemo(
    () => [
      {
        id: 'employee',
        header: t('repair.adminColEmployee'),
        cell: (r) => (
          <span className="font-medium text-foreground">{formatDisplayName(r.user_full_name)}</span>
        ),
        sortValue: (r) => r.user_full_name,
      },
      {
        id: 'project',
        header: t('repair.adminColProject'),
        cell: (r) => (
          <span className="text-muted-foreground">
            {r.project_name}
            {/* Цагаар бодогддог төслийн таск (0341) — таскийн мөрөөс бүртгэсэн бол. */}
            {r.task_name && <span className="block text-micro">› {r.task_name}</span>}
          </span>
        ),
        sortValue: (r) => r.project_name,
      },
      {
        id: 'date',
        header: t('repair.adminColDate'),
        cell: (r) => (
          <span className="tabular-nums text-muted-foreground">{formatDate(new Date(r.date))}</span>
        ),
        // ISO мөрөөр эрэмбэлнэ — форматлагдсан огноо биш (тэр нь
        // «2026.08.03» хэлбэртэй тул үсгээр буруу эрэмбэлэгдэнэ).
        sortValue: (r) => r.date,
      },
      {
        id: 'description',
        header: t('repair.adminColDescription'),
        cell: (r) => (
          // Десктоп дээр таслана; мобайл картан дээр бүтнээрээ гарна.
          <span className="block max-w-xs truncate text-muted-foreground" title={r.description}>
            {r.description}
          </span>
        ),
        sortValue: (r) => r.description,
      },
      {
        id: 'hours',
        header: t('repair.adminColHours'),
        numeric: true,
        cell: (r) => (
          <span className="text-muted-foreground">
            {t('repair.hoursValue', { hours: r.hours })}
          </span>
        ),
        sortValue: (r) => r.hours,
      },
      {
        id: 'percent',
        header: t('repair.adminColPercent'),
        numeric: true,
        hideOnMobile: true,
        cell: (r) => <span className="text-muted-foreground">{pct(r)}%</span>,
        sortValue: (r) => pct(r),
      },
      {
        id: 'points',
        header: t('repair.adminColPoints'),
        numeric: true,
        cell: (r) => (
          <span className="font-semibold text-primary-ink">{formatPoints(r.computed_pct)}</span>
        ),
        sortValue: (r) => r.computed_pct,
      },
    ],
    [t],
  );

  return (
    <>
      {/* Админы удирдах хэсэг — дотоод ажлын сав, үнэ цэнийн үржвэр. */}
      <RepairProjectsPanel onChanged={() => void query.refetch()} />
      <Card>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            rows={query.isLoading ? undefined : filtered}
            rowKey={(r) => r.id}
            isLoading={query.isLoading}
            error={query.error}
            onRetry={() => void query.refetch()}
            emptyTitle={t('repair.adminEmpty')}
            defaultSort={{ id: 'date', dir: 'desc' }}
            className="p-3 md:p-0"
            toolbar={
              <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-border px-1 pb-3 md:mb-0 md:px-4 md:py-3">
                <div className="text-body mr-1 flex items-center gap-1.5 font-medium text-foreground">
                  <Wrench className="h-4 w-4 text-primary-ink" aria-hidden />
                  {t('repair.adminTabTitle')}
                </div>
                <Select value={userFilter} onValueChange={setUserFilter}>
                  <SelectTrigger className="h-8 w-44">
                    <SelectValue placeholder={t('repair.adminAllEmployees')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('repair.adminAllEmployees')}</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {formatDisplayName(u.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={projectFilter} onValueChange={setProjectFilter}>
                  <SelectTrigger className="h-8 w-52">
                    <SelectValue placeholder={t('repair.adminAllProjects')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('repair.adminAllProjects')}</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.token} value={p.token}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            }
          />
        </CardContent>
      </Card>
    </>
  );
}
