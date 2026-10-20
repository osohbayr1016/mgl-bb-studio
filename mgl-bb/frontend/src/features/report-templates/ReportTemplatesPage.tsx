import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus, Star, Trash2, Copy, Save } from 'lucide-react';
import { apiFetch, ApiError } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import {
  BlockListEditor,
  AddBlockButton,
} from '@/features/performance-reports/components/blocks/BlockListEditor';
import { BlockPickerModal } from '@/features/performance-reports/components/blocks/BlockPickerModal';
import { TemplatePreview } from '@/features/performance-reports/components/TemplatePreview';
import {
  BLOCK_DEFAULTS,
  coerceBlock,
  type BlockType,
  type ReportBlockRaw,
} from '@/features/performance-reports/types/performanceReportBlocks';
import type {
  ReportTemplate,
  ReportTemplateListResponse,
  ReportTemplateResponse,
} from '@/features/report-templates/types/reportTemplate';
import type {
  PerformanceReport,
  TeamSnapshotItem,
} from '@/features/performance-reports/types/performanceReport';
import type { Team } from '@/shared/types';
import { DesktopOnlyNotice } from '@/shared/components/DesktopOnlyNotice';

/* =============================================================
 * Тайлангийн загвар — admin page for reusable report templates.
 * -------------------------------------------------------------
 * Two-pane layout (left sidebar of templates, right editor).
 * Sits outside the staff Layout shell so the block editor +
 * picker have the full viewport, just like the landing CMS.
 *
 * The block list editor expects a `PerformanceReport` for its
 * team-narrative / team-stats picker; we feed it a SYNTHETIC
 * report whose `team_progress` is built from the firm-wide
 * `teams` table so admins can drop any team code into a
 * template (not just project-specific ones).
 * ============================================================= */

const ADMIN_TIER = new Set(['admin']);

export default function ReportTemplatesPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = !!user && ADMIN_TIER.has(user.role);

  // Selected team filter. `null` = "Бүх" (every template). 'firm' = firm-wide only.
  // Any other value = filter by that team_code.
  const [teamFilter, setTeamFilter] = useState<string | null>(null);

  const teamsQuery = useApiQuery<{ teams: Team[] }>(['/teams'], '/teams', { retry: false });
  const teams = teamsQuery.data?.teams ?? [];

  const listKey =
    teamFilter == null || teamFilter === 'firm'
      ? ['/report-templates']
      : ['/report-templates', teamFilter];
  const listUrl =
    teamFilter == null || teamFilter === 'firm'
      ? '/report-templates'
      : `/report-templates?team_code=${encodeURIComponent(teamFilter)}`;
  const listQuery = useApiQuery<ReportTemplateListResponse>(
    listKey as unknown as readonly unknown[],
    listUrl,
  );
  const allTemplates = listQuery.data?.templates ?? [];

  // 'firm' filter shows ONLY firm-wide (team_code IS NULL) — the
  // backend doesn't have a separate endpoint for this, so we filter
  // client-side from the unrestricted list.
  const templates = teamFilter === 'firm' ? allTemplates.filter((t) => !t.team_code) : allTemplates;

  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Re-select the first row when the filter changes or the list arrives.
  useEffect(() => {
    if (templates.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId === null || !templates.some((t) => t.id === selectedId)) {
      setSelectedId(templates[0]?.id ?? null);
    }
  }, [templates, selectedId]);

  return (
    <div className="min-h-screen bg-muted/20 flex flex-col">
      <DesktopOnlyNotice feature={t('reportTemplatesPage.title')} />
      <header className="bg-card border-b px-4 py-3 flex items-center gap-3">
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> {t('reportTemplatesPage.home')}
        </Link>
        <h1 className="text-base font-semibold">{t('reportTemplatesPage.title')}</h1>
      </header>
      {/* Team filter tabs */}
      <div className="bg-card/60 border-b px-4 py-2 flex items-center gap-1 overflow-x-auto">
        <TeamFilterTab
          label={t('common.all')}
          active={teamFilter == null}
          onClick={() => setTeamFilter(null)}
        />
        <TeamFilterTab
          label={t('reportTemplatesPage.firmWide')}
          active={teamFilter === 'firm'}
          onClick={() => setTeamFilter('firm')}
        />
        {teams.map((t) => (
          <TeamFilterTab
            key={t.id}
            label={t.code}
            sub={t.name_mn}
            active={teamFilter === t.code}
            onClick={() => setTeamFilter(t.code)}
          />
        ))}
      </div>
      <main className="flex-1 flex overflow-hidden">
        <aside className="w-72 border-r bg-card/60 overflow-y-auto">
          <TemplatesSidebar
            templates={templates}
            selectedId={selectedId}
            canManage={canManage}
            currentTeamCode={teamFilter === 'firm' || teamFilter == null ? null : teamFilter}
            onSelect={setSelectedId}
            onCreated={(id) => {
              queryClient.invalidateQueries({ queryKey: ['/report-templates'] });
              setSelectedId(id);
            }}
            loading={listQuery.isLoading}
          />
        </aside>
        <section className="flex-1 overflow-y-auto">
          {selectedId === null ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              {t('reportTemplatesPage.selectTemplate')}
            </div>
          ) : (
            <TemplateEditor
              templateId={selectedId}
              canManage={canManage}
              teams={teams}
              onDeleted={() => {
                queryClient.invalidateQueries({ queryKey: ['/report-templates'] });
                setSelectedId(null);
              }}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function TeamFilterTab({
  label,
  sub,
  active,
  onClick,
}: {
  label: string;
  sub?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 rounded-md text-xs font-medium border whitespace-nowrap',
        active
          ? 'bg-primary/10 text-primary border-primary/30'
          : 'bg-card text-muted-foreground border-transparent hover:bg-muted/60 hover:text-foreground',
      )}
      title={sub}
    >
      {label}
    </button>
  );
}

