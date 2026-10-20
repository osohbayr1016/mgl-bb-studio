import { useState } from 'react';
import { Building2, Loader2, Trash2, Archive, ArchiveRestore, Plus, RefreshCcw } from 'lucide-react';

import { apiFetch, ApiError } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import type { RepairProject } from '@/shared/types';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Progress } from '@/ui/progress';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';

/**
 * Батлах хуудасны «Засвар» табын дээрх админы удирдах хэсэг — ДОТООД АЖЛУУД
 * (`repair_projects`, миграци 0194).
 *
 * Эдгээр нь ЖИНХЭНЭ төсөл БИШ: `projects` хүснэгтэд ордоггүй тул Төслүүд
 * хуудас, хянах самбар, Timeline, компанийн тойм, MCP, глобал хайлтад хаана ч
 * гарахгүй.  Зөвхөн my-tasks дэх «Засвар бүртгэх» цонхонд сонголт болж гарна.
 *
 * Энд хийх зүйл нь ганцхан: НЭР.  Ажилтны авах хувь нь бүрэн автомат —
 * түүний өдрийн дундаж хувь × (зарцуулсан цаг / 8).  Дотоод ажил бүр цаг
 * тутамдаа ижил үнэтэй (эзний шийдвэр, 2026-08-25) тул админд тохируулах
 * дугуй БАЙХГҮЙ.
 *
 * ЯВЦ (миграци 0339, эзний шийдвэр 2026-09-21): хэн ч гараар хувь өгөхгүй.
 * Шинэ дотоод ажил 0%-иас эхэлж, ажилтан бүрийн цагийн бүртгэл × түүний
 * өдрийн дундаж төслийн-% нийлж 100 хүртэл өснө (`progress`, сервер бодно).
 * «Явц нөхөж тооцох» нь 0339-оос ӨМНӨХ бүртгэлүүдэд явцын хувийг мөр бүрийн
 * огноогоор нөхөж бодно — идемпотент, хэдэн ч удаа дарж болно.
 *
 * ⚠️ Устгах нь зөвхөн бүртгэлгүй мөрөнд.  `repair_entries` нь нэрийн хуулбар
 * авдаггүй, зөвхөн FK хадгалдаг тул бүртгэлтэй мөрийг устгавал бүх түүхэн
 * бичлэг нэрээ алдана — сервер тал 409 буцаана, оронд нь архивлана.
 */
