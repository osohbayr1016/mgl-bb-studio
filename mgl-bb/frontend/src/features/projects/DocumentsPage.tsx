import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  HardDrive,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Search,
  SearchX,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState } from '@/shared/components/EmptyState';
import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { formatDate } from '@/shared/lib/time';
import { PROJECT_CATEGORY_CODES } from '@/shared/lib/project-categories';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Input } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { DataTable, type DataTableColumn, type SortState } from '@/ui/data-table';
import { autoGroupMainProjects, fetchMainProjects, mainProjectsKey } from './drive/api';
import { describeDriveError } from './drive/driveErrors';
import { DriveErrorState } from './drive/DriveStates';
import { MainProjectDialog } from './drive/MainProjectDialog';
import { DriveRootDialog } from './drive/DriveRootDialog';
import type { MainProject, MainProjectMember, MainProjectsResponse } from './drive/types';
import { formatBytes } from './documents/fileTypes';

/**
 * «Төслийн баримт бичиг» — ҮНДСЭН ТӨСЛҮҮД (migration 0281) ба тэдгээрийн
 * Google Drive хавтас.
 *
 * Эзний 2026-09-11-ний шийдвэр: `projects`-ын мөр нь бодит төслийн нэг ангилал
 * (AZ/ZA/EZ/…) тул баримт бичгийг ангиллаас биш БОДИТ ТӨСӨЛ дээр холбоно.
 *
 * 2026-09-15: хоёр баганат картан сүлжээг БҮТЭН ӨРГӨН ЖАГСААЛТ (`DataTable`)
 * болгов — мөр бүр нэг үндсэн төсөл: нэр + гишүүн ангиллын chip, код, огноо,
 * Drive хавтасны төлөв.  Дээр нь нэр/кодоор хайлт, ангилал ба хавтасны шүүлт,
 * нэр/код/огноогоор эрэмбэ (баганын толгой ч, мобайлд зориулсан Select ч —
 * хоёулаа НЭГ URL параметр `sort`-ыг удирдана, тиймээс сонголт refresh-д
 * хадгалагдаж, хуваалцсан холбоосоор дамжина).
 *
 * «Огноо» нь төслийн `MGL-yymmdd` / `DOC-yymmdd` кодоос гарна (эзний тогтоосон
 * нэршил — `lib/mainProjects.ts`-ийн `CODE_RE`-ийн угтвар-үл-хамаарах хувилбар);
 * кодгүй үндсэн төсөлд ERP-д
 * бүртгэсэн `created_at`-ыг нөөц болгож, эх сурвалжийг tooltip-оор хэлнэ.
 * Мөр → `/app/documents/main/:id` (файл менежер).  Үндсэн төсөлгүй атлаа
 * өөрийн хавтастай ангиллын төсөл нь тусдаа мөрөөр (`/app/documents/project/:id`).
 *
 * Админ: «Автоматаар бүлэглэх» (нэрний MGL-yymmdd кодоор), «Үндсэн төсөл
 * нэмэх», мөр бүрд «Засах» (нэр, код, гишүүд, хавтас, устгах).
 *
 * Серверээс импортолсон ХУУЧИН архивууд (0249–0251) энд ХАРАГДАХГҮЙ; байгаа
 * цагт админд «бүрмөсөн устгах» карт гарна (`POST /api/documents/purge-legacy`).
 */

/** Жагсаалтын нэг мөр — үндсэн төсөл эсвэл хавтастай бие даасан төсөл. */
interface DocRow {
  key: string;
  kind: 'main' | 'project';
  id: number;
  name: string;
  code: string | null;
  /** `YYYY-MM-DD`; кодоос эсвэл `created_at`-аас. */
  date: string | null;
  dateSource: 'code' | 'created' | null;
  linked: boolean;
  folderName: string | null;
  members: MainProjectMember[];
  categories: string[];
  to: string;
  /** Зөвхөн `kind === 'main'` — засах цонхонд өгнө. */
  main: MainProject | null;
}

const DRIVE_FILTERS = ['all', 'linked', 'unlinked'] as const;
type DriveFilter = (typeof DRIVE_FILTERS)[number];

