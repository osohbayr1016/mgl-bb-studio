import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FileEdit,
  FolderKanban,
  Gauge,
  Hammer,
  Loader2,
  Plus,
  Trash2,
  Users,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError, mediaUrl } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { formatDateTime } from '@/shared/lib/time';
import { formatDisplayName } from '@/shared/lib/formatting';
import { teamChipClass } from '@/shared/lib/team-colors';
import { isProjectCategory } from '@/shared/lib/project-categories';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Input } from '@/ui/input';
import { Switch } from '@/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import {
  REPAIR_PROJECTS_KEY,
  createRepairProject,
  deleteRepairProject,
  patchRepairProject,
  useRepairProjectEntries,
  useRepairProjectReport,
  useRepairProjectReports,
} from '../api';
import type { RepairProjectEntryRow, RepairProjectPersonRow, RepairProjectReportRow } from '../types';
import { fmtHours, fmtInt, fmtPts } from '../lib/format';

/** Явц (олгосон хувийн нийлбэр, 2026-09-29) — `fmtPts`-ийн 3 орны нарийвчлал
 *  хэрэггүй; жижиг утга ч харагдахын тулд 1 орон хүртэл.  100-д ТАСЛАХГҮЙ —
 *  засварын төсөл 100%-аас давж болно. */
function fmtProgress(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = Math.max(0, n);
  return `${(Math.round(v * 10) / 10).toLocaleString('mn-MN', { maximumFractionDigits: 1 })}%`;
}

/**
 * «Засварын төсөл» таб — `repair_projects` (миграц 0194) дээрх тайлан + удирдлага.
 *
 * Зүүн: ажилтан ядаж нэг бүртгэл илгээсэн ЗОРИЛТУУД — дотоод ажил (`r:<id>`) БОЛОН
 * засвар бүртгэгдсэн жинхэнэ төсөл (`p:<id>`, эзний 2026-09-18-ны хүсэлт: «хүмүүс ямар
 * төсөл дээр засвар хийснийг олоод зүүн талд оруул») — ХАМГИЙН СҮҮЛД бүртгэл ирсэн нь
 * дээрээ.  Жинхэнэ төсөл нь төлөвөөс үл хамааран (архивласан ч) харагдана — түүх;
 * нэр/төлөв нь Төслүүд хуудсанд, энд зөвхөн холбоос.  Бүртгэлгүй (сая нэмсэн) төсөл доор нь тусдаа хураангуй
 * хэсэгт — тэндээс л устгаж болно (бүртгэлтэйг сервер 409-өөр хамгаална, архивлана).
 * Баруун: сонгосон төслийн дэлгэрэнгүй — хэн үүсгэсэн/хэзээ, идэвхтэй/идэвхгүй
 * унтраалга, хүн бүрийн нэр · хувь · цаг, ба бүртгэл бүр («Өмнөхийг татах»
 * дараагийн хуудсыг доор нь залгана).
 *
 * CRUD нь `routes/repair.ts`-ийн одоо байгаа `/api/repair/projects*` замууд
 * (Батлах → Засвар хуудасны RepairProjectsPanel-тай ижил) — давхардуулаагүй.
 */
