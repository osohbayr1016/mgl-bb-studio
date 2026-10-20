import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Boxes, Calculator, FileSpreadsheet, Loader2, Search } from 'lucide-react';

import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/card';
import { Input } from '@/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { TabsList, TabsTrigger } from '@/ui/tabs';
import { KeepAliveTabs, KeepAliveTabsPanel } from '@/ui/keep-alive-tabs';
import { cn } from '@/shared/lib/utils';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { formatDate, formatDateTime } from '@/shared/lib/time';

import { DashboardTab } from './components/dashboard/DashboardTab';
import { LegacyRunCard } from './components/LegacyRunCard';
import { PivotTable } from './components/PivotTable';
import { RunDiff } from './components/RunDiff';
import { RunHistory, SourceBadge } from './components/RunHistory';
import { TotalsCards } from './components/TotalsCards';
import { exportQtoXlsx } from './lib/exportXlsx';
import { fmtNum, type PivotField } from './lib/pivots';
import {
  isRevitSummary,
  type QtoFactRow,
  type QtoProjectOverviewItem,
  type QtoRunDetail,
  type QtoRunListItem,
  type RevitTotals,
} from './lib/types';

/**
 * Тоо хэмжээ — read-only pivot/history workspace over the quantity runs the
 * Revit add-in POSTs to the backend. The old in-browser web-ifc take-off is
 * gone; legacy IFC runs remain readable in the Түүх tab.
 */

/** Табны утгууд нь глобал хайлтын гүн холбоосын бай (`?tab=…`) — эдгээрийг
 *  `frontend/src/shared/lib/search/sections.ts` давхар тусгасан тул нэрийг
 *  солих бол хоёуланг нь зэрэг солино. */
const QTO_TABS = ['dashboard', 'overview', 'pivot', 'history'] as const;
type QtoTab = (typeof QTO_TABS)[number];

type PivotAxis = 'category' | 'material' | 'level';

const AXIS_FIELDS: Record<PivotAxis, PivotField[]> = {
  category: ['category', 'family', 'type_name'],
  material: ['material', 'category'],
  level: ['level', 'category'],
};

