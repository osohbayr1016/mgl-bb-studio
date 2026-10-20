import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Scale, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { PercentStepper } from '@/shared/components/PercentStepper';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/dialog';
import { apiFetch, ApiError } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { cn } from '@/shared/lib/utils';

/**
 * Хамтарсан ажил — өөрийгөө нэмэх (`POST /api/tasks/:id/join`, migration 0326)
 * ба оноо хуваах (`PUT /api/tasks/:id/shares`, migration 0322).
 *
 * «Би 5%-ийн таскийг хамт хийсэн → 2.5 / 2.5», «би 80%, нөгөө нь 20%», «А 30%
 * хийгээд маргааш ирсэнгүй — Б өөрийгөө нэмж үргэлжлүүлээд дараа нь хоёулаа
 * хувиа тохирно».  Явцын %-д ОГТ нөлөөлөхгүй — зөвхөн leaderboard-ийн оноо
 * хуваагдана, таск бүхэлдээ (өмнө олгогдсон оноо ч дахин хуваагдана).
 *
 * Нэгдэх үед хувь АВТОМАТААР: таскийн хийгдсэн явц одоогийн хариуцагчид,
 * үлдсэн хувь шинэ хүнд («80% хийгдсэн → 20%», 50/50 биш) — сервер
 * `autoJoinSplit`-ээр бичнэ, энд зөвхөн toast + «хүн нэмэх» урьдчилан бөглөлт
 * ижил дүрмээр (`splitByRemaining`).
 *
 * Эрх нь бүхэлдээ серверээс (`can_edit` / `can_add_others` / `can_join`), энд
 * зөвхөн UI-г түгжинэ:
 *   • оролцогч биш ажилтан — «Өөрийгөө нэмэх» товч л;
 *   • өөрөө нэгдсэн хамтрагч — хувийн тоог засна, хүн нэмж/хасахгүй;
 *   • эзэн, admin/senior — бүгд.
 *
 * Жагсаалтыг dialog НЭЭГДСЭН үед л татна (`enabled: open`).
 */

interface ShareRowApi {
  user_id: number;
  full_name: string;
  share_percent: number;
  is_owner: boolean;
  added_to_assignees: boolean;
}

interface MemberApi {
  user_id: number;
  full_name: string;
  is_owner: boolean;
  self_joined: boolean;
}

interface SharesResponse {
  task_id: number;
  task_name: string;
  shares: ShareRowApi[];
  owners: Array<{ user_id: number; full_name: string }>;
  /** Таск дээр байгаа бүх хүн (эзэд + хуваалтын мөр + өөрөө нэгдсэн). */
  members: MemberApi[];
  is_member: boolean;
  is_owner: boolean;
  can_edit: boolean;
  can_add_others: boolean;
  can_join: boolean;
  has_split: boolean;
  /** Сүүлийн батлагдсан явц (0–100) — автомат хуваалтын суурь. */
  progress_pct: number;
  candidates: Array<{
    id: number;
    full_name: string;
    position: string | null;
    team_code: string | null;
  }>;
}

type JoinResponse = SharesResponse & {
  joined: boolean;
  claimed: boolean;
  /** Сервер автоматаар хуваасан бол: хийгдсэн % ба надад ногдсон %. */
  auto_split: { done: number; mine: number } | null;
};

interface EditRow {
  user_id: number;
  full_name: string;
  /** string — хоосон/хагас бичсэн төлөвийг хадгална. */
  pct: string;
  is_owner: boolean;
  self_joined: boolean;
}

/** Хувийг 2 орны нарийвчлалтай тэнцүү хуваана; үлдэгдлийг эхний мөрөнд
 *  нэмж нийлбэрийг яг 100 болгоно (33.33 + 33.33 + 33.34). */
