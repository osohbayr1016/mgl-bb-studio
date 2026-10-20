import { useMemo, useState } from 'react';
import { ChevronRight, FileSpreadsheet, Loader2, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { cn } from '@/shared/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { formatDate } from '@/shared/lib/time';

import { exportScheduleXlsx } from '../../lib/exportXlsx';
import { fmtNum } from '../../lib/pivots';
import type { QtoScheduleDetail, QtoScheduleMeta } from '../../lib/types';

/**
 * Ведомость view — Revit-ийн Schedule/Quantities хүснэгтүүд (add-in-ий
 * «Ведомость» товчоор REPLACE семантикаар ирдэг). Категориор бүлэглэсэн
 * жагсаалт; мөр дээр дарахад агуулга нь доороо задарч (lazy fetch), Excel
 * татах товчтой. Toolbar-ийн хайлт нэр/категори дээр шүүнэ.
 */
export function SchedulesView({
  projectId,
  allowed,
  isAdmin,
  query,
}: {
  projectId: number;
  allowed: boolean;
  isAdmin: boolean;
  query: string;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<number | null>(null);
  const [details, setDetails] = useState<Map<number, QtoScheduleDetail>>(new Map());
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [exportingId, setExportingId] = useState<number | null>(null);

  const listQuery = useApiQuery<{ schedules: QtoScheduleMeta[] }>(
    ['/qto/projects', projectId, 'schedules'],
    `/qto/projects/${projectId}/schedules`,
    { enabled: allowed },
  );
  const schedules = useMemo(() => listQuery.data?.schedules ?? [], [listQuery.data]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? schedules.filter(
          (s) =>
            s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q),
        )
      : schedules;
    const byCat = new Map<string, QtoScheduleMeta[]>();
    for (const s of filtered) {
      const key = s.category || t('qtoPage.noCategory');
      const list = byCat.get(key);
      if (list) list.push(s);
      else byCat.set(key, [s]);
    }
    return [...byCat.entries()].map(([category, items]) => ({ category, items }));
  }, [schedules, query, t]);

  const loadDetail = async (id: number): Promise<QtoScheduleDetail | null> => {
    const cached = details.get(id);
    if (cached) return cached;
    setLoadingId(id);
    try {
      const { schedule } = await apiFetch<{ schedule: QtoScheduleDetail }>(
        `/qto/schedules/${id}`,
      );
      setDetails((prev) => new Map(prev).set(id, schedule));
      return schedule;
    } catch {
      toast.error(t('qtoPage.schedulesLoadFailed'));
      return null;
    } finally {
      setLoadingId(null);
    }
  };

  const toggleOpen = async (id: number) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    const detail = await loadDetail(id);
    if (detail) setOpenId(id);
  };

  const handleExport = async (meta: QtoScheduleMeta) => {
    if (exportingId != null) return;
    setExportingId(meta.id);
    try {
      const detail = await loadDetail(meta.id);
      if (!detail) return;
      await exportScheduleXlsx({
        fileName: `${meta.name.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.xlsx`,
        sheetName: meta.name,
        columns: detail.columns,
        rows: detail.rows,
      });
    } catch {
      toast.error(t('qtoPage.exportFailed'));
    } finally {
      setExportingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    const ok = await confirmDialog({
      description: t('qtoPage.scheduleDeleteConfirm'),
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiFetch(`/qto/schedules/${id}`, { method: 'DELETE' });
      toast.success(t('qtoPage.scheduleDeleted'));
      if (openId === id) setOpenId(null);
      await queryClient.invalidateQueries({
        queryKey: ['/qto/projects', projectId, 'schedules'],
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('qtoPage.deleteFailed'));
    }
  };

  if (listQuery.isLoading) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted/40" />;
  }

  if (schedules.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t('qtoPage.schedulesEmpty')}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="py-4">
      <CardContent className="space-y-4 px-4">
        {groups.map((g) => (
          <div key={g.category}>
            <p className="mb-1 font-mono text-label text-muted-foreground">
              {g.category} · {g.items.length}
            </p>
            <div className="divide-y rounded-md border">
              {g.items.map((s) => {
                const isOpen = openId === s.id;
                const detail = details.get(s.id);
                return (
                  <div key={s.id}>
                    <div className="flex items-center gap-2 px-3 py-2 text-sm">
                      <button
                        type="button"
                        onClick={() => void toggleOpen(s.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        {loadingId === s.id ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                        ) : (
                          <ChevronRight
                            className={cn(
                              'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                              isOpen && 'rotate-90',
                            )}
                          />
                        )}
                        <span className="truncate font-medium">{s.name}</span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                          {fmtNum(s.row_count, 0)} {t('qtoPage.schedulesRowsUnit')}
                        </span>
                        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                          · {formatDate(s.created_at)}
                        </span>
                      </button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0"
                        title={t('qtoPage.exportXlsx')}
                        disabled={exportingId != null}
                        onClick={() => void handleExport(s)}
                      >
                        {exportingId === s.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <FileSpreadsheet className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      {isAdmin && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-danger"
                          onClick={() => void handleDelete(s.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    {isOpen && detail && (
                      <div className="max-h-[28rem] overflow-auto border-t bg-muted/20 px-3 py-2">
                        <Table>
                          {detail.columns.length > 0 && (
                            <TableHeader>
                              <TableRow>
                                {detail.columns.map((c, i) => (
                                  <TableHead key={i} className="whitespace-nowrap">
                                    {c}
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                          )}
                          <TableBody>
                            {detail.rows.map((row, ri) => (
                              <TableRow key={ri}>
                                {row.map((cellText, ci) => (
                                  <TableCell key={ci} className="whitespace-nowrap text-xs">
                                    {cellText}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
