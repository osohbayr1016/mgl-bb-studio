import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Printer,
  Save,
  BarChart3,
  CheckCircle2,
  CircleDashed,
  Loader2,
  Download,
  Pencil,
} from 'lucide-react';
import { apiFetch, MEDIA_BASE_URL } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { AccordionForm } from '@/features/projects/team-reports/AccordionForm';
import { applyTemplateOverrides } from '@/features/projects/team-reports/resolveTemplate';
import {
  DrawingListContext,
  TEAM_DRAWING_ITEMS_KEY,
  appendDrawingItemsToSections,
  groupItemsByTeam,
  makeDrawingRowsResolver,
  type TeamDrawingItemsResponse,
} from '@/features/projects/team-reports/drawingList';
import type { TeamTemplateOverridesResponse } from '@/features/report-templates/types/teamTemplateOverrides';
import { TeamFormTemplateEditor } from '@/features/projects/team-reports/TeamFormTemplateEditor';
import { useAuth } from '@/shared/context/AuthContext';
import { StatusQuestionsPanel } from '@/features/projects/team-reports/StatusQuestionsPanel';
import {
  StatusQuestionsDocument,
  STATUS_DOC_STYLES,
} from '@/features/projects/team-reports/StatusQuestionsDocument';
import {
  TeamComponentStatsPanel,
  TEAM_STATS_DOC_STYLES,
} from '@/features/projects/team-reports/TeamComponentStatsPanel';
import {
  ProjectCorrespondencePanel,
  PROJECT_CORRESPONDENCE_DOC_STYLES,
} from '@/features/projects/team-reports/ProjectCorrespondencePanel';
import {
  NormDocument,
  NORM_DOC_STYLES,
} from '@/features/projects/team-reports/norm/NormDocument';
import {
  ProjectSectionDocument,
  PROJECT_SECTION_DOC_STYLES,
} from '@/features/projects/team-reports/project-sections/ProjectSectionDocument';
import { GENERAL_SECTIONS } from '@/features/projects/team-reports/project-sections/generalTemplate';
import { ROOMS_SECTIONS } from '@/features/projects/team-reports/project-sections/roomsTemplate';
import { FIRE_SECTIONS } from '@/features/projects/team-reports/project-sections/fireTemplate';
import { teamChipClass } from '@/shared/lib/team-colors';
import { cn } from '@/shared/lib/utils';
import type { SectionDef, TeamReportResource } from '@/features/projects/team-reports/types';

/* =============================================================
 * TeamReportShell — modern shared chrome for every team panel.
 * -------------------------------------------------------------
 * Owns the entire load/save/preview lifecycle so each team's
 * <FooPanel> file becomes a 5-line wrapper that just passes in
 * its TEAM_CODE, label, sections, document renderer, and
 * document styles.  Guarantees identical UX + visual across all
 * 7 disciplines (BA's variant gate is handled separately via
 * the optional `headerExtras` slot).
 *
 * Design language:
 *   - Single sticky hero card at the top: team-color accent bar
 *     + team chip + discipline name + save-state pill + actions.
 *   - Accordion form body, full width.
 *   - Preview is an inline expandable card under the form (toggled
 *     by the eye button) so users can compare form ↔ output in
 *     one scroll.
 *
 * `building_type` is left null by default — BA's BaPanel uses its
 * own bespoke flow and doesn't go through this shell, so the
 * `building_type` column only carries meaning for BA today.
 * ============================================================= */

