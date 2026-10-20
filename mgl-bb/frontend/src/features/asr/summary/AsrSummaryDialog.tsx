import { useState } from 'react';
import { Eye, FileStack, Loader2 } from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { todayUB } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { asrProjectName } from '@/features/projects/asr/asrProjectName';
import { ASR_REPORT_TYPES, REPORT_TYPE_KEY, type AsrReportType } from '@/features/projects/asr/types';
import {
  ASR_RANGE_PRESETS,
  matchPreset,
  normalizeRange,
  presetRange,
  type AsrRange,
  type AsrRangePreset,
} from '../lib/asrRange';
import { rangeTitle } from '../board/rangeText';
import { AsrSummaryExportButtons } from './AsrSummaryExportButtons';
import {
  defaultSummaryRange,
  summaryQueryString,
  type AsrSummaryParams,
  type AsrSummaryResponse,
  type AsrSummaryStatusFilter,
} from './summaryTypes';

const PRESET_KEY: Record<AsrRangePreset, string> = {
  all: 'asr.board.preset.all',
  thisMonth: 'asr.board.preset.thisMonth',
  lastMonth: 'asr.board.preset.lastMonth',
  last3Months: 'asr.board.preset.last3Months',
  thisYear: 'asr.board.preset.thisYear',
};

const ALL = '__all__';

/**
 * «Нэгтгэл тайлан» товч + цонх — ЗӨВХӨН админ (дуудагч шалгана; сервер ч 403).
 *
 *   • ЗХ самбар  — `projects` дамжуулна: «Бүх төсөл» эсвэл нэг төсөл сонгоно;
 *   • төслийн самбар — `lockedProject` дамжуулна: тэр төсөл тогтмол, хугацаа /
 *     төрөл / төлөв нь самбарын одоогийн шүүлтээс эхэлнэ (`initial`).
 */
export function AsrSummaryButton({
  initial,
  projects,
  lockedProject,
  className,
  size = 'default',
}: {
  initial?: Partial<AsrSummaryParams>;
  projects?: { id: number; name: string }[];
  /** Нэр өгөөгүй бол серверийн хариунаас (`project.name`). */
  lockedProject?: { id: number; name?: string | null };
  className?: string;
  size?: 'default' | 'sm';
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        className={cn('gap-2', className)}
        onClick={() => setOpen(true)}
        data-testid="asr-summary-open"
      >
        <FileStack className="h-4 w-4" />
        {t('asr.summary.button')}
      </Button>
      {open && (
        <AsrSummaryDialog
          open={open}
          onOpenChange={setOpen}
          initial={initial}
          projects={projects}
          lockedProject={lockedProject}
        />
      )}
    </>
  );
}