export function RepairProjectsPanel({ onChanged }: { onChanged?: () => void }) {
  const { t } = useLanguage();
  const [showArchived, setShowArchived] = useState(false);
  const query = useApiQuery<{ items: RepairProject[] }>(
    showArchived ? '/repair/projects?include_archived=1' : '/repair/projects',
  );
  const items = query.data?.items ?? [];

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  // Хянагдаж буй засварууд — зөвхөн ӨӨРЧЛӨГДСӨН талбарыг PATCH-д илгээнэ.
  const [drafts, setDrafts] = useState<Record<number, { name?: string }>>({});

  const draftOf = (p: RepairProject) => ({ name: drafts[p.id]?.name ?? p.name });
  const isDirty = (p: RepairProject) => draftOf(p).name.trim() !== p.name;

  /** Хуучин ZA хувийн бөглөлтөөс цаг нөхөх ажлын үлдэгдэл (0348).  Cron өөрөө
   *  бага багаар нөхдөг — энэ нь үлдсэнийг ШУУД дуусгах товчны тоолуур. */
  const hoursBackfillQuery = useApiQuery<{ pending_entries: number; pending_days: number }>(
    '/repair/hours-backfill',
  );
  const pendingDays = hoursBackfillQuery.data?.pending_days ?? 0;
  const [hoursBackfilling, setHoursBackfilling] = useState(false);
  /** Үлдэгдэл 0 болтол хэсэгчлэн дуудна (сервер нэг дуудлагад ≤15 ажилтан-өдөр —
   *  D1-ийн ≤1000 асуулгын хязгаар).  Нэг ч өдөр ахиагүй бол зогсоно. */
  const runHoursBackfill = async () => {
    if (hoursBackfilling) return;
    setHoursBackfilling(true);
    let done = 0;
    try {
      for (let i = 0; i < 100; i++) {
        const res = await apiFetch<{ days: number; marks: number; remaining_days: number }>(
          '/repair/hours-backfill',
          { method: 'POST' },
        );
        done += res?.days ?? 0;
        if (!res || res.remaining_days === 0 || res.days === 0) break;
      }
      toast.success(t('repair.hoursBackfillDone', { days: done }));
      await Promise.all([hoursBackfillQuery.refetch(), query.refetch()]);
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('repair.adminSaveFailed'));
    } finally {
      setHoursBackfilling(false);
    }
  };

  const [backfilling, setBackfilling] = useState(false);
  /** 0339-оос өмнөх бүртгэлүүдийн явцын хувийг нөхөж бодуулна (сервер
   *  `progress_rate_source IS NULL` мөрийг л — идемпотент). */
  const backfill = async () => {
    if (backfilling) return;
    setBackfilling(true);
    try {
      const res = await apiFetch<{ scanned: number; updated: number; remaining: number }>(
        '/repair/backfill-progress',
        { method: 'POST' },
      );
      toast.success(
        t('repair.progressBackfillDone', { updated: res?.updated ?? 0, remaining: res?.remaining ?? 0 }),
      );
      await query.refetch();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('repair.adminSaveFailed'));
    } finally {
      setBackfilling(false);
    }
  };

  /** Шинэ дотоод ажил үүсгэнэ.  `projects`-т мөр НЭМДЭГГҮЙ — зөвхөн
   *  `repair_projects`-д ордог тул Төслүүд хуудсанд хэзээ ч гарахгүй. */
  const create = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      await apiFetch('/repair/projects', { method: 'POST', data: { name } });
      setNewName('');
      toast.success(t('repair.projectCreated', { name }));
      await query.refetch();
      onChanged?.();
    } catch (err) {
      // Ижил нэр давхардвал сервер 409 + тайлбар буцаана.
      toast.error(err instanceof ApiError ? err.message : t('repair.projectCreateFailed'));
    } finally {
      setCreating(false);
    }
  };

  const patch = async (p: RepairProject, body: Record<string, unknown>) => {
    setBusyId(p.id);
    try {
      await apiFetch(`/repair/projects/${p.id}`, { method: 'PATCH', data: body });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      toast.success(t('repair.adminSaved'));
      await query.refetch();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('repair.adminSaveFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const save = (p: RepairProject) => {
    const d = draftOf(p);
    const name = d.name.trim();
    if (!name) return;
    return patch(p, { name });
  };

  const remove = async (p: RepairProject) => {
    if (
      !(await confirmDialog({
        description: t('repair.adminDeleteConfirm'),
        variant: 'destructive',
        confirmText: t('common.delete'),
      }))
    )
      return;
    setBusyId(p.id);
    try {
      await apiFetch(`/repair/projects/${p.id}`, { method: 'DELETE' });
      toast.success(t('repair.deleted'));
      await query.refetch();
      onChanged?.();
    } catch (err) {
      // Бүртгэлтэй бол сервер 409 + тайлбар буцаана — тэрийг шууд харуулна.
      toast.error(err instanceof ApiError ? err.message : t('repair.adminSaveFailed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="mb-3">
      <CardContent className="p-3 md:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Building2 className="h-4 w-4 text-primary-ink" aria-hidden />
            <span className="text-body font-medium text-foreground">
              {t('repair.adminManageTitle')}
            </span>
            <span className="text-micro text-muted-foreground">{t('repair.adminManageHint')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {/* Хуучин ZA хувийн бөглөлт → цаг (0348).  Үлдэгдэлгүй бол зөвхөн
                тэмдэглэл — товч хэрэггүй. */}
            {pendingDays > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs"
                disabled={hoursBackfilling}
                title={t('repair.hoursBackfillHint')}
                onClick={() => void runHoursBackfill()}
                data-testid="repair-hours-backfill"
              >
                {hoursBackfilling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="h-3.5 w-3.5" />
                )}
                {t('repair.hoursBackfill')}
                <span className="tabular-nums text-muted-foreground">
                  · {t('repair.hoursBackfillPending', { days: pendingDays })}
                </span>
              </Button>
            ) : hoursBackfillQuery.data ? (
              <span className="text-micro text-muted-foreground" data-testid="repair-hours-backfill-complete">
                {t('repair.hoursBackfillComplete')}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs"
              disabled={backfilling}
              title={t('repair.progressBackfillHint')}
              onClick={() => void backfill()}
            >
              {backfilling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="h-3.5 w-3.5" />
              )}
              {t('repair.progressBackfill')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setShowArchived((v) => !v)}
            >
              {t('repair.adminShowArchived')}
            </Button>
          </div>
        </div>

        {/* Шинээр нэмэх — нээлттэй текст талбар.  Админ юмаа бичээд «Нэмэх»
            дармагц доорх жагсаалтад гарч ирнэ, мөн ажилтны «Засвар бүртгэх»
            цонхны «Дотоод ажил» бүлэгт нэмэгдэнэ. */}
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-2.5">
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
            aria-label={t('repair.adminManageTitle')}
            className="h-9 min-w-48 flex-1"
          />
          <Button
            type="button"
            size="sm"
            className="h-9 shrink-0 gap-1.5"
            disabled={!newName.trim() || creating}
            onClick={() => void create()}
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('repair.newProjectAdd')}
          </Button>
        </div>

        {query.isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t('repair.adminManageEmpty')}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border/60">
            {items.map((p) => {
              const d = draftOf(p);
              const busy = busyId === p.id;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Input
                    value={d.name}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [p.id]: { ...prev[p.id], name: e.target.value },
                      }))
                    }
                    className="h-8 min-w-40 flex-1"
                    aria-label={t('repair.adminColProject')}
                  />
                  {/* Явц — цагийн бүртгэлээс (0339).  Гараар засах талбар БАЙХГҮЙ. */}
                  <div
                    className="flex w-36 shrink-0 items-center gap-2"
                    title={t('repair.progressHoursHint')}
                    data-testid="repair-project-progress"
                  >
                    <Progress value={Math.min(100, p.progress ?? 0)} className="h-1.5 flex-1" />
                    <span className="w-12 text-right text-xs font-semibold tabular-nums text-foreground">
                      {Math.round((p.progress ?? 0) * 10) / 10}%
                    </span>
                  </div>
                  {/* Ажилласан цаг + хүний тоо (2026-09-24) — засварын ажил цагаар. */}
                  <span
                    className="shrink-0 text-xs font-semibold tabular-nums text-foreground"
                    data-testid="repair-project-hours"
                  >
                    {t('repair.hoursValue', { hours: p.total_hours ?? 0 })}
                    <span className="ml-1 font-normal text-muted-foreground">
                      · {t('repair.hoursPeopleCount', { count: p.people_count ?? 0 })}
                    </span>
                  </span>
                  <span className="shrink-0 text-micro tabular-nums text-muted-foreground">
                    {t('repair.adminColEntries')}: {p.entry_count ?? 0}
                  </span>
                  {p.status === 'archived' && (
                    <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-micro text-muted-foreground">
                      {t('repair.adminArchived')}
                    </span>
                  )}
                  <Button
                    size="sm"
                    className="h-8 shrink-0"
                    disabled={busy || !isDirty(p) || !d.name.trim()}
                    onClick={() => void save(p)}
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('common.save')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground"
                    disabled={busy}
                    title={
                      p.status === 'archived'
                        ? t('repair.adminUnarchive')
                        : t('repair.adminArchive')
                    }
                    aria-label={
                      p.status === 'archived'
                        ? t('repair.adminUnarchive')
                        : t('repair.adminArchive')
                    }
                    onClick={() =>
                      void patch(p, { status: p.status === 'archived' ? 'active' : 'archived' })
                    }
                  >
                    {p.status === 'archived' ? (
                      <ArchiveRestore className="h-3.5 w-3.5" />
                    ) : (
                      <Archive className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    aria-label={t('common.delete')}
                    onClick={() => void remove(p)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