export interface TeamReportShellProps<A> {
  teamCode: string;
  teamLabel: string;
  /** Shown in small text under the team title; useful for
   *  contextual info (e.g. "Цэвэр бохир ус" sub-title or BA's
   *  selected variant). Optional. */
  subtitle?: string;
  /** Form definition + document renderer the shell hands to
   *  AccordionForm and the preview block. */
  sections: SectionDef<A>[];
  renderDocument: (answers: A) => ReactNode;
  /** Inline CSS for the printable document — mounted inside the
   *  preview card via a <style> tag so the document looks the
   *  same as the print route without leaking styles to the rest
   *  of the app. */
  documentStyles: string;
  projectId: number;
  readOnly?: boolean;
  /** Optional slot for team-specific extra controls in the header
   *  (BA uses this for the building-type chip). */
  headerExtras?: ReactNode;
  /** When the shell saves it issues the same `building_type: null`
   *  payload the previous per-team panels did. BA sets this from its
   *  variant picker so the server stores the canonical variant. */
  buildingTypeOnSave?: string | null;
  /** Current variant value used to filter `sections[*].fields[*].variants`
   *  in the AccordionForm.  BA uses this to gate rc-only vs steel-only
   *  fields; other teams leave it null (no variants in their templates). */
  variant?: string | null;
}

interface TeamReportResponse {
  report: TeamReportResource | null;
}