/* ============================================================ */

function TemplatesSidebar({
  templates,
  selectedId,
  canManage,
  currentTeamCode,
  onSelect,
  onCreated,
  loading,
}: {
  templates: ReportTemplate[];
  selectedId: number | null;
  canManage: boolean;
  /** When the team filter is one of the team tabs, new templates
   *  default to that team. `null` = firm-wide create. */
  currentTeamCode: string | null;
  onSelect: (id: number) => void;
  onCreated: (id: number) => void;
  loading: boolean;
}) {
  const { t: tr } = useLanguage();
  const [creating, setCreating] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const handleCreate = async () => {
    const name = window.prompt(tr('reportTemplatesPage.templateNamePrompt'));
    if (!name || !name.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch<ReportTemplateResponse>('/report-templates', {
        method: 'POST',
        data: { name: name.trim(), description: '', team_code: currentTeamCode },
      });
      onCreated(res.template.id);
    } catch (e) {
      toast.error(tr('common.createFailed'), e instanceof Error ? e.message : tr('common.error'));
    } finally {
      setCreating(false);
    }
  };

  const handleSeedDefault = async () => {
    setSeeding(true);
    try {
      const res = await apiFetch<ReportTemplateResponse>('/report-templates/seed-default', {
        method: 'POST',
        data: {},
      });
      onCreated(res.template.id);
    } catch (e) {
      toast.error(tr('common.createFailed'), e instanceof Error ? e.message : tr('common.error'));
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="p-3 space-y-2">
      {canManage && (
        <div className="space-y-1.5">
          <Button
            onClick={handleCreate}
            disabled={creating || seeding}
            className="w-full"
            size="sm"
          >
            {creating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> {tr('reportTemplatesPage.creating')}
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5 mr-1.5" /> {tr('reportTemplatesPage.newTemplate')}
              </>
            )}
          </Button>
          <Button
            onClick={handleSeedDefault}
            disabled={creating || seeding}
            variant="outline"
            className="w-full"
            size="sm"
          >
            {seeding ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> {tr('reportTemplatesPage.creating')}
              </>
            ) : (
              tr('reportTemplatesPage.createFromDefault')
            )}
          </Button>
        </div>
      )}
      {loading ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-4 justify-center">
          <Loader2 className="w-3 h-3 animate-spin" /> {tr('reportTemplatesPage.loadingShort')}
        </div>
      ) : templates.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-1 py-4">
          {tr('reportTemplatesPage.emptyList')}
        </p>
      ) : (
        <ul className="space-y-1">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelect(t.id)}
                className={cn(
                  'w-full text-left px-2.5 py-2 rounded-md text-sm transition-colors',
                  selectedId === t.id
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'hover:bg-muted/60 border border-transparent',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate font-medium">{t.name}</span>
                  {t.is_default && (
                    <Star className="w-3.5 h-3.5 fill-yellow-500 text-warning flex-shrink-0" />
                  )}
                </div>
                <div className="text-micro text-muted-foreground tabular-nums flex items-center gap-1.5">
                  <span>{t.block_count ?? 0} {tr('reportTemplatesPage.blocks')}</span>
                  <span className="px-1 rounded bg-muted/60 border text-label ">
                    {t.team_code ?? tr('reportTemplatesPage.firmWide')}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ============================================================ */

function TemplateEditor({
  templateId,
  canManage,
  teams,
  onDeleted,
}: {
  templateId: number;
  canManage: boolean;
  teams: Team[];
  onDeleted: () => void;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const queryKey = ['/report-templates', templateId] as const;
  const templateQuery = useApiQuery<ReportTemplateResponse>(
    queryKey,
    `/report-templates/${templateId}`,
  );
  const brandingQuery = useApiQuery<{ logo_url: string | null }>(
    ['/settings/branding'],
    '/settings/branding',
    { retry: false },
  );

  const template = templateQuery.data?.template ?? null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [teamCode, setTeamCode] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setDescription(template.description ?? '');
      setTeamCode(template.team_code);
      setDirty(false);
    }
  }, [template]);

  const blocks = useMemo(() => (template?.blocks ?? []).map(coerceBlock), [template]);

  // Synthetic report for the block editor's team-narrative / team-stats
  // picker. team_progress reflects the firm-wide team roster so admins
  // can drop any team code into a template.
  const syntheticReport: PerformanceReport = useMemo(() => {
    const teamProgress: TeamSnapshotItem[] = teams.map((t) => ({
      team_id: t.id,
      team_code: t.code,
      team_name_mn: t.name_mn,
      share_percent: 0,
      progress: 0,
      task_count: 0,
    }));
    return {
      id: 0,
      project_id: 0,
      report_no: 0,
      period_start: '',
      period_end: '',
      status: 'draft',
      issued_at: null,
      issued_by_id: null,
      team_progress: teamProgress,
      progress_timeseries: [],
      status_meetings: [],
      summary_text: null,
      workforce: [],
      notes: null,
      client_summary_md: null,
      risks: [],
      next_plan: [],
      created_by_id: null,
      created_at: '',
      updated_at: '',
    };
  }, [teams]);

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const saveMeta = async () => {
    if (!template) return;
    setSaving(true);
    try {
      await apiFetch(`/report-templates/${templateId}`, {
        method: 'PUT',
        data: { name: name.trim(), description, team_code: teamCode },
      });
      setDirty(false);
      await refresh();
      queryClient.invalidateQueries({ queryKey: ['/report-templates'] });
      toast.success(t('common.saved'));
    } catch (e) {
      toast.error(t('common.saveFailed'), e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleDefault = async () => {
    if (!template) return;
    try {
      await apiFetch(`/report-templates/${templateId}`, {
        method: 'PUT',
        data: { is_default: !template.is_default },
      });
      await refresh();
      queryClient.invalidateQueries({ queryKey: ['/report-templates'] });
    } catch (e) {
      toast.error(t('reportTemplatesPage.toggleDefaultFailed'), e instanceof Error ? e.message : t('common.error'));
    }
  };

  const handleClone = async () => {
    if (!template) return;
    try {
      const res = await apiFetch<ReportTemplateResponse>(`/report-templates/${templateId}/clone`, {
        method: 'POST',
        data: {},
      });
      queryClient.invalidateQueries({ queryKey: ['/report-templates'] });
      toast.success(t('reportTemplatesPage.cloned', { name: res.template.name }));
    } catch (e) {
      toast.error(t('reportTemplatesPage.cloneFailed'), e instanceof Error ? e.message : t('common.error'));
    }
  };

  const handleDelete = async () => {
    if (!template) return;
    if (!(await confirmDialog({ description: t('reportTemplatesPage.deleteConfirm', { name: template.name }), variant: 'destructive' }))) return;
    try {
      await apiFetch(`/report-templates/${templateId}`, { method: 'DELETE' });
      onDeleted();
    } catch (e) {
      toast.error(t('common.deleteFailed'), e instanceof Error ? e.message : t('common.error'));
    }
  };

  const handleAddBlock = async (type: BlockType) => {
    try {
      await apiFetch(`/report-templates/${templateId}/blocks`, {
        method: 'POST',
        data: { type, content: BLOCK_DEFAULTS[type] },
      });
      await refresh();
    } catch (e) {
      toast.error(t('reportTemplatesPage.addBlockFailed'), e instanceof Error ? e.message : t('common.error'));
    }
  };

  const handleReorder = async (block_ids: number[]) => {
    queryClient.setQueryData(queryKey, (prev: ReportTemplateResponse | undefined) => {
      if (!prev) return prev;
      const byId = new Map(prev.template.blocks.map((b) => [b.id, b]));
      const reordered = block_ids
        .map((id, i) => {
          const b = byId.get(id);
          return b ? { ...b, position: (i + 1) * 10 } : null;
        })
        .filter((b): b is ReportBlockRaw => b !== null);
      return { ...prev, template: { ...prev.template, blocks: reordered } };
    });
    try {
      await apiFetch(`/report-templates/${templateId}/blocks/reorder`, {
        method: 'PUT',
        data: { block_ids },
      });
      await refresh();
    } catch (e) {
      toast.error(t('reportTemplatesPage.reorderFailed'), e instanceof Error ? e.message : t('common.error'));
      await refresh();
    }
  };

  const handlePatch = async (blockId: number, patch: { content?: unknown; hidden?: boolean }) => {
    try {
      await apiFetch(`/report-templates/${templateId}/blocks/${blockId}`, {
        method: 'PATCH',
        data: patch,
      });
      await refresh();
    } catch (e) {
      toast.error(t('common.saveFailed'), e instanceof Error ? e.message : t('common.error'));
    }
  };

  const handleDeleteBlock = async (blockId: number) => {
    try {
      await apiFetch(`/report-templates/${templateId}/blocks/${blockId}`, {
        method: 'DELETE',
      });
      await refresh();
    } catch (e) {
      toast.error(t('common.deleteFailed'), e instanceof Error ? e.message : t('common.error'));
    }
  };

  if (templateQuery.isLoading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">{t('common.loading')}</span>
      </div>
    );
  }
  if (!template) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-destructive">
        {t('reportTemplatesPage.notFound')}
      </div>
    );
  }

  const logoUrl = brandingQuery.data?.logo_url ?? null;

  return (
    <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="space-y-4 min-w-0">
        <Card>
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold flex-1">{template.name}</h2>
              {canManage && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleDefault}
                    className={template.is_default ? 'border-warning text-warning' : ''}
                  >
                    <Star
                      className={cn(
                        'w-4 h-4 mr-1.5',
                        template.is_default && 'fill-yellow-500 text-warning',
                      )}
                    />
                    {template.is_default ? t('reportTemplatesPage.default') : t('reportTemplatesPage.makeDefault')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleClone}>
                    <Copy className="w-4 h-4 mr-1.5" /> {t('reportTemplatesPage.clone')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDelete}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4 mr-1.5" /> {t('common.delete')}
                  </Button>
                </>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <Label htmlFor="tmpl-name">{t('common.name')}</Label>
                <Input
                  id="tmpl-name"
                  value={name}
                  disabled={!canManage}
                  onChange={(e) => {
                    setName(e.target.value);
                    setDirty(true);
                  }}
                />
              </div>
              <div>
                <Label htmlFor="tmpl-team">{t('reportTemplatesPage.team')}</Label>
                <select
                  id="tmpl-team"
                  disabled={!canManage}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={teamCode ?? ''}
                  onChange={(e) => {
                    setTeamCode(e.target.value || null);
                    setDirty(true);
                  }}
                >
                  <option value="">{t('reportTemplatesPage.firmWideTemplate')}</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.code}>
                      {t.code} — {t.name_mn}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="tmpl-desc">{t('common.description')}</Label>
                <Textarea
                  id="tmpl-desc"
                  rows={2}
                  value={description}
                  disabled={!canManage}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setDirty(true);
                  }}
                />
              </div>
              {canManage && (
                <div>
                  <Button size="sm" onClick={saveMeta} disabled={!dirty || saving}>
                    {saving ? (
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-1.5" />
                    )}
                    {t('common.save')}
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t('reportTemplatesPage.blockList')}</h2>
              {canManage && <AddBlockButton onClick={() => setPickerOpen(true)} />}
            </div>
            <BlockListEditor
              blocks={blocks}
              report={syntheticReport}
              readOnly={!canManage}
              onReorder={handleReorder}
              onPatch={handlePatch}
              onDelete={handleDeleteBlock}
            />
          </CardContent>
        </Card>
      </div>

      {/* Live preview pane — sticky right-side column. Renders the
          template's blocks against stub project/passport data so all
          block types display something useful even with no project. */}
      <div className="lg:sticky lg:top-4 lg:self-start min-w-0">
        <Card className="overflow-hidden">
          <div className="px-4 py-2 border-b bg-muted/30 text-label text-muted-foreground flex items-center justify-between">
            <span>{t('reportTemplatesPage.preview')}</span>
            <span className="text-muted-subtle normal-case tracking-normal">
              {blocks.length} {t('reportTemplatesPage.blocks')}
            </span>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 180px)' }}>
            <TemplatePreview blocks={blocks} teams={teams} logoUrl={logoUrl} />
          </div>
        </Card>
      </div>

      <BlockPickerModal
        open={pickerOpen}
        blocks={blocks}
        onPick={handleAddBlock}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