function AsrSummaryDialog({
  open,
  onOpenChange,
  initial,
  projects,
  lockedProject,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Partial<AsrSummaryParams>;
  projects?: { id: number; name: string }[];
  lockedProject?: { id: number; name?: string | null };
}) {
  const { t } = useLanguage();
  const today = todayUB();

  // Цонх нээгдэх бүрт шинээр mount хийгдэнэ (`open &&`) — `initial` нэг л удаа уншигдана.
  const [params, setParams] = useState<AsrSummaryParams>(() => {
    const range =
      initial && ('from' in initial || 'to' in initial)
        ? normalizeRange(initial.from ?? null, initial.to ?? null)
        : defaultSummaryRange(today);
    return {
      ...range,
      projectId: lockedProject?.id ?? initial?.projectId ?? null,
      reportType: initial?.reportType ?? null,
      status: initial?.status ?? 'counted',
    };
  });
  const set = (patch: Partial<AsrSummaryParams>) => setParams((p) => ({ ...p, ...patch }));
  const setRange = (r: AsrRange) => set({ from: r.from, to: r.to });

  const qs = summaryQueryString(params);
  const preview = useApiQuery<AsrSummaryResponse>(
    ['asr', 'summary', qs],
    `/author-supervision/summary${qs ? `?${qs}` : ''}`,
    { enabled: open, staleTime: 30_000 },
  );
  const data = preview.data;
  const activePreset = matchPreset({ from: params.from, to: params.to }, today);

  const openPrint = () => {
    window.open(`/app/asr/summary/print${qs ? `?${qs}` : ''}`, '_blank');
  };

  const sortedProjects = [...(projects ?? [])].sort((a, b) =>
    asrProjectName(a.name).localeCompare(asrProjectName(b.name), 'mn'),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" data-testid="asr-summary-dialog">
        <DialogHeader>
          <DialogTitle>{t('asr.summary.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('asr.summary.dialogHint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label>{t('asr.summary.period')}</Label>
              <span className="truncate text-sm font-medium" data-testid="asr-summary-range-title">
                {rangeTitle({ from: params.from, to: params.to }, t)}
              </span>
            </div>
            <div role="radiogroup" aria-label={t('asr.summary.period')} className="flex flex-wrap gap-1.5">
              {ASR_RANGE_PRESETS.map((p) => {
                const on = activePreset === p;
                return (
                  <Button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    variant="outline"
                    size="sm"
                    data-testid={`asr-summary-preset-${p}`}
                    onClick={() => setRange(presetRange(p, today))}
                    className={cn(
                      'rounded-full text-xs font-normal',
                      on
                        ? 'border-primary bg-primary/10 font-medium text-primary hover:bg-primary/15 hover:text-primary'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t(PRESET_KEY[p])}
                  </Button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="asr-summary-from" className="text-xs text-muted-foreground">
                  {t('asr.board.from')}
                </Label>
                <Input
                  id="asr-summary-from"
                  type="date"
                  value={params.from ?? ''}
                  max={params.to ?? undefined}
                  onChange={(e) => setRange(normalizeRange(e.target.value || null, params.to))}
                  className="h-9 tabular-nums"
                  data-testid="asr-summary-from"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="asr-summary-to" className="text-xs text-muted-foreground">
                  {t('asr.board.to')}
                </Label>
                <Input
                  id="asr-summary-to"
                  type="date"
                  value={params.to ?? ''}
                  min={params.from ?? undefined}
                  onChange={(e) => setRange(normalizeRange(params.from, e.target.value || null))}
                  className="h-9 tabular-nums"
                  data-testid="asr-summary-to"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-3">
              <Label>{t('asr.summary.project')}</Label>
              {lockedProject ? (
                <p className="truncate rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="asr-summary-locked-project">
                  {asrProjectName(lockedProject.name ?? data?.project?.name ?? '') || '…'}
                </p>
              ) : (
                <Select
                  value={params.projectId != null ? String(params.projectId) : ALL}
                  onValueChange={(v) => set({ projectId: v === ALL ? null : Number(v) })}
                >
                  <SelectTrigger className="h-9 w-full text-sm" data-testid="asr-summary-project">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('asr.summary.allProjects')}</SelectItem>
                    {sortedProjects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {asrProjectName(p.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>{t('asr.summary.type')}</Label>
              <Select
                value={params.reportType ?? ALL}
                onValueChange={(v) => set({ reportType: v === ALL ? null : (v as AsrReportType) })}
              >
                <SelectTrigger className="h-9 w-full text-sm" data-testid="asr-summary-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('asr.summary.allTypes')}</SelectItem>
                  {ASR_REPORT_TYPES.map((tp) => (
                    <SelectItem key={tp} value={tp}>
                      {t(REPORT_TYPE_KEY[tp])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t('asr.summary.status')}</Label>
              <Select
                value={params.status}
                onValueChange={(v) => set({ status: v as AsrSummaryStatusFilter })}
              >
                <SelectTrigger className="h-9 w-full text-sm" data-testid="asr-summary-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="counted">{t('asr.summary.statusCounted')}</SelectItem>
                  <SelectItem value="approved">{t('asr.summary.statusApproved')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div
            className="flex min-h-10 items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"
            aria-live="polite"
            data-testid="asr-summary-preview"
          >
            {preview.isFetching && !data ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">{t('asr.summary.previewLoading')}</span>
              </>
            ) : preview.isError ? (
              <span className="text-destructive">{t('asr.summary.loadFailed')}</span>
            ) : data && data.entries.length === 0 ? (
              <span className="text-muted-foreground">{t('asr.summary.previewEmpty')}</span>
            ) : data ? (
              <>
                {preview.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                <span className="tabular-nums">
                  {t('asr.summary.previewCount', {
                    reports: data.totals.reports,
                    visits: data.totals.site_visits,
                    projects: data.totals.projects,
                    people: data.totals.people,
                  })}
                </span>
              </>
            ) : null}
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <AsrSummaryExportButtons params={params} data={data} className="flex flex-wrap gap-2" />
          <Button
            type="button"
            className="gap-2"
            disabled={!data || data.entries.length === 0}
            onClick={openPrint}
            data-testid="asr-summary-view"
          >
            <Eye className="h-4 w-4" />
            {t('asr.summary.view')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