export function TeamReportShell<A>({
  teamCode,
  teamLabel,
  subtitle,
  sections,
  renderDocument,
  documentStyles,
  projectId,
  readOnly = false,
  headerExtras,
  buildingTypeOnSave = null,
  variant = null,
}: TeamReportShellProps<A>) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // requireManager() mirror — admin tier + team seniors can edit
  // per-project form template overrides inline.
  const canEditTemplate =
    !!user &&
    (user.role === 'admin' ||
      user.role === 'senior');
  // Inline edit mode for the per-project, per-team template overrides.
  // When on, the report's form + status block + drawers hide and the
  // template editor takes over the same vertical space.
  const [templateMode, setTemplateMode] = useState(false);
  const queryKey = ['/projects/team-reports', projectId, teamCode] as const;

  const reportQuery = useApiQuery<TeamReportResponse>(
    queryKey,
    `/projects/${projectId}/team-reports/${teamCode}`,
  );

  // Per-project, per-team form template overrides. Admin edits live
  // at /app/admin/team-form-templates; we fold them into the hardcoded
  // SectionDef[] before passing to <AccordionForm>. Cached fully on
  // first read since overrides change rarely.
  const overridesQuery = useApiQuery<TeamTemplateOverridesResponse>(
    ['/projects', projectId, 'team-form-templates', teamCode] as const,
    `/projects/${projectId}/team-form-templates/${teamCode}`,
    { staleTime: Infinity, retry: false, enabled: !!projectId },
  );
  // Зургийн жагсаалтын нийтлэг нэмэлт мөрүүд (бүх төсөлд) — override-ийн
  // дараа drawing-list хэсэгт checkbox болгож залгана. Documents мөн ижил
  // мөрүүдийг DrawingListContext-ээр авдаг тул форм ↔ хэвлэл зөрөхгүй.
  const drawingItemsQuery = useApiQuery<TeamDrawingItemsResponse>(
    TEAM_DRAWING_ITEMS_KEY,
    '/team-drawing-items',
    { staleTime: Infinity, retry: false },
  );
  const drawingItemsByTeam = useMemo(
    () => groupItemsByTeam(drawingItemsQuery.data?.items),
    [drawingItemsQuery.data],
  );
  const resolvedSections = useMemo(
    () =>
      appendDrawingItemsToSections(
        applyTemplateOverrides(sections, overridesQuery.data?.overrides ?? null),
        drawingItemsByTeam[teamCode],
      ),
    [sections, overridesQuery.data, drawingItemsByTeam, teamCode],
  );
  const drawingRowsResolver = useMemo(
    () =>
      makeDrawingRowsResolver(drawingItemsByTeam, {
        [teamCode]: overridesQuery.data?.overrides ?? null,
      }),
    [drawingItemsByTeam, overridesQuery.data, teamCode],
  );

  const [answers, setAnswers] = useState<A>({} as A);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Inline drawer below the form. Only one of the two views is open at a
  // time — toggling either button closes the other so the form area
  // doesn't jump as the user compares views.
  const [viewMode, setViewMode] = useState<'closed' | 'preview' | 'report'>('closed');

  useEffect(() => {
    const r = reportQuery.data?.report;
    if (!r || dirty) return;
    setAnswers((r.answers ?? {}) as A);
  }, [reportQuery.data, dirty]);

  useEffect(() => {
    if (reportQuery.error) {
      toast.error('Тайлбар бичиг ачаалж чадсангүй', reportQuery.error.message);
    }
  }, [reportQuery.error]);

  const onChange = (patch: Partial<A>) => {
    setAnswers((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ report: TeamReportResource; message: string }>(
        `/projects/${projectId}/team-reports/${teamCode}`,
        { method: 'PUT', data: { building_type: buildingTypeOnSave, answers } },
      );
      if (res.report) {
        setAnswers((res.report.answers ?? {}) as A);
      }
      setDirty(false);
      queryClient.setQueryData(queryKey, { report: res.report });
      queryClient.invalidateQueries({ queryKey: ['/projects/team-reports', projectId] });
      toast.success(res.message ?? 'Хадгалагдлаа');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Алдаа гарлаа';
      toast.error('Хадгалж чадсангүй', msg);
    } finally {
      setSaving(false);
    }
  };

  const openPrintView = (mode: 'internal' | 'client' = 'internal') => {
    if (dirty) {
      toast.warn('Эхлээд хадгална уу', 'Хэвлэхээс өмнө өөрчлөлтүүдээ хадгалах шаардлагатай.');
      return;
    }
    const url =
      `/app/projects/${projectId}/team-reports/${teamCode}/print` +
      (mode === 'client' ? '?mode=client' : '');
    window.open(url, '_blank', 'noopener');
  };

  // Client-facing PDF download. Hits the server-side Browser Rendering
  // endpoint which boots headless Chromium against the print page in
  // client mode and streams back the rendered PDF. We pull the result
  // as a Blob so the auth header stays in the request — putting the
  // user's long-lived token in a URL query string would be a leak risk
  // even momentarily. Same dirty-guard as openPrintView; the render
  // would otherwise miss unsaved edits.
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const downloadPdf = async () => {
    if (dirty) {
      toast.warn('Эхлээд хадгална уу', 'PDF татахаас өмнө өөрчлөлтүүдээ хадгалах шаардлагатай.');
      return;
    }
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(
        `${MEDIA_BASE_URL}/api/projects/${projectId}/team-reports/${teamCode}/pdf`,
        {
          method: 'GET',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
        },
      );
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(msg.error ?? `PDF татахад алдаа (${res.status})`);
      }
      const blob = await res.blob();
      // Derive filename from the Content-Disposition header when
      // provided so we honour the backend's naming convention; fall
      // back to a sensible default for older worker builds.
      const cd = res.headers.get('content-disposition') ?? '';
      const m = cd.match(/filename="?([^";]+)"?/i);
      const filename = m?.[1] ?? `${teamCode}_tailan.pdf`;
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'PDF татах боломжгүй боллоо.';
      toast.error('PDF татаж чадсангүй', msg);
    } finally {
      setDownloadingPdf(false);
    }
  };

  // Computed save-state pill content. The 3 states are
  // hand-distinguished here rather than via an enum — the visual
  // language for "dirty" is amber, "saving" blue with spinner, and
  // "clean" emerald with a check.
  const stateChip = saving ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-600 dark:text-blue-400">
      <Loader2 className="w-3 h-3 animate-spin" />
      Хадгалж байна
    </span>
  ) : dirty ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
      <CircleDashed className="w-3 h-3" />
      Засваргүй
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="w-3 h-3" />
      Хадгалагдсан
    </span>
  );

  return (
    <DrawingListContext.Provider value={drawingRowsResolver}>
    <div className="space-y-4">
      {/* Hero card — team color accent + chip + title + actions.  No
          extra border on the bottom so it visually flows into the
          accordion form below. */}
      <Card className="overflow-hidden border-border/40 shadow-sm">
        {/* Soft team-color tint band so each discipline reads at a
            glance without the heavy border-everywhere look the old
            panels had. */}
        <div className={cn('h-1 w-full', teamAccentBg(teamCode))} />
        <CardContent className="py-4 sm:py-5">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Badge
                variant="outline"
                className={cn(teamChipClass(teamCode), 'text-xs font-semibold px-2.5 py-1')}
              >
                {teamCode}
              </Badge>
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-tight truncate">{teamLabel}</h2>
                {subtitle && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{subtitle}</p>
                )}
              </div>
              {headerExtras}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {!readOnly && stateChip}
              <Button
                type="button"
                size="sm"
                variant={viewMode === 'report' ? 'default' : 'ghost'}
                onClick={() => setViewMode((v) => (v === 'report' ? 'closed' : 'report'))}
              >
                <BarChart3 className="w-4 h-4 mr-1.5" />
                Тайлан
              </Button>
              {canEditTemplate && (
                <Button
                  type="button"
                  size="sm"
                  variant={templateMode ? 'default' : 'outline'}
                  onClick={() => setTemplateMode((v) => !v)}
                  title="Энэ төслийн энэ багт хамаарах талбарын нэр, сонголтыг засах"
                >
                  <Pencil className="w-4 h-4 mr-1.5" /> Загвар засах
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => openPrintView('internal')}
              >
                <Printer className="w-4 h-4 mr-1.5" /> Тайлан харах
              </Button>
              {!readOnly && (
                <Button type="button" size="sm" onClick={save} disabled={saving || !dirty}>
                  <Save className="w-4 h-4 mr-1.5" />
                  {saving ? 'Хадгалж байна…' : 'Хадгалах'}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Template-edit mode swaps the status block + accordion form for
          the per-project, per-team template editor in the same vertical
          space. Toggle via the "Загвар засах" button in the header. */}
      {templateMode ? (
        <Card className="border-border/40 shadow-sm overflow-hidden">
          <div className={cn('h-0.5 w-full', teamAccentBg(teamCode))} />
          <CardContent className="py-4">
            <TeamFormTemplateEditor
              projectId={projectId}
              teamCode={teamCode}
              // The editor reads structural fields only (id/key/kind/
              // options/etc.); the A generic just types the answers blob.
              sections={
                sections as unknown as readonly import('@/features/projects/team-reports/types').SectionDef<
                  Record<string, unknown>
                >[]
              }
              canManage={canEditTemplate}
              heading={
                <>
                  <h3 className="text-sm font-semibold">
                    {teamCode} {teamLabel} · Загвар засах
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Зөвхөн харагдах текст л өөрчлөгдөнө. Талбарын стандарт түлхүүр, төрөл нь хариулт
                    болон хэвлэлд нөлөөлөхгүйн тулд хадгалагдсан хэвээр үлдэнэ.
                  </p>
                </>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Universal status-questions block — same six questions for
              every discipline. Lives above the team's own accordion form
              so the discipline-agnostic status read is always the first
              thing both the editor and the printed document show. */}
          <StatusQuestionsPanel
            teamCode={teamCode}
            answers={answers as unknown as Record<string, unknown>}
            onChange={(patch) => onChange(patch as unknown as Partial<A>)}
            readOnly={readOnly}
          />

          <AccordionForm<A>
            sections={resolvedSections}
            answers={answers}
            variant={variant}
            readOnly={readOnly}
            onChange={onChange}
          />
        </>
      )}

      {!templateMode && viewMode === 'preview' && (
        <Card className="border-border/40 shadow-sm overflow-hidden">
          <div className={cn('h-0.5 w-full', teamAccentBg(teamCode))} />
          <CardContent className="py-4">
            <DocumentPreview styles={STATUS_DOC_STYLES + documentStyles}>
              <StatusQuestionsDocument answers={answers as unknown as Record<string, unknown>} />
              <div style={{ height: '24px' }} />
              {renderDocument(answers)}
            </DocumentPreview>
          </CardContent>
        </Card>
      )}

      {!templateMode && viewMode === 'report' && (
        <Card className="border-border/40 shadow-sm overflow-hidden">
          {/* Тайлан mode uses the project-wide brand navy (#0F243E)
              instead of the per-team accent — visual cue that this is
              the client-facing deliverable, not the editor preview. */}
          <div style={{ backgroundColor: '#0F243E', height: '4px' }} />
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-end">
              <Button
                type="button"
                size="sm"
                onClick={downloadPdf}
                disabled={downloadingPdf}
                title="Тайланг PDF хэлбэрээр татах"
              >
                {downloadingPdf ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 mr-1.5" />
                )}
                {downloadingPdf ? 'Татаж байна…' : 'PDF татах'}
              </Button>
            </div>
            <DocumentPreview
              styles={
                STATUS_DOC_STYLES +
                TEAM_STATS_DOC_STYLES +
                PROJECT_CORRESPONDENCE_DOC_STYLES +
                NORM_DOC_STYLES +
                PROJECT_SECTION_DOC_STYLES +
                documentStyles
              }
            >
              {/* Order matches the printed PDF so the inline preview is
                  a faithful render of what gets downloaded. */}
              {renderDocument(answers)}
              <div style={{ height: '24px' }} />
              <ProjectSectionDocument
                projectId={projectId}
                code="GENERAL"
                docTitle="ҮНДЭСЛЭЛ, БАЙРШИЛ, АНГИЛАЛ"
                sections={GENERAL_SECTIONS}
              />
              <div style={{ height: '24px' }} />
              <NormDocument projectId={projectId} />
              <div style={{ height: '24px' }} />
              <ProjectSectionDocument
                projectId={projectId}
                code="ROOMS"
                docTitle="ТЕХНИКИЙН ӨРӨӨ БА НӨӨЦ ТЭЖЭЭЛ"
                sections={ROOMS_SECTIONS}
              />
              <div style={{ height: '24px' }} />
              <ProjectSectionDocument
                projectId={projectId}
                code="FIRE"
                docTitle="ГАЛЫН АЮУЛГҮЙ БАЙДАЛ"
                sections={FIRE_SECTIONS}
              />
              <div style={{ height: '24px' }} />
              <TeamComponentStatsPanel projectId={projectId} teamCode={teamCode} />
              <div style={{ height: '24px' }} />
              <StatusQuestionsDocument
                answers={answers as unknown as Record<string, unknown>}
                mode="client"
              />
              <div style={{ height: '24px' }} />
              <ProjectCorrespondencePanel projectId={projectId} />
            </DocumentPreview>
          </CardContent>
        </Card>
      )}
    </div>
    </DrawingListContext.Provider>
  );
}

