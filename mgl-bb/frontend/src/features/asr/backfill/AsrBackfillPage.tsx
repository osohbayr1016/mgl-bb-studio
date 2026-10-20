/**
 * Зохиогчийн хяналт — ХУУЧИН тайлан нөхөж бүртгэх («Project document нөхөх»).
 * `/app/asr/backfill?main=<үндсэн төслийн id>`, зөвхөн admin + senior.
 *
 * Зүүн: Drive хавтастай үндсэн төслүүд + нэр дэвшигчийн тоо.  Баруун: сонгосон
 * үндсэн төслийн (1) зорилтот төсөл, (2) файлын нэрээс танигдсан нэр дэвшигч
 * мөрүүд (огноо · баг · дугаар · файлууд · давхардлын анхааруулга), docx-оос
 * агуулга уншуулах товч, (3) танигдаагүй файлууд → гараар, (4) алгассан ба
 * (5) аль хэдийн орсон файлууд.
 *
 * Сервер бол шийдвэр: давхардал, нэг файл нэг удаа, дугаарлалт (`seq` NULL)
 * бүгд тэнд.  Энэ хуудас нь зөвхөн урьдчилан бөглөж, баталгаажуулж илгээнэ.
 */
import { useMemo, useState } from 'react';
import { ExternalLink, FileText, Loader2, Plus, RefreshCw } from 'lucide-react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { asrProjectName } from '@/features/projects/asr/asrProjectName';
import { ApiError } from '@/shared/api/client';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { formatDate } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Skeleton } from '@/ui/skeleton';
import { Textarea } from '@/ui/textarea';
import {
  IMPORT_REASON_KEY,
  useBackfillCreateTarget,
  useBackfillIgnore,
  useBackfillImport,
  useBackfillInvalidate,
  useBackfillMain,
  useBackfillOverview,
  useBackfillParse,
  type BackfillCandidate,
  type BackfillFile,
  type BackfillTeam,
  type ImportItem,
  type ParsedAsrDoc,
} from './api';

const BACKFILL_ROLES = new Set(['admin', 'senior']);

/* ------------------------------------------------------------------ */
/*  Мөрийн ноорог                                                      */
/* ------------------------------------------------------------------ */

interface RowDraft {
  selected: boolean;
  date: string;
  team_code: string;
  legacy_doc_no: string;
  author: string;
  description: string;
  work_note: string;
  force: boolean;
  /** docx-оос уншсан утга — мөр дээр дэлгэрэнгүй харуулна. */
  parsed: ParsedAsrDoc | null;
  parseError: string | null;
  open: boolean;
}

function draftFrom(c: BackfillCandidate): RowDraft {
  return {
    selected: c.duplicate_of == null,
    date: c.date,
    team_code: c.team_code ?? '',
    legacy_doc_no: c.legacy_doc_no ?? '',
    author: '',
    description: '',
    work_note: '',
    force: false,
    parsed: null,
    parseError: null,
    open: false,
  };
}

function teamLabel(t: BackfillTeam, lang: string): string {
  return lang === 'en' && t.name_en ? `${t.code} · ${t.name_en}` : `${t.code} · ${t.name_mn}`;
}

/* ------------------------------------------------------------------ */
/*  Хуудас                                                             */
/* ------------------------------------------------------------------ */