export function RepairProjectsTab({ rid, onPick }: { rid: string | null; onPick: (key: string | null) => void }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const list = useRepairProjectReports();
  const [showInactive, setShowInactive] = useState(false);
  const [showIdle, setShowIdle] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const rows = useMemo(
    // Идэвхгүй шүүлт зөвхөн ДОТООД АЖИЛД — жинхэнэ төслийн засварын түүх төлөвөөс үл хамааран харагдана.
    () => (list.data?.rows ?? []).filter((r) => showInactive || r.kind === 'project' || r.status === 'active'),
    [list.data, showInactive],
  );
  const idle = useMemo(
    () => (list.data?.idle ?? []).filter((r) => showInactive || r.status === 'active'),
    [list.data, showInactive],
  );
  const inactiveCount = useMemo(
    () => [...(list.data?.rows ?? []), ...(list.data?.idle ?? [])].filter((r) => r.kind === 'repair' && r.status !== 'active').length,
    [list.data],
  );

  // `exact` — эс тэгвэл `['/reports/repair-projects', rid]` дэлгэрэнгүй ч дахин татагдаж, сая устгасан төсөл 404 өгнө.
  const invalidate = () => qc.invalidateQueries({ queryKey: REPAIR_PROJECTS_KEY, exact: true });

  const create = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res = await createRepairProject(name);
      setNewName('');
      toast.success(t('repair.projectCreated', { name }));
      await invalidate();
      // Сая нэмсэн төсөл бүртгэлгүй тул `idle`-д орно — тэр хэсгийг нээж, сонгоно.
      setShowIdle(true);
      onPick(`r:${res.project.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('repair.projectCreateFailed'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
      {/* Зүүн багана — жагсаалт (мобайл дээр дэлгэрэнгүй сонгогдсон үед нуугдана) */}
      <div className={cn('flex flex-col gap-3', rid != null && 'hidden lg:flex')}>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-2.5">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void create();
              }
            }}
            placeholder={t('repair.newProjectPlaceholder')}
            aria-label={t('reportsPage.rpAdd')}
            className="h-9 min-w-0 flex-1"
          />
          <Button type="button" size="sm" className="h-9 shrink-0 gap-1.5" disabled={!newName.trim() || creating} onClick={() => void create()}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('repair.newProjectAdd')}
          </Button>
        </div>

        <label className="flex cursor-pointer items-center gap-2 px-1 text-xs text-muted-foreground">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} aria-label={t('reportsPage.rpShowInactive')} />
          {t('reportsPage.rpShowInactive')}
          {inactiveCount > 0 && <span className="tabular-nums">({inactiveCount})</span>}
        </label>

        {list.isLoading && !list.data ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            {t('reportsPage.rpEmpty')}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((r) => (
              <li key={r.key}>
                <ProjectListRow row={r} active={r.key === rid} onClick={() => onPick(r.key)} />
              </li>
            ))}
          </ul>
        )}

        {idle.length > 0 && (
          <div className="rounded-xl border border-border/70">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-muted-foreground"
              onClick={() => setShowIdle((v) => !v)}
            >
              <span>{t('reportsPage.rpIdleTitle', { n: idle.length })}</span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', showIdle && 'rotate-180')} />
            </button>
            {showIdle && (
              <ul className="divide-y divide-border/60 border-t border-border/70">
                {idle.map((r) => (
                  <li key={r.key}>
                    <ProjectListRow row={r} active={r.key === rid} idle onClick={() => onPick(r.key)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Баруун багана — дэлгэрэнгүй */}
      {rid == null ? (
        <div className="hidden rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground lg:block">
          {t('reportsPage.rpPick')}
        </div>
      ) : (
        <RepairProjectDetail rid={rid} onBack={() => onPick(null)} onChanged={invalidate} />
      )}
    </div>
  );
}

function ProjectListRow({
  row,
  active,
  idle,
  onClick,
}: {
  row: RepairProjectReportRow;
  active: boolean;
  idle?: boolean;
  onClick: () => void;
}) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full flex-col gap-1 rounded-xl border px-3 py-2 text-left transition-colors',
        active ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/40',
        idle && 'rounded-none border-0',
        row.kind === 'repair' && row.status !== 'active' && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-2">
        <KindChip row={row} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</span>
        <StatusBadge row={row} />
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      {idle ? (
        <div className="text-xs text-muted-foreground">
          {t('reportsPage.rpCreatedBy', { name: row.created_by_name ?? '—', at: formatDateTime(row.created_at) })}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
            <span>
              <Users className="mr-1 inline h-3 w-3" aria-hidden />
              {fmtInt(row.people_count)}
            </span>
            <span>
              <Clock className="mr-1 inline h-3 w-3" aria-hidden />
              {fmtHours(row.total_hours)}
            </span>
            <span>
              <Zap className="mr-1 inline h-3 w-3" aria-hidden />
              {fmtPts(row.total_pct)}
            </span>
            {/* Явц (0339) — зөвхөн цагаар бодогддог зорилтод (дотоод ажил бүгд,
                жинхэнэ төсөл зөвхөн 'hours' горимд); бусдад null → харуулахгүй. */}
            {row.progress != null && (
              <span className="font-medium text-foreground" data-testid="rp-row-progress">
                <Gauge className="mr-1 inline h-3 w-3" aria-hidden />
                {fmtProgress(row.progress)}
              </span>
            )}
            <span>
              <FileEdit className="mr-1 inline h-3 w-3" aria-hidden />
              {fmtInt(row.entry_count)}
            </span>
          </div>
          {row.last_entry_at && (
            <div className="truncate text-xs text-muted-foreground">
              {t('reportsPage.rpLastEntry', {
                name: formatDisplayName(row.last_entry_user_name),
                at: formatDateTime(row.last_entry_at) || (row.last_entry_date ?? ''),
              })}
            </div>
          )}
        </>
      )}
    </button>
  );
}

/** Зорилтын төрөл — жинхэнэ төсөлд ангиллын код (AZ/ZA/…), дотоод ажилд алх. */
function KindChip({ row }: { row: RepairProjectReportRow }) {
  const { t } = useLanguage();
  if (row.kind === 'project') {
    return (
      <Badge variant="outline" className="shrink-0 font-mono text-[10px]" title={t('reportsPage.rpKindProject')}>
        {isProjectCategory(row.category) ? row.category : t('reportsPage.rpKindProjectShort')}
      </Badge>
    );
  }
  return <Hammer className="h-3.5 w-3.5 shrink-0 text-primary-ink" aria-label={t('reportsPage.rpKindRepair')} />;
}

/** Идэвхгүй дотоод ажил / дууссан-архивласан төсөл — идэвхтэй бол юу ч харуулахгүй. */
function StatusBadge({ row }: { row: RepairProjectReportRow }) {
  const { t } = useLanguage();
  if (row.status === 'active') return null;
  const label =
    row.kind === 'project'
      ? row.status === 'completed'
        ? t('projectsPage.statusCompleted')
        : t('projectsPage.statusArchived')
      : t('reportsPage.rpInactive');
  return (
    <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
      {label}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/*  Дэлгэрэнгүй                                                        */
/* ------------------------------------------------------------------ */

function RepairProjectDetail({ rid, onBack, onChanged }: { rid: string; onBack: () => void; onChanged: () => Promise<void> }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const detail = useRepairProjectReport(rid);
  const [personId, setPersonId] = useState<number | null>(null);
  const entries = useRepairProjectEntries(rid, personId);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const project = detail.data?.project;
  const people = detail.data?.people ?? [];
  const name = nameDraft ?? project?.name ?? '';
  const dirty = project != null && nameDraft != null && nameDraft.trim() !== project.name && nameDraft.trim() !== '';

  const refresh = async () => {
    await Promise.all([onChanged(), qc.invalidateQueries({ queryKey: ['/reports/repair-projects', rid] })]);
  };

  const patch = async (body: Parameters<typeof patchRepairProject>[1]) => {
    setBusy(true);
    try {
      if (!project || project.kind !== 'repair') return;
      await patchRepairProject(project.id, body);
      setNameDraft(null);
      toast.success(t('repair.adminSaved'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('repair.adminSaveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !(await confirmDialog({
        description: t('repair.adminDeleteConfirm'),
        variant: 'destructive',
        confirmText: t('common.delete'),
      }))
    )
      return;
    setBusy(true);
    try {
      if (!project || project.kind !== 'repair') return;
      await deleteRepairProject(project.id);
      toast.success(t('repair.deleted'));
      await onChanged();
      onBack();
    } catch (err) {
      // Бүртгэлтэй / ирцээр сонгогдсон бол сервер 409 + тайлбар.
      toast.error(err instanceof ApiError ? err.message : t('repair.adminSaveFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (detail.isLoading && !detail.data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
        {t('reportsPage.rpNotFound')}
      </div>
    );
  }

  const isProject = project.kind === 'project';
  const isActive = project.status === 'active';
  const entryRows = entries.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Толгой: нэр (засах) · төлөв · хэн хэзээ үүсгэсэн */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-3 md:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 lg:hidden" onClick={onBack} aria-label={t('common.back')}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {isProject ? (
              <>
                <FolderKanban className="hidden h-4 w-4 shrink-0 text-primary-ink lg:block" aria-hidden />
                <KindChip row={project} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</span>
                <StatusBadge row={project} />
                <Button asChild variant="outline" size="sm" className="h-8 shrink-0 gap-1.5">
                  <Link to={`/app/projects/${project.id}`}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('reportsPage.rpOpenProject')}
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <Hammer className="hidden h-4 w-4 shrink-0 text-primary-ink lg:block" aria-hidden />
                <Input
                  value={name}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="h-9 min-w-40 flex-1 text-sm font-medium"
                  aria-label={t('repair.adminColProject')}
                />
                <Button size="sm" className="h-9 shrink-0" disabled={busy || !dirty} onClick={() => void patch({ name: name.trim() })}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('common.save')}
                </Button>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {isProject
                ? t('reportsPage.rpProjectHint')
                : t('reportsPage.rpCreatedBy', { name: project.created_by_name ?? '—', at: formatDateTime(project.created_at) })}
            </div>
            {!isProject && (
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <Switch
                  checked={isActive}
                  disabled={busy}
                  onCheckedChange={(v) => void patch({ status: v ? 'active' : 'archived' })}
                  aria-label={isActive ? t('repair.adminArchive') : t('repair.adminUnarchive')}
                />
                <span className={cn(isActive ? 'text-foreground' : 'text-muted-foreground')}>
                  {isActive ? t('reportsPage.rpActive') : t('reportsPage.rpInactive')}
                </span>
                {isActive ? (
                  <Archive className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                ) : (
                  <ArchiveRestore className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                )}
              </label>
              {project.entry_count === 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('common.delete')}
                </Button>
              )}
            </div>
            )}
          </div>
          {!isProject && !isActive && <p className="text-xs text-muted-foreground">{t('reportsPage.rpInactiveHint')}</p>}
        </CardContent>
      </Card>

      {/* KPI — «Явц» нь зөвхөн цагаар бодогддог зорилтод (0339). */}
      <div className={cn('grid grid-cols-2 gap-2', project.progress != null ? 'sm:grid-cols-5' : 'sm:grid-cols-4')}>
        {project.progress != null && (
          <Tile icon={Gauge} label={t('reportsPage.rpKpiProgress')} value={fmtProgress(project.progress)} />
        )}
        <Tile icon={Users} label={t('reportsPage.rpKpiPeople')} value={fmtInt(project.people_count)} />
        <Tile icon={Clock} label={t('reportsPage.rpKpiHours')} value={fmtHours(project.total_hours)} />
        <Tile icon={Zap} label={t('reportsPage.rpKpiPct')} value={fmtPts(project.total_pct)} />
        <Tile icon={FileEdit} label={t('reportsPage.rpKpiEntries')} value={fmtInt(project.entry_count)} />
      </div>

      {/* Хүмүүс — нэр · хувь · цаг */}
      <section id="sec-reports-repair-people" className="scroll-mt-24">
        <h3 className="mb-1.5 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('reportsPage.rpPeopleTitle')}
        </h3>
        {people.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            {t('reportsPage.rpNoEntries')}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead className="w-8 text-right">#</TableHead>
                  <TableHead>{t('reportsPage.colEmployee')}</TableHead>
                  <TableHead className="text-right">{t('reportsPage.rpColPct')}</TableHead>
                  {project.progress != null && (
                    <TableHead className="text-right">{t('reportsPage.rpColProgress')}</TableHead>
                  )}
                  <TableHead className="hidden sm:table-cell">{t('reportsPage.rpColShare')}</TableHead>
                  <TableHead className="text-right">{t('reportsPage.colHours')}</TableHead>
                  <TableHead className="text-right">{t('reportsPage.colEntries')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('reportsPage.rpColPeriod')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((p, i) => (
                  <PersonRow key={p.user_id} p={p} index={i} showProgress={project.progress != null} selected={personId === p.user_id} onClick={() => setPersonId(personId === p.user_id ? null : p.user_id)} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Бүртгэлүүд — хэн хэзээ юу бичсэн; «Өмнөхийг татах» */}
      <section id="sec-reports-repair-entries" className="scroll-mt-24">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 px-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('reportsPage.rpEntriesTitle')}
            {personId != null && (
              <button type="button" className="ml-2 text-primary underline-offset-2 hover:underline" onClick={() => setPersonId(null)}>
                {t('reportsPage.rpClearPerson')}
              </button>
            )}
          </h3>
        </div>
        {entries.isLoading && !entries.data ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : entryRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            {t('reportsPage.rpNoEntries')}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {entryRows.map((e) => (
              <EntryRow key={e.id} e={e} />
            ))}
          </ul>
        )}
        {entries.hasNextPage && (
          <div className="mt-2 flex justify-center">
            <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={entries.isFetchingNextPage} onClick={() => void entries.fetchNextPage()}>
              {entries.isFetchingNextPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {t('reportsPage.rpLoadMore')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function PersonRow({ p, index, showProgress, selected, onClick }: { p: RepairProjectPersonRow; index: number; showProgress: boolean; selected: boolean; onClick: () => void }) {
  const { t } = useLanguage();
  return (
    <TableRow className={cn('cursor-pointer text-sm', selected && 'bg-primary/5', p.user_status !== 'active' && 'opacity-60')} onClick={onClick}>
      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{index + 1}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2.5">
          <Avatar className="h-8 w-8 shrink-0">
            {p.profile_image && <AvatarImage src={mediaUrl(p.profile_image)} alt="" />}
            <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">{p.full_name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{formatDisplayName(p.full_name)}</span>
              {p.team_code && (
                <Badge variant="outline" className={cn('font-mono text-[10px]', teamChipClass(p.team_code))}>
                  {p.team_code}
                </Badge>
              )}
              {p.user_status !== 'active' && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  {t('reportsPage.inactive')}
                </Badge>
              )}
            </div>
            <div className="truncate text-xs text-muted-foreground">{p.position || p.username}</div>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right font-semibold tabular-nums">{fmtPts(p.pct)}</TableCell>
      {showProgress && (
        <TableCell className="text-right tabular-nums">{fmtProgress(p.progress_pct ?? 0)}</TableCell>
      )}
      <TableCell className="hidden sm:table-cell">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, p.share_pct)}%` }} />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{Math.round(p.share_pct)}%</span>
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{fmtHours(p.hours)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtInt(p.entries)}</TableCell>
      <TableCell className="hidden text-xs tabular-nums text-muted-foreground md:table-cell">
        {p.first_date === p.last_date ? p.first_date : `${p.first_date} – ${p.last_date}`}
      </TableCell>
    </TableRow>
  );
}

function EntryRow({ e }: { e: RepairProjectEntryRow }) {
  return (
    <li className="flex gap-2.5 rounded-xl border border-border bg-card px-3 py-2">
      <Avatar className="mt-0.5 h-7 w-7 shrink-0">
        {e.profile_image && <AvatarImage src={mediaUrl(e.profile_image)} alt="" />}
        <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">{e.full_name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium">{formatDisplayName(e.full_name)}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{e.date}</span>
          {e.created_at && <span className="text-[11px] tabular-nums text-muted-foreground/70">{formatDateTime(e.created_at)}</span>}
          <span className="ml-auto text-sm font-semibold tabular-nums">{fmtPts(e.computed_pct)}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{fmtHours(e.hours)}</span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground/90">{e.description}</p>
      </div>
    </li>
  );
}