/** Renders the printable document inside a white card. The CSS
 *  passed in is the team's `XXX_REPORT_STYLES` so the preview
 *  matches the print route exactly. */
function DocumentPreview({ styles, children }: { styles: string; children: ReactNode }) {
  const styleTag = useMemo(() => <style dangerouslySetInnerHTML={{ __html: styles }} />, [styles]);
  return (
    <div className="rounded-md bg-white text-black p-6 max-h-[70vh] overflow-y-auto">
      {styleTag}
      {children}
    </div>
  );
}

/** Soft 1px accent strip color per team — mirrors `teamChipClass`
 *  ring colors but as a background. Falls back to `bg-primary` when
 *  the team code isn't in the palette. */
function teamAccentBg(code: string): string {
  const m: Record<string, string> = {
    BA: 'bg-sky-500/60',
    BB: 'bg-amber-500/60',
    HAS: 'bg-cyan-500/60',
    TSBU: 'bg-teal-500/60',
    TSAH: 'bg-yellow-500/60',
    HD: 'bg-purple-500/60',
    AU: 'bg-pink-500/60',
    EZ: 'bg-lime-500/60',
    IZ: 'bg-rose-500/60',
    GT: 'bg-emerald-500/60',
  };
  return m[code] ?? 'bg-primary/60';
}