const SORT_KEYS = ['name-asc', 'name-desc', 'code-asc', 'code-desc', 'date-desc', 'date-asc'] as const;
type SortKey = (typeof SORT_KEYS)[number];
const DEFAULT_SORT: SortKey = 'name-asc';

/** «MGL-251222 …» / «DOC-251222 …» — үсгэн угтвар + yymmdd.  Төслийн нэр `MGL-`,
 *  файл серверийн архивын хавтас `DOC-` угтвартай (0267-ийн тэмдэглэл), үндсэн
 *  төслийн код нь аль нь ч байж болно тул угтварыг хатуу бичихгүй. */
const CODE_RE = /^([A-Z]{2,5}-\d{6})(?![\d])/i;
const CODE_DATE_RE = /^[A-Z]{2,5}-(\d{2})(\d{2})(\d{2})(?![\d])/i;

/** «DOC-251222 …» → `2025-12-22`; хүчингүй сар/өдөр бол null. */
function dateFromCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = CODE_DATE_RE.exec(text.trim());
  if (!m) return null;
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `20${m[1]}-${m[2]}-${m[3]}`;
}

function codeFromName(name: string): string | null {
  const m = CODE_RE.exec(name.trim());
  return m ? m[1]!.toUpperCase() : null;
}

function toSortState(key: SortKey): SortState {
  const [id, dir] = key.split('-') as [string, 'asc' | 'desc'];
  return { id, dir };
}

