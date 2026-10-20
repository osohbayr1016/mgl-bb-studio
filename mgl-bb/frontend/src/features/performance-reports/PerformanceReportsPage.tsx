import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  FileText,
  Download,
  ExternalLink,
  CheckCircle2,
  Trash2,
  Loader2,
  Send,
} from 'lucide-react';
import { apiFetch, apiFetchBlob, downloadPdf } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { useApiQuery } from '@/shared/api/useApi';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { useAuth } from '@/shared/context/AuthContext';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/dialog';
import type {
  PerformanceReport,
  PerformanceReportListResponse,
  PerformanceReportResponse,
} from '@/features/performance-reports/types/performanceReport';
import { formatPeriodRange } from '@/features/performance-reports/lib/formatPeriod';
import type { ReportTemplateListResponse } from '@/features/report-templates/types/reportTemplate';

/* =============================================================
 * Гүйцэтгэлийн тайлан — list + draft editor for one project.
 * -------------------------------------------------------------
 * One card per issued/draft report.  Admin tier can create a new
 * draft, edit its period/meetings/notes, then "Гарга" to lock
 * and snapshot per-team progress numbers into the row.
 * ============================================================= */

const ADMIN_TIER = new Set(['admin']);

export default function PerformanceReportsPage() {
  const { t } = useLanguage();
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const { user } = useAuth();
  const canManage = !!user && ADMIN_TIER.has(user.role);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const queryKey = ['/projects', projectId, 'performance-reports'] as const;
  const listQuery = useApiQuery<PerformanceReportListResponse>(
    queryKey,
    `/projects/${projectId}/performance-reports`,
    { enabled: Number.isFinite(projectId) },
  );

  const projectQuery = useApiQuery<{ project: { name: string } }>(
    ['/projects', projectId, 'meta'] as const,
    `/projects/${projectId}`,
    { enabled: Number.isFinite(projectId) },
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const reports = listQuery.data?.reports ?? [];

  const templatesQuery = useApiQuery<ReportTemplateListResponse>(
    ['/report-templates'],
    '/report-templates',
    { retry: false },
  );
  const templates = templatesQuery.data?.templates ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const handleCreate = async (templateId: number | null) => {
    setCreating(true);
    try {
      const res = await apiFetch<PerformanceReportResponse>(
        `/projects/${projectId}/performance-reports`,
        {
          method: 'POST',
          data: templateId !== null ? { template_id: templateId } : {},
        },
      );
      await refresh();
      setPickerOpen(false);
      navigate(`/app/projects/${projectId}/performance-reports/${res.report.id}/edit`);
    } catch (e) {
      toast.error(t('performanceReportsPage.createFailed'), e instanceof Error ? e.message : t('common.error'));
    } finally {
      setCreating(false);
    }
  };

  const openCreateDialog = () => setPickerOpen(true);

  return (
    <PageContainer>
      <PageHeader
        backTo={`/app/projects/${projectId}`}
        backLabel={projectQuery.data?.project.name ?? t('performanceReportsPage.project')}
        title={t('performanceReportsPage.title')}
        description={t('performanceReportsPage.description')}
        actions={
          canManage && (
            <Button onClick={openCreateDialog} disabled={creating}>
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> {t('performanceReportsPage.creating')}
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-1.5" /> {t('performanceReportsPage.newReport')}
                </>
              )}
            </Button>
          )
        }
      />

      {listQuery.isLoading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">{t('common.loading')}</span>
        </div>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="w-10 h-10 mx-auto text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">{t('performanceReportsPage.empty')}</p>
            {canManage && (
              <Button className="mt-4" onClick={openCreateDialog} disabled={creating}>
                <Plus className="w-4 h-4 mr-1.5" /> {t('performanceReportsPage.createFirst')}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {reports.map((r) => (
            <ReportRowCard
              key={r.id}
              report={r}
              canManage={canManage}
              projectId={projectId}
              onEdit={() => navigate(`/app/projects/${projectId}/performance-reports/${r.id}/edit`)}
              onChanged={refresh}
            />
          ))}
        </div>
      )}

      <CreateReportDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        templates={templates}
        creating={creating}
        onCreate={handleCreate}
      />
    </PageContainer>
  );
}

/* =============================================================
 * Pick a template (or "default seed") before creating a draft.
 * Pre-selects the firm's default template if one is marked.
 * ============================================================= */