function equalize(n: number): string[] {
  if (n <= 0) return [];
  const base = Math.floor((100 / n) * 100) / 100;
  const out = Array<number>(n).fill(base);
  out[0] = Math.round((100 - base * (n - 1)) * 100) / 100;
  return out.map((v) => String(v));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Серверийн `autoJoinSplit`-ийн UI хос: одоо байгаа мөрүүд `done`-ыг одоогийн
 *  хувиараа (бүгд 0/хоосон бол тэнцүү) авч үлдэнэ, шинэ мөр `100 − done`.
 *  0 < done < 100 биш бол null — дуудагч тэнцүү хуваалт руу буцна. */
function splitByRemaining(rows: EditRow[], newcomerId: number, done: number): EditRow[] | null {
  if (!Number.isFinite(done) || done <= 0 || done >= 100) return null;
  const existing = rows.filter((r) => r.user_id !== newcomerId);
  const newcomer = rows.find((r) => r.user_id === newcomerId);
  if (existing.length === 0 || !newcomer) return null;
  const d = round2(done);
  const remaining = round2(100 - d);
  const current = existing.map((r) => Math.max(0, parseFloat(r.pct) || 0));
  const hasWeights = current.some((v) => v > 0);
  const weights = hasWeights ? current : current.map(() => 1);
  const totalW = weights.reduce((a, b) => a + b, 0);
  const pcts = weights.map((w) => round2((d * w) / totalW));
  const diff = round2(d - pcts.reduce((a, b) => a + b, 0));
  if (diff !== 0) {
    let bi = 0;
    pcts.forEach((v, i) => {
      if (v > (pcts[bi] ?? 0)) bi = i;
    });
    pcts[bi] = round2((pcts[bi] ?? 0) + diff);
  }
  return [
    ...existing.map((r, i) => ({ ...r, pct: String(pcts[i] ?? 0) })),
    { ...newcomer, pct: String(remaining) },
  ];
}

export default function TaskSharesDialog({
  taskId,
  taskName,
  open,
  onOpenChange,
  onSaved,
}: {
  taskId: number;
  taskName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const queryKey = ['/tasks', taskId, 'shares'];
  const query = useApiQuery<SharesResponse>(queryKey, `/tasks/${taskId}/shares`, {
    enabled: open,
  });

  const [rows, setRows] = useState<EditRow[]>([]);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [joining, setJoining] = useState(false);
  const [dirty, setDirty] = useState(false);
  /** Дөнгөж нэгдсэн бөгөөд таск дээр хуваалт аль хэдийн байсан — хувиа
   *  хадгалтал оноо хуучин хуваалтаар очно гэдгийг анхааруулна. */
  const [joinedIntoSplit, setJoinedIntoSplit] = useState(false);

  // Серверийн төлөв ирэхэд маягтыг дүүргэнэ: хуваалт байвал түүгээр (мөргүй
  // оролцогч 0%-тэй ард нь), үгүй бол бүх оролцогч тэнцүү (нэг хүн = 100).
  useEffect(() => {
    if (!open) {
      setRows([]);
      setQ('');
      setDirty(false);
      setJoinedIntoSplit(false);
      return;
    }
    const data = query.data;
    if (!data || dirty) return;
    const memberById = new Map(data.members.map((m) => [m.user_id, m]));
    if (data.shares.length > 0) {
      const inShares = new Set(data.shares.map((s) => s.user_id));
      setRows([
        ...data.shares.map((s) => ({
          user_id: s.user_id,
          full_name: s.full_name,
          pct: String(s.share_percent),
          is_owner: s.is_owner,
          self_joined: memberById.get(s.user_id)?.self_joined ?? false,
        })),
        ...data.members
          .filter((m) => !inShares.has(m.user_id))
          .map((m) => ({
            user_id: m.user_id,
            full_name: m.full_name,
            pct: '0',
            is_owner: m.is_owner,
            self_joined: m.self_joined,
          })),
      ]);
    } else {
      const eq = equalize(data.members.length);
      setRows(
        data.members.map((m, i) => ({
          user_id: m.user_id,
          full_name: m.full_name,
          pct: eq[i] ?? '0',
          is_owner: m.is_owner,
          self_joined: m.self_joined,
        })),
      );
    }
  }, [open, query.data, dirty]);

  const canEdit = query.data?.can_edit ?? false;
  const canAddOthers = query.data?.can_add_others ?? false;
  const canJoin = query.data?.can_join ?? false;
  const hasSplit = query.data?.has_split ?? false;
  const memberCount = query.data?.members.length ?? 0;
  const progressPct = query.data?.progress_pct ?? 0;

  const total = useMemo(
    () => rows.reduce((s, r) => s + (Number.isFinite(parseFloat(r.pct)) ? parseFloat(r.pct) : 0), 0),
    [rows],
  );
  const totalOk = Math.abs(total - 100) < 0.011;
  const rowsValid = rows.every((r) => {
    const v = parseFloat(r.pct);
    return Number.isFinite(v) && v >= 0 && v <= 100;
  });

  const inRows = useMemo(() => new Set(rows.map((r) => r.user_id)), [rows]);
  const candidates = useMemo(() => {
    const list = (query.data?.candidates ?? []).filter((c) => !inRows.has(c.id));
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (c) =>
        c.full_name.toLowerCase().includes(needle) ||
        (c.position ?? '').toLowerCase().includes(needle) ||
        (c.team_code ?? '').toLowerCase().includes(needle),
    );
  }, [query.data?.candidates, inRows, q]);

  const patchPct = (userId: number, pct: string) => {
    setDirty(true);
    setRows((prev) => prev.map((r) => (r.user_id === userId ? { ...r, pct } : r)));
  };

  // Шинэ хүн: хийгдсэн явц одоо байгаа мөрүүдэд, үлдсэн нь шинэ хүнд (сервер
  // нэгдэх үед яг ингэж хуваадаг); явц 0/100 бол тэнцүү.
  const addPerson = (c: { id: number; full_name: string }) => {
    setDirty(true);
    setRows((prev) => {
      const next = [
        ...prev,
        { user_id: c.id, full_name: c.full_name, pct: '0', is_owner: false, self_joined: false },
      ];
      const byRemaining = splitByRemaining(next, c.id, progressPct);
      if (byRemaining) return byRemaining;
      const eq = equalize(next.length);
      return next.map((r, i) => ({ ...r, pct: eq[i] ?? '0' }));
    });
    setQ('');
  };

  const removePerson = (userId: number) => {
    setDirty(true);
    setRows((prev) => {
      const next = prev.filter((r) => r.user_id !== userId);
      const eq = equalize(next.length);
      return next.map((r, i) => ({ ...r, pct: eq[i] ?? '0' }));
    });
  };

  const equalizeAll = () => {
    setDirty(true);
    setRows((prev) => {
      const eq = equalize(prev.length);
      return prev.map((r, i) => ({ ...r, pct: eq[i] ?? '0' }));
    });
  };

  const errorMessage = (err: unknown, fallback: string) =>
    err instanceof ApiError && typeof err.payload.message === 'string' ? err.payload.message : fallback;

  // Өөрийгөө нэмэх: dialog ХААГДАХГҮЙ — нэгдмэгц хувиа тохирох мөрүүд гарна.
  const join = async () => {
    setJoining(true);
    try {
      const res = await apiFetch<JoinResponse>(`/tasks/${taskId}/join`, { method: 'POST', data: {} });
      setDirty(false);
      // Сервер автоматаар хуваасан бол хуучин хуваалтын анхааруулга хэрэггүй.
      setJoinedIntoSplit(res.joined && res.has_split && !res.auto_split);
      await qc.invalidateQueries({ queryKey });
      toast.success(
        res.claimed
          ? t('taskShares.claimed')
          : res.auto_split
            ? t('taskShares.joinedAuto', { done: res.auto_split.done, mine: res.auto_split.mine })
            : t('taskShares.joined'),
      );
      onSaved?.();
    } catch (err) {
      toast.error(t('common.error'), errorMessage(err, t('common.saveFailed')));
    } finally {
      setJoining(false);
    }
  };

  const save = async (shares: Array<{ user_id: number; share_percent: number }>) => {
    setSaving(true);
    try {
      await apiFetch(`/tasks/${taskId}/shares`, { method: 'PUT', data: { shares } });
      await qc.invalidateQueries({ queryKey });
      toast.success(t('common.saved'));
      setDirty(false);
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(t('common.error'), errorMessage(err, t('common.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    if (!totalOk || !rowsValid || rows.length === 0) return;
    // Нэг хүн 100% = хуваалтгүйтэй ижил → хүснэгтийг цэвэрлэнэ (эзэн л чадна;
    // өөрөө нэгдсэн хүн ганцаараа үлдсэн бол жагсаалт өөрчлөгдөхгүй тул
    // 100%-ийн мөрөө хэвээр илгээнэ).
    if (rows.length === 1 && parseFloat(rows[0]!.pct) >= 100 && canAddOthers) {
      void save([]);
      return;
    }
    void save(
      rows.map((r) => ({
        user_id: r.user_id,
        share_percent: Math.round(parseFloat(r.pct) * 100) / 100,
      })),
    );
  };

  const busy = saving || joining;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" />
            {t('taskShares.title')}
          </DialogTitle>
          <p className="text-xs text-muted-foreground break-words">{taskName}</p>
        </DialogHeader>

        {query.isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : query.isError ? (
          <p className="text-sm text-destructive">{t('common.error')}</p>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">{t('taskShares.explain')}</p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {t('taskShares.progressLine', { pct: round2(progressPct) })}
            </p>

            {/* Оролцогч биш ажилтан: өөрийгөө нэмэх */}
            {canJoin && (
              <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                <div className="text-sm font-medium">
                  {memberCount === 0 ? t('taskShares.joinTitleUnassigned') : t('taskShares.joinTitle')}
                </div>
                <p className="text-xs text-muted-foreground">
                  {progressPct > 0 && progressPct < 100
                    ? t('taskShares.joinExplainAuto', {
                        done: round2(progressPct),
                        remaining: round2(100 - progressPct),
                      })
                    : t('taskShares.joinExplain')}
                </p>
                <Button size="sm" className="gap-1.5" onClick={() => void join()} disabled={busy}>
                  {joining ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <UserPlus className="h-3.5 w-3.5" />
                  )}
                  {t('taskShares.joinBtn')}
                </Button>
              </div>
            )}

            {joinedIntoSplit && (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
                {t('taskShares.joinedSplitWarn')}
              </p>
            )}

            {/* Хүмүүс + хувь */}
            <ul className="divide-y divide-border/60 rounded-md border">
              {rows.map((r) => (
                <li key={r.user_id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {formatDisplayName(r.full_name)}
                    </div>
                    {r.is_owner ? (
                      <div className="text-[10px] text-muted-foreground">
                        {t('taskShares.ownerTag')}
                      </div>
                    ) : r.self_joined ? (
                      <div className="text-[10px] text-muted-foreground">
                        {t('taskShares.joinedTag')}
                      </div>
                    ) : null}
                  </div>
                  <PercentStepper
                    value={r.pct}
                    onChange={(v) => patchPct(r.user_id, v)}
                    disabled={!canEdit || busy}
                    ariaLabel={t('taskShares.pctFor', { name: formatDisplayName(r.full_name) })}
                  />
                  {canAddOthers && !r.is_owner && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removePerson(r.user_id)}
                      disabled={busy}
                      title={t('taskShares.remove')}
                      aria-label={t('taskShares.remove')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              ))}
              {rows.length === 0 && (
                <li className="px-3 py-3 text-xs text-muted-foreground">{t('taskShares.noOwner')}</li>
              )}
            </ul>

            {/* Хуваалт хадгалагдаагүй → оноо явц илгээсэн хүнд */}
            {!hasSplit && memberCount > 1 && (
              <p className="text-xs text-muted-foreground">{t('taskShares.noSplitHint')}</p>
            )}

            {/* Нийлбэр */}
            <div className="flex items-center justify-between text-xs">
              <span className={cn('tabular-nums', totalOk ? 'text-muted-foreground' : 'text-destructive')}>
                {t('taskShares.total', { total: Math.round(total * 100) / 100 })}
                {!totalOk && ` — ${t('taskShares.mustBe100')}`}
              </span>
              {canEdit && rows.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={equalizeAll}
                  disabled={busy}
                >
                  <Scale className="h-3 w-3" />
                  {t('taskShares.equalize')}
                </Button>
              )}
            </div>

            {/* Хүн нэмэх — эзэн / удирдлага л */}
            {canAddOthers && rows.length < 6 && (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t('taskShares.addPlaceholder')}
                    className="h-8 pl-7 text-sm"
                    disabled={busy}
                  />
                </div>
                <ul className="max-h-40 overflow-y-auto rounded-md border divide-y divide-border/60">
                  {candidates.length === 0 ? (
                    <li className="px-3 py-2 text-xs text-muted-foreground">
                      {t('taskShares.noCandidates')}
                    </li>
                  ) : (
                    candidates.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => addPerson(c)}
                          disabled={busy}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/60"
                        >
                          <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{formatDisplayName(c.full_name)}</span>
                          {c.team_code && (
                            <span className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground">
                              {c.team_code}
                            </span>
                          )}
                          {c.position && (
                            <span className="ml-auto truncate text-[11px] text-muted-foreground">
                              {c.position}
                            </span>
                          )}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}

            {canEdit && !canAddOthers && (
              <p className="text-xs text-muted-foreground">{t('taskShares.collaboratorHint')}</p>
            )}
            {!canEdit && !canJoin && (
              <p className="text-xs text-muted-foreground">{t('taskShares.readOnly')}</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {canAddOthers && hasSplit && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => void save([])}
                disabled={busy}
              >
                {t('taskShares.clear')}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            {canEdit && (
              <Button
                size="sm"
                onClick={submit}
                disabled={busy || !totalOk || !rowsValid || rows.length === 0}
              >
                {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                {t('common.save')}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