export default function AsrBackfillPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const mainParam = Number(params.get('main'));
  const mainId = Number.isInteger(mainParam) && mainParam > 0 ? mainParam : null;
  const overview = useBackfillOverview();
  const location = useLocation();

  // Буцах сум = ЯГ ирсэн хуудас (`state.from`, «Төслийн баримт бичиг»-ийн хавтастай нь).
  // State алдагдвал (шинэчилсэн/шууд холбоос) `?main=`-ийн баримтын хуудас, тэр ч үгүй бол ЗХ.
  const fromState = (location.state as { from?: unknown } | null)?.from;
  const backTo =
    typeof fromState === 'string' && fromState.startsWith('/app/')
      ? fromState
      : mainId
        ? `/app/documents/main/${mainId}`
        : '/app/asr';
  const backLabel = backTo.startsWith('/app/documents') ? t('nav.projectDocuments') : t('asr.title');

  if (user && !BACKFILL_ROLES.has(user.role)) return <Navigate to="/app/asr" replace />;

  const selectMain = (id: number) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('main', String(id));
        next.delete('project');
        return next;
      },
      { replace: true, state: location.state },
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('asrBackfill.title')}
        eyebrow={t('asr.title')}
        description={t('asrBackfill.subtitle')}
        backTo={backTo}
        backLabel={backLabel}
        actions={
          <Button size="sm" variant="outline" onClick={() => void overview.refetch()} disabled={overview.isFetching}>
            <RefreshCw className={cn('h-4 w-4', overview.isFetching && 'animate-spin')} />
            {t('asrBackfill.refresh')}
          </Button>
        }
      />

      {overview.data && !overview.data.drive_configured && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          {t('asrBackfill.driveNotConfigured')}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <aside className="space-y-2">
          <h2 className="text-micro font-semibold uppercase text-muted-foreground">{t('asrBackfill.mainProjects')}</h2>
          {overview.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : overview.isError ? (
            <p className="text-sm text-destructive">{overview.error.message}</p>
          ) : (
            <ul className="space-y-1">
              {(overview.data?.mains ?? [])
                .filter((m) => m.folder_id || m.members.length > 0)
                .map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => selectMain(m.id)}
                      className={cn(
                        'w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent',
                        m.id === mainId ? 'border-primary bg-accent' : 'border-border',
                      )}
                    >
                      <div className="truncate text-sm font-medium">{asrProjectName(m.name)}</div>
                      <div className="mt-0.5 flex flex-wrap gap-1 text-xs text-muted-foreground">
                        {!m.folder_id ? (
                          <span>{t('asrBackfill.noFolder')}</span>
                        ) : (
                          <>
                            <span className={cn(m.candidate_count > 0 && 'font-semibold text-foreground')}>
                              {t('asrBackfill.countCandidates', { count: m.candidate_count })}
                            </span>
                            {m.unrecognized_count > 0 && (
                              <span>· {t('asrBackfill.countUnrecognized', { count: m.unrecognized_count })}</span>
                            )}
                            {m.imported_count > 0 && (
                              <span>· {t('asrBackfill.countImported', { count: m.imported_count })}</span>
                            )}
                          </>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </aside>

        <section className="min-w-0">
          {mainId == null ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {t('asrBackfill.pickMain')}
            </div>
          ) : (
            <BackfillWorkspace key={mainId} mainId={mainId} />
          )}
        </section>
      </div>
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/*  Нэг үндсэн төслийн ажлын талбар                                     */
/* ------------------------------------------------------------------ */

function BackfillWorkspace({ mainId }: { mainId: number }) {
  const { t, lang } = useLanguage();
  const [params, setParams] = useSearchParams();
  const projectParam = Number(params.get('project'));
  const projectOverride = Number.isInteger(projectParam) && projectParam > 0 ? projectParam : null;
  const detail = useBackfillMain(mainId, projectOverride);
  const invalidate = useBackfillInvalidate();
  const parse = useBackfillParse(mainId);
  const importMut = useBackfillImport(mainId);
  const ignoreMut = useBackfillIgnore(mainId);
  const createTarget = useBackfillCreateTarget(mainId);

  /**
   * Зөвхөн ХЭРЭГЛЭГЧИЙН засварласан мөрүүд.  Ноорог нь render үед
   * `overrides[key] ?? draftFrom(candidate)` гэж гарган авагдана — тиймээс
   * нэр дэвшигч дахин татагдахад (импортын дараа) эффект хэрэггүй, засвар ч
   * алдагдахгүй.
   */
  const [overrides, setOverrides] = useState<Record<string, RowDraft>>({});
  const [manualOpen, setManualOpen] = useState<{ file: BackfillFile | null } | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});

  const data = detail.data;
  const targetId = data?.target_project_id ?? null;
  const target = data?.members.find((m) => m.id === targetId) ?? null;
  const drafts = useMemo(() => {
    const out: Record<string, RowDraft> = {};
    for (const c of data?.candidates ?? []) out[c.key] = overrides[c.key] ?? draftFrom(c);
    return out;
  }, [data, overrides]);

  const setTarget = (id: number) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('project', String(id));
        return next;
      },
      { replace: true },
    );
  };

  const candidateOf = (key: string) => data?.candidates.find((c) => c.key === key);
  const update = (key: string, patch: Partial<RowDraft>) =>
    setOverrides((prev) => {
      const base = prev[key] ?? (candidateOf(key) ? draftFrom(candidateOf(key)!) : null);
      if (!base) return prev;
      return { ...prev, [key]: { ...base, ...patch } };
    });

  const selectedKeys = useMemo(
    () => Object.entries(drafts).filter(([, d]) => d.selected).map(([k]) => k),
    [drafts],
  );

  const readDocx = async (c: BackfillCandidate) => {
    const docx = c.files.find((f) => f.is_docx);
    if (!docx) return;
    update(c.key, { parseError: null });
    try {
      const res = await parse.mutateAsync({ file_id: docx.file_id });
      if (!res.parsed) {
        update(c.key, { parseError: res.error ?? t('asrBackfill.parseFailed') });
        return;
      }
      const p = res.parsed;
      const d = drafts[c.key] ?? draftFrom(c);
      update(c.key, {
        parsed: p,
        open: true,
        description: d.description || (p.description ?? ''),
        work_note: d.work_note || (p.work_note ?? ''),
        author: d.author || (p.sig_site_name ?? p.sig_arch_name ?? ''),
        date: d.date || (p.report_date ?? c.date),
        team_code:
          d.team_code || p.visited_teams[0] || p.work_report_teams[0] || c.team_code || '',
      });
    } catch (err) {
      update(c.key, { parseError: err instanceof ApiError ? err.message : t('asrBackfill.parseFailed') });
    }
  };

  const runImport = async (items: ImportItem[]) => {
    if (!targetId) {
      toast.error(t('asrBackfill.noTarget'));
      return;
    }
    try {
      const res = await importMut.mutateAsync({ project_id: targetId, items });
      const next: Record<string, string> = {};
      for (const r of res.results) {
        if (!r.key) continue;
        next[r.key] = r.ok
          ? t('asrBackfill.rowImported', { photos: r.photos })
          : t(IMPORT_REASON_KEY[r.reason] ?? 'asrBackfill.reasonFailed');
      }
      setResults((prev) => ({ ...prev, ...next }));
      if (res.imported > 0) toast.success(t('asrBackfill.importedToast', { count: res.imported }));
      const skipped = res.results.length - res.imported;
      if (skipped > 0) toast.warn(t('asrBackfill.skippedToast', { count: skipped }));
      invalidate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('asrBackfill.importFailed'));
    }
  };

  const importSelected = () => {
    const items: ImportItem[] = [];
    for (const key of selectedKeys) {
      const c = candidateOf(key);
      const d = drafts[key];
      if (!c || !d) continue;
      items.push({
        key,
        file_ids: c.files.map((f) => f.file_id),
        report_date: d.date,
        team_codes: d.team_code ? [d.team_code] : [],
        legacy_doc_no: d.legacy_doc_no || null,
        legacy_author_name: d.author || null,
        description: d.description || null,
        work_note: d.work_note || null,
        force_duplicate: d.force,
      });
    }
    if (items.length === 0) return;
    void runImport(items);
  };

  const ignoreFiles = async (fileIds: string[], ignore: boolean) => {
    try {
      await ignoreMut.mutateAsync({ file_ids: fileIds, ignore });
      invalidate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('asrBackfill.importFailed'));
    }
  };

  const createAsrTarget = async () => {
    if (!data) return;
    if (!(await confirmDialog({ description: t('asrBackfill.createTargetConfirm', { name: data.main.name }) })))
      return;
    try {
      const res = await createTarget.mutateAsync({});
      toast.success(t('asrBackfill.targetCreated'));
      invalidate();
      setTarget(res.project_id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('asrBackfill.importFailed'));
    }
  };

  if (detail.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (detail.isError || !data) {
    return <p className="text-sm text-destructive">{detail.error?.message ?? t('asrBackfill.importFailed')}</p>;
  }

  return (
    <div className="space-y-6">
      {/* Зорилтот төсөл */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Label className="text-xs text-muted-foreground">{t('asrBackfill.targetProject')}</Label>
            {data.members.length === 0 ? (
              <p className="mt-1 text-sm">{t('asrBackfill.noMembers')}</p>
            ) : (
              <Select value={targetId ? String(targetId) : ''} onValueChange={(v) => setTarget(Number(v))}>
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue placeholder={t('asrBackfill.targetProject')} />
                </SelectTrigger>
                <SelectContent>
                  {data.members.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {asrProjectName(m.name)}
                      {m.category ? ` · ${m.category}` : ''}
                      {m.status !== 'active' ? ` · ${t('asrBackfill.archived')}` : ''}
                      {m.report_count > 0 ? ` · ${t('asrBackfill.reportCount', { count: m.report_count })}` : ''}
                      {m.id === data.suggested_project_id ? ` · ${t('asrBackfill.suggested')}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void createAsrTarget()} disabled={createTarget.isPending}>
              {createTarget.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t('asrBackfill.createTarget')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setManualOpen({ file: null })} disabled={!targetId}>
              <FileText className="h-4 w-4" />
              {t('asrBackfill.addManual')}
            </Button>
            {target && (
              <Button size="sm" variant="ghost" asChild>
                <Link to={`/app/asr?project=${target.id}`}>
                  <ExternalLink className="h-4 w-4" />
                  {t('asrBackfill.openHistory')}
                </Link>
              </Button>
            )}
          </div>
        </div>
        {!data.main.folder_id && <p className="mt-2 text-xs text-muted-foreground">{t('asrBackfill.noFolder')}</p>}
        {data.main.folder_id && !data.ledger_indexed && (
          <p className="mt-2 text-xs text-muted-foreground">{t('asrBackfill.notIndexed')}</p>
        )}
      </div>

      {/* Нэр дэвшигчид */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {t('asrBackfill.candidates')}{' '}
            <span className="text-muted-foreground">({data.candidates.length})</span>
          </h3>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const all = Object.values(drafts).every((d) => d.selected);
                setOverrides(() => {
                  const next: Record<string, RowDraft> = {};
                  for (const [k, d] of Object.entries(drafts)) next[k] = { ...d, selected: !all };
                  return next;
                });
              }}
              disabled={data.candidates.length === 0}
            >
              {t('asrBackfill.toggleAll')}
            </Button>
            <Button size="sm" onClick={importSelected} disabled={selectedKeys.length === 0 || importMut.isPending || !targetId}>
              {importMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('asrBackfill.importSelected', { count: selectedKeys.length })}
            </Button>
          </div>
        </div>
        {data.candidates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t('asrBackfill.noCandidates')}
          </p>
        ) : (
          <ul className="space-y-2">
            {data.candidates.map((c) => {
              const d = drafts[c.key] ?? draftFrom(c);
              return (
                <CandidateRow
                  key={c.key}
                  candidate={c}
                  draft={d}
                  teams={data.teams}
                  lang={lang}
                  result={results[c.key] ?? null}
                  driveConfigured={data.drive_configured}
                  parsing={parse.isPending && parse.variables?.file_id === c.files.find((f) => f.is_docx)?.file_id}
                  onChange={(patch) => update(c.key, patch)}
                  onRead={() => void readDocx(c)}
                  onIgnore={() => void ignoreFiles(c.files.map((f) => f.file_id), true)}
                />
              );
            })}
          </ul>
        )}
      </div>

      {/* Танигдаагүй */}
      {data.unrecognized.length > 0 && (
        <FileSection title={t('asrBackfill.unrecognized')} hint={t('asrBackfill.unrecognizedHint')}>
          {data.unrecognized.map((f) => (
            <FileLine key={f.file_id} file={f}>
              <Button size="sm" variant="outline" onClick={() => setManualOpen({ file: f })} disabled={!targetId}>
                {t('asrBackfill.addManualFromFile')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void ignoreFiles([f.file_id], true)}>
                {t('asrBackfill.ignore')}
              </Button>
            </FileLine>
          ))}
        </FileSection>
      )}

      {/* Орсон */}
      {data.imported.length > 0 && (
        <FileSection title={t('asrBackfill.imported')}>
          {data.imported.map((f) => (
            <FileLine key={f.file_id} file={f}>
              {f.report_id != null && (
                <Button size="sm" variant="ghost" asChild>
                  <Link to={`/app/asr/${f.report_id}`}>
                    {f.report?.doc_no ?? `#${f.report_id}`} · {f.report ? formatDate(f.report.report_date) : ''}
                  </Link>
                </Button>
              )}
            </FileLine>
          ))}
        </FileSection>
      )}

      {/* Алгассан */}
      {data.ignored.length > 0 && (
        <FileSection title={t('asrBackfill.ignored')}>
          {data.ignored.map((f) => (
            <FileLine key={f.file_id} file={f}>
              <Button size="sm" variant="ghost" onClick={() => void ignoreFiles([f.file_id], false)}>
                {t('asrBackfill.unignore')}
              </Button>
            </FileLine>
          ))}
        </FileSection>
      )}

      {manualOpen && targetId && (
        <ManualEntryDialog
          open
          onOpenChange={(v) => !v && setManualOpen(null)}
          teams={data.teams}
          lang={lang}
          file={manualOpen.file}
          onSubmit={async (item) => {
            await runImport([item]);
            setManualOpen(null);
          }}
          busy={importMut.isPending}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Нэр дэвшигчийн мөр                                                 */
/* ------------------------------------------------------------------ */

function CandidateRow({
  candidate: c,
  draft: d,
  teams,
  lang,
  result,
  driveConfigured,
  parsing,
  onChange,
  onRead,
  onIgnore,
}: {
  candidate: BackfillCandidate;
  draft: RowDraft;
  teams: BackfillTeam[];
  lang: string;
  result: string | null;
  driveConfigured: boolean;
  parsing: boolean;
  onChange: (patch: Partial<RowDraft>) => void;
  onRead: () => void;
  onIgnore: () => void;
}) {
  const { t } = useLanguage();
  const dup = c.duplicate_of;
  return (
    <li
      className={cn(
        'rounded-xl border bg-card p-3',
        d.selected ? 'border-primary/50' : 'border-border',
        dup && 'border-amber-500/50',
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <Checkbox
          checked={d.selected}
          onCheckedChange={(v) => onChange({ selected: v === true })}
          aria-label={t('asrBackfill.select')}
          className="mt-2"
        />
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[9rem_11rem_9rem_1fr]">
          <div>
            <Label className="text-micro text-muted-foreground">{t('asr.reportDate')}</Label>
            <Input type="date" value={d.date} onChange={(e) => onChange({ date: e.target.value })} className="h-8" />
          </div>
          <div>
            <Label className="text-micro text-muted-foreground">{t('asrBackfill.team')}</Label>
            <Select value={d.team_code} onValueChange={(v) => onChange({ team_code: v })}>
              <SelectTrigger className="h-8 w-full">
                <SelectValue placeholder={t('asrBackfill.teamPick')} />
              </SelectTrigger>
              <SelectContent>
                {teams.map((tm) => (
                  <SelectItem key={tm.code} value={tm.code}>
                    {teamLabel(tm, lang)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-micro text-muted-foreground">{t('asr.docNo')}</Label>
            <Input
              value={d.legacy_doc_no}
              onChange={(e) => onChange({ legacy_doc_no: e.target.value })}
              className="h-8 font-mono"
              placeholder="ASR-BB-001"
            />
          </div>
          <div>
            <Label className="text-micro text-muted-foreground">{t('asrBackfill.author')}</Label>
            <Input
              value={d.author}
              onChange={(e) => onChange({ author: e.target.value })}
              className="h-8"
              placeholder={t('asrBackfill.authorPlaceholder')}
            />
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-muted-foreground">
        {c.files.map((f) => (
          <a
            key={f.file_id}
            href={f.view_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
          >
            <FileText className="h-3 w-3" />
            {f.file_name}
          </a>
        ))}
        {c.project_tag && <span>· {c.project_tag}</span>}
        <span className="grow" />
        {c.has_docx && (
          <Button size="sm" variant="outline" className="h-7" onClick={onRead} disabled={parsing || !driveConfigured}>
            {parsing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {t('asrBackfill.readDocx')}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7" onClick={() => onChange({ open: !d.open })}>
          {d.open ? t('asrBackfill.less') : t('asrBackfill.more')}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-muted-foreground" onClick={onIgnore}>
          {t('asrBackfill.ignore')}
        </Button>
      </div>

      {dup && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-7 text-xs">
          <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-300">
            {t('asrBackfill.duplicateBadge')}
          </Badge>
          <span className="text-muted-foreground">
            {t('asrBackfill.duplicateOf', {
              docNo: dup.doc_no ?? `#${dup.id}`,
              date: formatDate(dup.report_date),
              teams: dup.team_codes ?? '—',
            })}
          </span>
          <Link to={`/app/asr/${dup.id}`} className="underline">
            {t('asrBackfill.openReport')}
          </Link>
          <label className="ml-auto inline-flex items-center gap-1">
            <Checkbox checked={d.force} onCheckedChange={(v) => onChange({ force: v === true })} />
            {t('asrBackfill.forceDuplicate')}
          </label>
        </div>
      )}

      {d.parseError && <p className="mt-2 pl-7 text-xs text-destructive">{d.parseError}</p>}
      {result && <p className="mt-2 pl-7 text-xs font-medium">{result}</p>}

      {d.open && (
        <div className="mt-3 grid gap-3 pl-7 sm:grid-cols-2">
          <div>
            <Label className="text-micro text-muted-foreground">{t('asr.description')}</Label>
            <Textarea
              value={d.description}
              onChange={(e) => onChange({ description: e.target.value })}
              rows={3}
              placeholder={t('asrBackfill.fromDocxOrEmpty')}
            />
          </div>
          <div>
            <Label className="text-micro text-muted-foreground">{t('asr.workReport')}</Label>
            <Textarea
              value={d.work_note}
              onChange={(e) => onChange({ work_note: e.target.value })}
              rows={3}
              placeholder={t('asrBackfill.fromDocxOrEmpty')}
            />
          </div>
          {d.parsed && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {t('asrBackfill.parsedSummary', {
                shifr: d.parsed.shifr ?? '—',
                types: d.parsed.doc_types.join(', ') || '—',
                teams: [...new Set([...d.parsed.visited_teams, ...d.parsed.work_report_teams])].join(', ') || '—',
                photos: d.parsed.photo_rids.length,
              })}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Файлын жагсаалтын хэсэг                                            */
/* ------------------------------------------------------------------ */

function FileSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">{children}</ul>
    </div>
  );
}

function FileLine({ file, children }: { file: BackfillFile; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
      <a href={file.view_url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 hover:underline">
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{file.file_name}</span>
      </a>
      <span className="grow" />
      {children}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Гараар нэмэх цонх                                                  */
/* ------------------------------------------------------------------ */

function ManualEntryDialog({
  open,
  onOpenChange,
  teams,
  lang,
  file,
  onSubmit,
  busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  teams: BackfillTeam[];
  lang: string;
  file: BackfillFile | null;
  onSubmit: (item: ImportItem) => Promise<void>;
  busy: boolean;
}) {
  const { t } = useLanguage();
  const [date, setDate] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [docNo, setDocNo] = useState('');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [workNote, setWorkNote] = useState('');
  const [force, setForce] = useState(false);

  const toggle = (code: string) =>
    setCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));

  const submit = () => {
    if (!date || codes.length === 0) return;
    void onSubmit({
      key: `manual:${Date.now()}`,
      file_ids: file ? [file.file_id] : [],
      report_date: date,
      team_codes: codes,
      legacy_doc_no: docNo || null,
      legacy_author_name: author || null,
      description: description || null,
      work_note: workNote || null,
      force_duplicate: force,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('asrBackfill.addManual')}</DialogTitle>
          <DialogDescription>
            {file ? t('asrBackfill.manualFromFile', { name: file.file_name }) : t('asrBackfill.manualHint')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>{t('asr.reportDate')}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>{t('asr.docNo')}</Label>
              <Input value={docNo} onChange={(e) => setDocNo(e.target.value)} className="font-mono" placeholder="ASR-BB-001" />
            </div>
          </div>
          <div>
            <Label>{t('asrBackfill.teams')}</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {teams.map((tm) => (
                <label key={tm.code} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs">
                  <Checkbox checked={codes.includes(tm.code)} onCheckedChange={() => toggle(tm.code)} />
                  {teamLabel(tm, lang)}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label>{t('asrBackfill.author')}</Label>
            <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder={t('asrBackfill.authorPlaceholder')} />
          </div>
          <div>
            <Label>{t('asr.description')}</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div>
            <Label>{t('asr.workReport')}</Label>
            <Textarea value={workNote} onChange={(e) => setWorkNote(e.target.value)} rows={3} />
          </div>
          <label className="inline-flex items-center gap-2 text-xs">
            <Checkbox checked={force} onCheckedChange={(v) => setForce(v === true)} />
            {t('asrBackfill.forceDuplicate')}
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={submit} disabled={busy || !date || codes.length === 0}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('asrBackfill.importOne')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