function toSortKey(state: SortState | null): SortKey {
  if (!state) return DEFAULT_SORT;
  const key = `${state.id}-${state.dir}`;
  return (SORT_KEYS as readonly string[]).includes(key) ? (key as SortKey) : DEFAULT_SORT;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export default function DocumentsPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const [dialog, setDialog] = useState<{ open: boolean; main: MainProject | null }>({ open: false, main: null });
  const [grouping, setGrouping] = useState(false);
  const [rootDialog, setRootDialog] = useState(false);

  /* ---- шүүлт/эрэмбийн төлөв URL-д ---- */
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') ?? '';
  const catParam = searchParams.get('cat') ?? 'all';
  const category = (PROJECT_CATEGORY_CODES as readonly string[]).includes(catParam) ? catParam : 'all';
  const driveParam = searchParams.get('drive') ?? 'all';
  const drive: DriveFilter = (DRIVE_FILTERS as readonly string[]).includes(driveParam)
    ? (driveParam as DriveFilter)
    : 'all';
  const sortParam = searchParams.get('sort') ?? DEFAULT_SORT;
  const sortKey: SortKey = (SORT_KEYS as readonly string[]).includes(sortParam)
    ? (sortParam as SortKey)
    : DEFAULT_SORT;

  const setParam = useCallback(
    (name: string, value: string, defaultValue: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (!value || value === defaultValue) next.delete(name);
          else next.set(name, value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const hasFilters = search !== '' || category !== 'all' || drive !== 'all';
  const clearFilters = () => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('q');
        next.delete('cat');
        next.delete('drive');
        return next;
      },
      { replace: true },
    );
  };

  const q = useQuery<MainProjectsResponse>({
    queryKey: mainProjectsKey,
    queryFn: fetchMainProjects,
    retry: false,
  });
  const mains = q.data?.main_projects ?? [];
  const unassigned = q.data?.unassigned ?? [];

  const rows = useMemo<DocRow[]>(() => {
    const mains = q.data?.main_projects ?? [];
    const standalone = q.data?.standalone ?? [];
    const out: DocRow[] = mains.map((m) => {
      const fromCode = dateFromCode(m.code) ?? dateFromCode(m.name);
      const created = formatDate(m.created_at) || null;
      return {
        key: `m-${m.id}`,
        kind: 'main',
        id: m.id,
        name: m.name,
        code: m.code ?? codeFromName(m.name),
        date: fromCode ?? created,
        dateSource: fromCode ? 'code' : created ? 'created' : null,
        linked: m.folder_id != null,
        folderName: m.folder_name ?? m.folder_id,
        members: m.members,
        categories: [...new Set(m.members.map((p) => p.category).filter((c): c is string => !!c))],
        to: `/app/documents/main/${m.id}`,
        main: m,
      };
    });
    for (const p of standalone) {
      const fromCode = dateFromCode(p.name);
      out.push({
        key: `p-${p.id}`,
        kind: 'project',
        id: p.id,
        name: p.display_title?.trim() || p.name,
        code: codeFromName(p.name),
        date: fromCode,
        dateSource: fromCode ? 'code' : null,
        linked: true,
        folderName: null,
        members: [],
        categories: p.category ? [p.category] : [],
        to: `/app/documents/project/${p.id}`,
        main: null,
      });
    }
    return out;
  }, [q.data]);

  const filtered = useMemo(() => {
    const needle = normalize(search);
    return rows.filter((r) => {
      if (category !== 'all' && !r.categories.includes(category)) return false;
      if (drive === 'linked' && !r.linked) return false;
      if (drive === 'unlinked' && r.linked) return false;
      if (needle) {
        const hay = normalize(
          [r.name, r.code ?? '', r.folderName ?? '', ...r.members.map((p) => p.display_title ?? p.name)].join(' '),
        );
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, search, category, drive]);

  const columns = useMemo<DataTableColumn<DocRow>[]>(
    () => [
      {
        id: 'name',
        header: t('documentsPage.colProject'),
        sortValue: (r) => r.name,
        cell: (r) => <NameCell row={r} />,
        className: 'py-3',
      },
      {
        id: 'code',
        header: t('documentsPage.colCode'),
        sortValue: (r) => r.code,
        width: 'w-32',
        cell: (r) =>
          r.code ? (
            <span className="font-mono text-xs tabular-nums text-foreground">{r.code}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'date',
        header: t('documentsPage.colDate'),
        sortValue: (r) => r.date,
        width: 'w-32',
        cell: (r) =>
          r.date ? (
            <span
              className="tabular-nums"
              title={r.dateSource === 'code' ? t('documentsPage.dateFromCode') : t('documentsPage.dateFromCreated')}
            >
              {r.date}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'drive',
        header: t('documentsPage.colDrive'),
        sortValue: (r) => (r.linked ? 0 : 1),
        width: 'w-64',
        cell: (r) =>
          r.linked ? (
            <span className="flex min-w-0 items-center gap-1.5 text-foreground">
              <HardDrive className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <span className="truncate" title={r.folderName ?? undefined}>
                {r.kind === 'project' ? t('mainProject.standaloneNote') : r.folderName}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">{t('mainProject.notLinked')}</span>
          ),
      },
      {
        id: 'actions',
        header: '',
        width: 'w-24',
        align: 'right',
        mobileLabel: t('documentsPage.open'),
        cell: (r) => (
          <span className="inline-flex items-center justify-end gap-1">
            {isAdmin && r.main && (
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setDialog({ open: true, main: r.main });
                }}
                title={t('mainProject.edit')}
                aria-label={t('mainProject.edit')}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            <Button size="icon-sm" variant="ghost" asChild aria-label={t('documentsPage.open')}>
              <Link to={r.to} onClick={(e) => e.stopPropagation()}>
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </span>
        ),
      },
    ],
    [t, isAdmin],
  );

  const autoGroup = async () => {
    const ok = await confirmDialog({
      title: t('mainProject.autoGroupTitle'),
      description: t('mainProject.autoGroupConfirm', { count: unassigned.length }),
      confirmText: t('mainProject.autoGroup'),
    });
    if (!ok) return;
    setGrouping(true);
    try {
      const res = await autoGroupMainProjects();
      toast.success(t('mainProject.autoGroupDone', { created: res.created, assigned: res.assigned }));
      await qc.invalidateQueries({ queryKey: ['project-drive'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.saveFailed'));
    } finally {
      setGrouping(false);
    }
  };

  const toolbar = (
    <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-border pb-3 md:mb-0 md:px-4 md:py-3">
      <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(e) => setParam('q', e.target.value, '')}
          placeholder={t('documentsPage.searchPlaceholder')}
          aria-label={t('common.search')}
          className="h-8 pl-8"
        />
      </div>
      <Select value={category} onValueChange={(v) => setParam('cat', v, 'all')}>
        <SelectTrigger className="h-8 w-40" aria-label={t('documentsPage.filterCategoryAll')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('documentsPage.filterCategoryAll')}</SelectItem>
          {PROJECT_CATEGORY_CODES.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={drive} onValueChange={(v) => setParam('drive', v, 'all')}>
        <SelectTrigger className="h-8 w-40" aria-label={t('documentsPage.colDrive')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('documentsPage.filterDriveAll')}</SelectItem>
          <SelectItem value="linked">{t('documentsPage.filterDriveLinked')}</SelectItem>
          <SelectItem value="unlinked">{t('documentsPage.filterDriveUnlinked')}</SelectItem>
        </SelectContent>
      </Select>
      <Select value={sortKey} onValueChange={(v) => setParam('sort', v, DEFAULT_SORT)}>
        <SelectTrigger className="h-8 w-48" aria-label={t('documentsPage.sortPlaceholder')}>
          <SelectValue placeholder={t('documentsPage.sortPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="name-asc">{t('documentsPage.sortNameAsc')}</SelectItem>
          <SelectItem value="name-desc">{t('documentsPage.sortNameDesc')}</SelectItem>
          <SelectItem value="code-asc">{t('documentsPage.sortCodeAsc')}</SelectItem>
          <SelectItem value="code-desc">{t('documentsPage.sortCodeDesc')}</SelectItem>
          <SelectItem value="date-desc">{t('documentsPage.sortDateDesc')}</SelectItem>
          <SelectItem value="date-asc">{t('documentsPage.sortDateAsc')}</SelectItem>
        </SelectContent>
      </Select>
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
        {t('documentsPage.resultCount', { shown: filtered.length, total: rows.length })}
      </span>
      {hasFilters && (
        <Button size="sm" variant="ghost" onClick={clearFilters}>
          <X className="h-3.5 w-3.5" />
          {t('documentsPage.clearFilters')}
        </Button>
      )}
    </div>
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('nav.projectDocuments')}
        description={t('documentsPage.driveIntro')}
        actions={
          isAdmin ? (
            <div className="flex flex-wrap gap-2">
              {unassigned.length > 0 && (
                <Button variant="outline" onClick={autoGroup} disabled={grouping}>
                  {grouping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  {t('mainProject.autoGroup')} ({unassigned.length})
                </Button>
              )}
              <Button variant="outline" onClick={() => setRootDialog(true)}>
                <HardDrive className="h-4 w-4" />
                {t('driveRoot.button')}
              </Button>
              <Button onClick={() => setDialog({ open: true, main: null })}>
                <Plus className="h-4 w-4" />
                {t('mainProject.add')}
              </Button>
            </div>
          ) : undefined
        }
      />

      {q.isError ? (
        <div className="rounded-xl border border-border bg-card">
          <DriveErrorState
            view={describeDriveError(q.error)}
            isAdmin={isAdmin}
            onRetry={() => void q.refetch()}
            retrying={q.isFetching}
          />
        </div>
      ) : !q.isLoading && rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <Layers className="mx-auto h-7 w-7 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium text-foreground">{t('mainProject.emptyTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isAdmin ? t('mainProject.emptyAdminHint') : t('mainProject.emptyHint')}
          </p>
        </div>
      ) : (
        <Card className="py-0">
          <CardContent className="p-3 md:p-0">
            <DataTable
              columns={columns}
              rows={q.isLoading ? undefined : filtered}
              rowKey={(r) => r.key}
              isLoading={q.isLoading}
              /* Багана хатуу өргөнтэй — урт хавтасны нэр хүснэгтийг картаас
                 халиулж «Нээх» товчийг гадна нь гаргаж байсан; одоо truncate. */
              tableClassName="table-fixed"
              onRowClick={(r) => navigate(r.to)}
              sort={toSortState(sortKey)}
              onSortChange={(next) => setParam('sort', toSortKey(next), DEFAULT_SORT)}
              toolbar={toolbar}
              empty={
                <EmptyState
                  icon={SearchX}
                  title={t('documentsPage.noMatch')}
                  description={t('documentsPage.noMatchHint')}
                  action={
                    hasFilters ? (
                      <Button size="sm" variant="outline" onClick={clearFilters}>
                        {t('documentsPage.clearFilters')}
                      </Button>
                    ) : undefined
                  }
                  compact
                />
              }
            />
          </CardContent>
        </Card>
      )}

      {isAdmin && unassigned.length > 0 && mains.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('mainProject.unassignedNote', { count: unassigned.length })}
        </p>
      )}

      {isAdmin ? <LegacyPurgeCard /> : null}

      {isAdmin && <DriveRootDialog open={rootDialog} onOpenChange={setRootDialog} />}

      {isAdmin && (
        <MainProjectDialog
          open={dialog.open}
          onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
          main={dialog.main}
          candidates={unassigned}
        />
      )}
    </PageContainer>
  );
}

/** Нэрийн нүд — icon, нэр, доор нь гишүүн ангиллын төслүүд (chip). */
function NameCell({ row }: { row: DocRow }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          row.linked ? 'bg-primary/10' : 'bg-muted',
        )}
      >
        <HardDrive className={cn('h-4 w-4', row.linked ? 'text-primary' : 'text-muted-foreground')} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-snug text-foreground">{row.name}</p>
        {row.kind === 'project' && row.categories[0] ? (
          <Badge variant="outline" className="mt-1">
            {row.categories[0]}
          </Badge>
        ) : (
          <MemberChips members={row.members} />
        )}
      </div>
    </div>
  );
}

function MemberChips({ members }: { members: MainProjectMember[] }) {
  if (members.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {members.map((p) => (
        <Link
          key={p.id}
          to={`/app/projects/${p.id}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground',
            p.status === 'archived' && 'opacity-60',
          )}
          title={p.name}
        >
          {p.category ? <span className="font-semibold">{p.category}</span> : null}
          <span className="truncate">{p.display_title?.trim() || p.name}</span>
        </Link>
      ))}
    </div>
  );
}

interface LegacyCounts {
  archives: number;
  folders: number;
  documents: number;
  revisions: number;
  revision_bytes: number;
  google_files: number;
}

const PURGE_KEY = ['/documents/purge-legacy'] as const;

/**
 * Серверт үлдсэн хуучин архивын өгөгдөл — байвал л гарна.  Устгал нь R2-ын
 * объектуудыг ч арчдаг ХАТУУ устгал тул тоог хараад баталгаажуулна.
 */
function LegacyPurgeCard() {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const q = useApiQuery<LegacyCounts>(PURGE_KEY, '/documents/purge-legacy', { retry: false });
  const c = q.data;
  if (!c || (c.archives === 0 && c.documents === 0 && c.revisions === 0 && c.google_files === 0)) {
    return null;
  }
  const summary = t('documentsPage.legacySummary', {
    archives: c.archives,
    files: c.documents,
    size: formatBytes(c.revision_bytes),
  });

  const purge = async () => {
    const ok = await confirmDialog({
      title: t('documentsPage.legacyPurgeTitle'),
      description: `${summary}\n\n${t('documentsPage.legacyPurgeConfirm')}`,
      confirmText: t('documentsPage.legacyPurgeButton'),
      variant: 'destructive',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ r2_objects_deleted: number; purged: LegacyCounts }>(
        '/documents/purge-legacy',
        { method: 'POST', data: { confirm: 'PURGE-LEGACY-ARCHIVES' }, timeoutMs: 120_000 },
      );
      toast.success(
        t('documentsPage.legacyPurged', { files: res.purged.documents, objects: res.r2_objects_deleted }),
      );
      await qc.invalidateQueries({ queryKey: PURGE_KEY });
      await qc.invalidateQueries({ queryKey: ['/documents/archives'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('documentsPage.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-destructive/30 py-0">
      <CardContent className="flex flex-wrap items-center gap-3 px-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{t('documentsPage.legacyTitle')}</p>
          <p className="text-xs text-muted-foreground">{summary}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('documentsPage.legacyHint')}</p>
        </div>
        <Button variant="destructive" size="sm" onClick={purge} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {t('documentsPage.legacyPurgeButton')}
        </Button>
      </CardContent>
    </Card>
  );
}