export default function QtoPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useTabParam(QTO_TABS, 'dashboard', 'tab');
  const [axis, setAxis] = useState<PivotAxis>('category');
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  // admin + senior only — mirrors the backend requireRole('admin','senior')
  // gate on /api/qto/*. Queries stay disabled for everyone else so we don't
  // fire a doomed 403 before the redirect below unmounts the page.
  const allowed = !!user && (user.role === 'admin' || user.role === 'senior');
  const isAdmin = user?.role === 'admin';

  const overviewQuery = useApiQuery<{ projects: QtoProjectOverviewItem[] }>(
    '/qto/projects-overview',
    { enabled: allowed },
  );
  const overview = useMemo(() => overviewQuery.data?.projects ?? [], [overviewQuery.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return overview;
    return overview.filter((p) =>
      `${p.display_title ?? ''} ${p.project_name}`.toLowerCase().includes(q),
    );
  }, [overview, search]);

  const runsQuery = useApiQuery<{ runs: QtoRunListItem[] }>(
    ['/qto/runs', selectedId],
    `/qto/runs?project_id=${selectedId}`,
    { enabled: allowed && selectedId != null },
  );
  // Newest-first, defensively (the API already returns them ordered).
  const runs = useMemo(
    () => [...(runsQuery.data?.runs ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [runsQuery.data],
  );

  const latestRun = runs[0] ?? null;
  const latestRevitRun = useMemo(() => runs.find((r) => r.source === 'revit') ?? null, [runs]);
  const revitRuns = useMemo(() => runs.filter((r) => r.source === 'revit'), [runs]);
  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

  // Тойм always shows the LATEST run; its summary needs the detail endpoint.
  const latestDetailQuery = useApiQuery<{ run: QtoRunDetail }>(
    ['/qto/runs', latestRun?.id ?? null],
    `/qto/runs/${latestRun?.id}`,
    { enabled: allowed && latestRun != null },
  );

  // Legacy run picked in Түүх → compact summary card needs its detail too.
  const legacySelected = selectedRun != null && selectedRun.source !== 'revit';
  const legacyDetailQuery = useApiQuery<{ run: QtoRunDetail }>(
    ['/qto/runs', legacySelected ? selectedRun.id : null],
    `/qto/runs/${selectedRun?.id}`,
    { enabled: allowed && legacySelected },
  );

  // Ангилал pivots the selected revit run, defaulting to the latest one.
  const pivotRun = selectedRun?.source === 'revit' ? selectedRun : latestRevitRun;
  const factsQuery = useApiQuery<{ facts: QtoFactRow[] }>(
    ['/qto/runs', pivotRun?.id ?? null, 'facts'],
    `/qto/runs/${pivotRun?.id}/facts`,
    { enabled: allowed && pivotRun != null && tab === 'pivot' },
  );

  const handleSelectProject = (id: number) => {
    setSelectedId(id);
    setSelectedRunId(null);
    setTab('dashboard');
  };

  // Самбарын chip-ээс тухайн run-ы type-түвшний pivot руу үсэрнэ; KeepAliveTabs
  // тул буцахад самбарын expand/chip төлөв хэвээр байна.
  const handleDrill = (runId: number) => {
    setSelectedRunId(runId);
    setTab('pivot');
  };

  const handleDeleteRun = async (id: number) => {
    const ok = await confirmDialog({
      description: t('qtoPage.deleteConfirm'),
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiFetch(`/qto/runs/${id}`, { method: 'DELETE' });
      toast.success(t('qtoPage.runDeleted'));
      if (selectedRunId === id) setSelectedRunId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/qto/runs', selectedId] }),
        queryClient.invalidateQueries({ queryKey: ['/qto/projects-overview'] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('qtoPage.deleteFailed'));
    }
  };

  // Excel export — the CURRENT (latest) run's facts; revit runs only.
  const handleExport = async () => {
    if (!latestRun || latestRun.source !== 'revit' || exporting) return;
    setExporting(true);
    try {
      const { facts } = await apiFetch<{ facts: QtoFactRow[] }>(
        `/qto/runs/${latestRun.id}/facts`,
      );
      const detail = latestDetailQuery.data?.run;
      const summary = detail && isRevitSummary(detail.summary) ? detail.summary : null;
      const project = overview.find((p) => p.project_id === selectedId);
      const base = (latestRun.file_name ?? 'model').replace(/\.[^.]+$/, '');
      await exportQtoXlsx({
        fileName: `qto_${base}.xlsx`,
        meta: {
          project: project?.display_title || project?.project_name || '',
          file: latestRun.file_name ?? '',
          date: formatDateTime(latestRun.created_at),
          by: latestRun.created_by_name ?? '',
          revitVersion: summary?.revit_version ?? '',
        },
        totals: summary?.totals ?? null,
        facts,
        labels: {
          sheetOverview: t('qtoPage.sheetOverview'),
          sheetCategory: t('qtoPage.sheetCategory'),
          sheetMaterial: t('qtoPage.sheetMaterial'),
          sheetLevel: t('qtoPage.sheetLevel'),
          project: t('qtoPage.project'),
          file: t('qtoPage.runFile'),
          date: t('qtoPage.runDate'),
          by: t('qtoPage.runBy'),
          revitVersion: t('qtoPage.revitVersion'),
          category: t('qtoPage.colCategory'),
          family: t('qtoPage.colFamily'),
          type: t('qtoPage.colType'),
          level: t('qtoPage.colLevel'),
          material: t('qtoPage.colMaterial'),
          count: t('qtoPage.colCount'),
          length: t('qtoPage.colLength'),
          area: t('qtoPage.colArea'),
          volume: t('qtoPage.colVolume'),
          mass: t('qtoPage.colMass'),
          total: t('qtoPage.total'),
          noCategory: t('qtoPage.noCategory'),
          noFamily: t('qtoPage.noFamily'),
          noType: t('qtoPage.noType'),
          noLevel: t('qtoPage.noLevel'),
          noMaterial: t('qtoPage.noMaterial'),
        },
      });
    } catch {
      toast.error(t('qtoPage.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  if (!allowed) return <Navigate to="/app" replace />;

  /* ---- derived render pieces --------------------------------------------- */

  const latestDetail = latestDetailQuery.data?.run ?? null;
  const latestSummary = latestDetail && isRevitSummary(latestDetail.summary)
    ? latestDetail.summary
    : null;
  const latestIsRevit = latestRun?.source === 'revit';

  // Totals for the Тойм cards: summary.totals for revit runs, run meta for
  // legacy ones (which never carried length/mass).
  const overviewTotals: RevitTotals | null = latestRun
    ? latestSummary?.totals ?? {
        count: latestRun.element_count,
        length_m: null,
        area_m2: latestRun.total_area_m2,
        volume_m3: latestRun.total_volume_m3,
        mass_kg: null,
      }
    : null;

  return (
    <PageContainer>
      <PageHeader
        icon={Calculator}
        eyebrow={t('qtoPage.eyebrow')}
        title={t('qtoPage.title')}
        description={t('qtoPage.description')}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {/* Left rail — projects + their latest-run status. */}
        <aside className="lg:sticky lg:top-4 lg:w-80 lg:shrink-0">
          <Card className="overflow-hidden">
            <div className="border-b p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('qtoPage.searchProjects')}
                  className="pl-8"
                />
              </div>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {overviewQuery.isLoading ? (
                <ul className="divide-y">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <li key={i} className="h-14 animate-pulse bg-muted/30" />
                  ))}
                </ul>
              ) : overviewQuery.isError ? (
                <p className="p-4 text-sm text-danger">{t('qtoPage.loadFailed')}</p>
              ) : filtered.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">{t('qtoPage.noProjects')}</p>
              ) : (
                <ul className="divide-y">
                  {filtered.map((p) => {
                    const active = p.project_id === selectedId;
                    const hasRun = p.latest_run_id != null;
                    return (
                      <li key={p.project_id}>
                        <button
                          type="button"
                          onClick={() => handleSelectProject(p.project_id)}
                          className={cn(
                            'flex w-full flex-col items-start gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
                            active && 'bg-primary/10 hover:bg-primary/10',
                          )}
                        >
                          <span
                            className={cn(
                              'line-clamp-1 text-sm font-medium',
                              active && 'text-primary',
                            )}
                          >
                            {p.display_title || p.project_name}
                          </span>
                          {hasRun ? (
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                              <SourceBadge source={p.latest_run_source} />
                              <span>{formatDate(p.latest_run_at as string)}</span>
                              {p.latest_file_name && (
                                <span className="max-w-[9rem] truncate">{p.latest_file_name}</span>
                              )}
                              {p.run_count > 1 && (
                                <span>
                                  · {p.run_count} {t('qtoPage.runsLabel')}
                                </span>
                              )}
                            </span>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-dashed text-[11px] text-muted-foreground"
                            >
                              {t('qtoPage.noRunBadge')}
                            </Badge>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </aside>

        {/* Main pane */}
        <div className="min-w-0 flex-1">
          {selectedId == null ? (
            <EmptyPane title={t('qtoPage.emptyTitle')} description={t('qtoPage.emptyDescription')} />
          ) : runsQuery.isLoading ? (
            <div className="h-60 animate-pulse rounded-lg bg-muted/40" />
          ) : runsQuery.isError ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-danger">
                {t('qtoPage.loadRunFailed')}
              </CardContent>
            </Card>
          ) : runs.length === 0 ? (
            <EmptyPane
              title={t('qtoPage.noRunsTitle')}
              description={t('qtoPage.noRunsDescription')}
            />
          ) : (
            <KeepAliveTabs value={tab} onValueChange={(v) => setTab(v as QtoTab)}>
              <TabsList>
                <TabsTrigger value="dashboard">{t('qtoPage.tabDashboard')}</TabsTrigger>
                <TabsTrigger value="overview">{t('qtoPage.tabOverview')}</TabsTrigger>
                <TabsTrigger value="pivot">{t('qtoPage.tabPivot')}</TabsTrigger>
                <TabsTrigger value="history">{t('qtoPage.tabHistory')}</TabsTrigger>
              </TabsList>

              {/* Самбар — олон файлын нэгтгэсэн dashboard */}
              <KeepAliveTabsPanel value="dashboard" className="mt-4">
                <DashboardTab
                  key={selectedId}
                  projectId={selectedId}
                  allowed={allowed}
                  isAdmin={!!isAdmin}
                  projectLabel={
                    overview.find((p) => p.project_id === selectedId)?.display_title ||
                    overview.find((p) => p.project_id === selectedId)?.project_name ||
                    String(selectedId)
                  }
                  onDrill={handleDrill}
                />
              </KeepAliveTabsPanel>

              {/* Тойм — the latest run */}
              <KeepAliveTabsPanel value="overview" className="mt-4 space-y-4">
                {latestRun && (
                  <>
                    <Card id="sec-qto-latest" className="scroll-mt-24">
                      <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                              {t('qtoPage.latestRun')}
                              <SourceBadge source={latestRun.source} />
                            </CardTitle>
                            <CardDescription className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                              <span className="max-w-[18rem] truncate">
                                {latestRun.file_name ?? '—'}
                              </span>
                              <span>{formatDateTime(latestRun.created_at)}</span>
                              {latestRun.created_by_name && (
                                <span>{latestRun.created_by_name}</span>
                              )}
                              {latestSummary?.revit_version && (
                                <span>
                                  {t('qtoPage.revitVersion')}: {latestSummary.revit_version}
                                </span>
                              )}
                            </CardDescription>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!latestIsRevit || exporting}
                            title={!latestIsRevit ? t('qtoPage.exportLegacyDisabled') : undefined}
                            onClick={() => void handleExport()}
                          >
                            {exporting ? (
                              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            ) : (
                              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                            )}
                            {t('qtoPage.exportXlsx')}
                          </Button>
                        </div>
                      </CardHeader>
                    </Card>

                    {latestDetailQuery.isLoading ? (
                      <div className="h-24 animate-pulse rounded-lg bg-muted/40" />
                    ) : (
                      overviewTotals && <TotalsCards totals={overviewTotals} />
                    )}

                    {latestSummary && latestSummary.by_category.length > 0 && (
                      <Card id="sec-qto-category" className="scroll-mt-24">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base">
                            {t('qtoPage.byCategoryTitle')}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="max-h-96 overflow-y-auto overflow-x-hidden">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>{t('qtoPage.colCategory')}</TableHead>
                                  <TableHead className="text-right">
                                    {t('qtoPage.colCount')}
                                  </TableHead>
                                  <TableHead className="text-right">
                                    {t('qtoPage.colVolume')}
                                  </TableHead>
                                  <TableHead className="text-right">
                                    {t('qtoPage.colMass')}
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {latestSummary.by_category.map((c) => (
                                  <TableRow key={c.category}>
                                    <TableCell className="max-w-[18rem] truncate">
                                      {c.category || t('qtoPage.noCategory')}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {fmtNum(c.count, 0)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {fmtNum(c.volume_m3)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {fmtNum(c.mass_kg)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}
              </KeepAliveTabsPanel>

              {/* Ангилал — pivot over the selected (default latest) revit run */}
              <KeepAliveTabsPanel value="pivot" className="mt-4 space-y-4">
                {pivotRun == null ? (
                  <Card>
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">
                      {t('qtoPage.pivotEmpty')}
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex gap-1.5">
                          {(['category', 'material', 'level'] as const).map((a) => (
                            <Button
                              key={a}
                              type="button"
                              size="sm"
                              variant={axis === a ? 'default' : 'outline'}
                              onClick={() => setAxis(a)}
                            >
                              {t(
                                a === 'category'
                                  ? 'qtoPage.axisCategory'
                                  : a === 'material'
                                    ? 'qtoPage.axisMaterial'
                                    : 'qtoPage.axisLevel',
                              )}
                            </Button>
                          ))}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {pivotRun.file_name ?? '—'} · {formatDateTime(pivotRun.created_at)}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {factsQuery.isLoading ? (
                        <div className="space-y-2">
                          {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="h-8 animate-pulse rounded bg-muted/40" />
                          ))}
                        </div>
                      ) : factsQuery.isError ? (
                        <p className="text-sm text-danger">{t('qtoPage.factsLoadFailed')}</p>
                      ) : (
                        <PivotTable
                          facts={factsQuery.data?.facts ?? []}
                          fields={AXIS_FIELDS[axis]}
                        />
                      )}
                    </CardContent>
                  </Card>
                )}
              </KeepAliveTabsPanel>

              {/* Түүх — all runs + diff */}
              <KeepAliveTabsPanel value="history" className="mt-4 space-y-4">
                <Card>
                  <CardContent className="pt-4">
                    <RunHistory
                      runs={runs}
                      selectedRunId={selectedRunId}
                      onSelect={(id) => setSelectedRunId(id)}
                      isAdmin={!!isAdmin}
                      currentUserId={user!.id}
                      onDelete={(id) => void handleDeleteRun(id)}
                    />
                  </CardContent>
                </Card>

                {legacySelected &&
                  (legacyDetailQuery.isLoading ? (
                    <div className="h-40 animate-pulse rounded-lg bg-muted/40" />
                  ) : legacyDetailQuery.data ? (
                    <LegacyRunCard run={legacyDetailQuery.data.run} />
                  ) : legacyDetailQuery.isError ? (
                    <p className="text-sm text-danger">{t('qtoPage.loadRunFailed')}</p>
                  ) : null)}

                <RunDiff revitRuns={revitRuns} />
              </KeepAliveTabsPanel>
            </KeepAliveTabs>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

function EmptyPane({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Boxes className="h-7 w-7" />
        </div>
        <h3 className="mb-1 text-base font-semibold">{title}</h3>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