function CreateReportDialog({
  open,
  onClose,
  templates,
  creating,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  templates: import('@/features/report-templates/types/reportTemplate').ReportTemplate[];
  creating: boolean;
  onCreate: (templateId: number | null) => void;
}) {
  const { t } = useLanguage();
  const [picked, setPicked] = useState<number | null>(null);

  // Initialise the selection when the dialog first opens.
  useState(() => {
    const dflt = templates.find((tpl) => tpl.is_default);
    setPicked(dflt ? dflt.id : null);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('performanceReportsPage.createDialogTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2 max-h-[60vh] overflow-y-auto overflow-x-hidden">
          <label className="flex items-start gap-2 px-2 py-2 rounded-md hover:bg-muted/50 cursor-pointer">
            <input
              type="radio"
              className="mt-1"
              checked={picked === null}
              onChange={() => setPicked(null)}
            />
            <div className="flex-1">
              <div className="text-sm font-medium">{t('performanceReportsPage.standardOption')}</div>
              <div className="text-xs text-muted-foreground">
                {t('performanceReportsPage.standardOptionDesc')}
              </div>
            </div>
          </label>
          {(() => {
            // Group templates by team_code; firm-wide first, then by team.
            const FIRM_WIDE = '__firm_wide__';
            const groups = new Map<string, typeof templates>();
            for (const tpl of templates) {
              const key = tpl.team_code ?? FIRM_WIDE;
              const arr = groups.get(key) ?? [];
              arr.push(tpl);
              groups.set(key, arr);
            }
            const ordered = Array.from(groups.entries()).sort(([a], [b]) => {
              if (a === FIRM_WIDE) return -1;
              if (b === FIRM_WIDE) return 1;
              return a.localeCompare(b);
            });
            return ordered.map(([group, items]) => (
              <div key={group}>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-2 mb-1 px-2">
                  {group === FIRM_WIDE ? t('performanceReportsPage.firmWideGroup') : group}
                </div>
                {items.map((tpl) => (
                  <label
                    key={tpl.id}
                    className="flex items-start gap-2 px-2 py-2 rounded-md hover:bg-muted/50 cursor-pointer"
                  >
                    <input
                      type="radio"
                      className="mt-1"
                      checked={picked === tpl.id}
                      onChange={() => setPicked(tpl.id)}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium flex items-center gap-1.5">
                        {tpl.name}
                        {tpl.is_default && (
                          <Badge variant="outline" className="text-[10px] py-0">
                            {t('performanceReportsPage.defaultBadge')}
                          </Badge>
                        )}
                      </div>
                      {tpl.description && (
                        <div className="text-xs text-muted-foreground line-clamp-2">
                          {tpl.description}
                        </div>
                      )}
                      <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                        {t('performanceReportsPage.blockCount', { count: tpl.block_count ?? 0 })}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            ));
          })()}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onCreate(picked)} disabled={creating}>
            {creating ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> {t('performanceReportsPage.creating')}
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-1.5" /> {t('common.create')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
 * One row in the list — read-only summary + action buttons.
 * ========================================================== */
function ReportRowCard({
  report,
  canManage,
  projectId,
  onEdit,
  onChanged,
}: {
  report: PerformanceReport;
  canManage: boolean;
  projectId: number;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState<'issue' | 'delete' | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingWord, setDownloadingWord] = useState(false);
  const [downloadingClient, setDownloadingClient] = useState(false);
  const [openingWeb, setOpeningWeb] = useState(false);
  const isIssued = report.status === 'issued';
  const periodLabel = formatPeriodRange(report.period_start, report.period_end, ' — ');

  const handleIssue = async () => {
    if (!(await confirmDialog({ description: t('performanceReportsPage.issueConfirm', { no: report.report_no }), variant: 'default' }))) return;
    setBusy('issue');
    try {
      await apiFetch(`/projects/${projectId}/performance-reports/${report.id}/issue`, {
        method: 'POST',
        data: {},
      });
      toast.success(t('performanceReportsPage.issued'));
      onChanged();
    } catch (e) {
      toast.error(t('performanceReportsPage.issueFailed'), e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!(await confirmDialog({ description: t('performanceReportsPage.deleteConfirm', { no: report.report_no }), variant: 'destructive' }))) return;
    setBusy('delete');
    try {
      await apiFetch(`/projects/${projectId}/performance-reports/${report.id}`, {
        method: 'DELETE',
      });
      toast.success(t('common.deleted'));
      onChanged();
    } catch (e) {
      toast.error(t('common.deleteFailed'), e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadPdf = async () => {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      await downloadPdf(
        `/projects/${projectId}/performance-reports/${report.id}/pdf`,
        `GT_${String(report.report_no).padStart(2, '0')}.pdf`,
      );
    } catch (e) {
      toast.error(t('performanceReportsPage.pdfFailed'), e instanceof Error ? e.message : t('common.error'));
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadWord = async () => {
    if (downloadingWord) return;
    setDownloadingWord(true);
    try {
      await downloadPdf(
        `/projects/${projectId}/performance-reports/${report.id}/docx`,
        `GT_${String(report.report_no).padStart(2, '0')}.docx`,
      );
    } catch (e) {
      toast.error(t('performanceReportsPage.wordFailed'), e instanceof Error ? e.message : t('common.error'));
    } finally {
      setDownloadingWord(false);
    }
  };

  const handleOpenPrint = () => {
    window.open(
      `/reports/project/${projectId}/performance-report/${report.id}/print`,
      '_blank',
      'noopener',
    );
  };

  // Client-facing design-progress report (WeasyPrint): download PDF.
  const handleDownloadClientPdf = async () => {
    if (downloadingClient) return;
    setDownloadingClient(true);
    try {
      await downloadPdf(
        `/projects/${projectId}/performance-reports/${report.id}/client-pdf`,
        `client_${String(report.report_no).padStart(2, '0')}.pdf`,
      );
    } catch (e) {
      toast.error(t('performanceReportsPage.clientReportFailed'), e instanceof Error ? e.message : t('common.error'));
    } finally {
      setDownloadingClient(false);
    }
  };

  // Client report web view: fetch the authed HTML, open it via a blob URL in a
  // new tab (Paged.js paginates on screen). A blob URL keeps the report's own
  // CSS/@page isolated from the SPA.
  const handleOpenClientWeb = async () => {
    if (openingWeb) return;
    setOpeningWeb(true);
    try {
      const blob = await apiFetchBlob(
        `/projects/${projectId}/performance-reports/${report.id}/client-html`,
      );
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      // Revoke after the new tab has had time to load the document.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error(t('performanceReportsPage.clientReportFailed'), e instanceof Error ? e.message : t('common.error'));
    } finally {
      setOpeningWeb(false);
    }
  };

  return (
    <Card>
      <CardContent className="py-4 flex flex-wrap items-center gap-4">
        <Badge variant="outline" className="text-base font-mono px-3 py-1.5">
          №{String(report.report_no).padStart(2, '0')}
        </Badge>
        <div className="min-w-0 flex-1">
          {/* Аль нэг тал нь хоосон бол зураасгүйгээр ганц огноо; хоёулаа
              хоосон бол мөрийг бүхэлд нь алгасана. */}
          {periodLabel && <div className="text-sm font-medium">{periodLabel}</div>}
          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            {isIssued ? (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                {t('performanceReportsPage.issuedOn', { date: report.issued_at?.slice(0, 10) ?? '' })}
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">{t('performanceReportsPage.draft')}</span>
            )}
            {report.team_progress.length > 0 && (
              <span>· {t('performanceReportsPage.teamCount', { count: report.team_progress.length })}</span>
            )}
            {report.status_meetings.length > 0 && (
              <span>· {t('performanceReportsPage.meetingCount', { count: report.status_meetings.length })}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isIssued ? (
            <>
              <Button variant="outline" size="sm" onClick={handleOpenPrint}>
                <ExternalLink className="w-4 h-4 mr-1.5" /> {t('common.view')}
              </Button>
              <Button size="sm" onClick={handleDownloadPdf} disabled={downloadingPdf}>
                {downloadingPdf ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> {t('performanceReportsPage.preparing')}
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-1.5" /> {t('performanceReportsPage.downloadPdf')}
                  </>
                )}
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadWord} disabled={downloadingWord}>
                {downloadingWord ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> {t('performanceReportsPage.preparing')}
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-1.5" /> {t('performanceReportsPage.downloadWord')}
                  </>
                )}
              </Button>
              <Button variant="outline" size="sm" onClick={handleOpenClientWeb} disabled={openingWeb}>
                {openingWeb ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <ExternalLink className="w-4 h-4 mr-1.5" />
                )}
                {t('performanceReportsPage.clientReportWeb')}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleDownloadClientPdf} disabled={downloadingClient}>
                {downloadingClient ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> {t('performanceReportsPage.preparing')}
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-1.5" /> {t('performanceReportsPage.clientReportPdf')}
                  </>
                )}
              </Button>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  disabled={busy === 'delete'}
                  className="text-destructive hover:text-destructive"
                  title={t('common.delete')}
                >
                  {busy === 'delete' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </Button>
              )}
            </>
          ) : (
            canManage && (
              <>
                <Button variant="outline" size="sm" onClick={onEdit}>
                  {t('common.edit')}
                </Button>
                <Button size="sm" onClick={handleIssue} disabled={busy === 'issue'}>
                  {busy === 'issue' ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-1.5" />
                  )}
                  {t('performanceReportsPage.issue')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  disabled={busy === 'delete'}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </>
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
}
