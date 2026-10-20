import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ListChecks,
  Save,
  Printer,
  Loader2,
  CheckCircle2,
  CircleDashed,
  Search,
  X,
  Pencil,
  Trash2,
  Plus,
  FolderPlus,
} from 'lucide-react';
import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import { useAuth } from '@/shared/context/AuthContext';
import { useIsAdminTier } from '@/shared/lib/score';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Label } from '@/ui/label';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/ui/accordion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { cn } from '@/shared/lib/utils';
import { Checkbox } from '@/ui/checkbox';
import {
  NORM_CATALOG_KEY,
  type NormCatalogCategory,
  type NormCatalogItem,
  type NormCatalogResponse,
} from '@/features/projects/team-reports/norm/catalogApi';

/* =============================================================
 * NormPanel — төслийн нэгдсэн "Норм дүрэм" таб.
 * -------------------------------------------------------------
 * Каталог (ангилал + БНбД жагсаалт) нь DB-д (migration 0120), эндээс
 * fetch хийнэ. Бүх ажилтан төсөлдөө мөрдөх нормоо checkbox-оор тэмдэглэнэ
 * (project_team_reports, team_code='NORM'). Нэмэлтээр admin/senior каталогийг
 * inline засах ("Норм засах" горим): admin нэм/зас/устга, senior зас.
 *
 * Хадгалалт (checkbox): project_team_reports-д синтетик team_code='NORM'-оор.
 * ============================================================= */

export interface NormAnswers {
  checked?: Record<string, boolean>;
  other?: string;
}

interface NormReportResponse {
  report: { answers: NormAnswers | null } | null;
}

const QUERY_KEY = (projectId: number) =>
  ['/projects/team-reports', projectId, 'NORM'] as const;

export function NormPanel({
  projectId,
  readOnly = false,
}: {
  projectId: number;
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = useIsAdminTier();
  // requireManager() mirror — admin tier + senior каталог засна.
  const isManager = !!user && (user.role === 'admin' || user.role === 'senior');
  const canEdit = isManager && !readOnly;

  const reportQuery = useApiQuery<NormReportResponse>(
    QUERY_KEY(projectId),
    `/projects/${projectId}/team-reports/NORM`,
    { enabled: !!projectId },
  );
  // Каталог ховор өөрчлөгддөг тул бүрэн cache (TeamReportShell overrides-тэй ижил).
  const catalogQuery = useApiQuery<NormCatalogResponse>(NORM_CATALOG_KEY, '/norm-catalog', {
    staleTime: Infinity,
    retry: false,
  });
  const catalog = catalogQuery.data?.catalog ?? [];

  const [answers, setAnswers] = useState<NormAnswers>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [editMode, setEditMode] = useState(false);

  // Seed from server unless the user has unsaved edits (mirror TeamReportShell).
  useEffect(() => {
    const r = reportQuery.data?.report;
    if (!r || dirty) return;
    setAnswers((r.answers ?? {}) as NormAnswers);
  }, [reportQuery.data, dirty]);

  useEffect(() => {
    if (reportQuery.error) {
      toast.error('Норм дүрэм ачаалж чадсангүй', reportQuery.error.message);
    }
  }, [reportQuery.error]);

  const checked = answers.checked ?? {};

  const toggle = (key: string) => {
    if (readOnly) return;
    setAnswers((prev) => ({
      ...prev,
      checked: { ...(prev.checked ?? {}), [key]: !(prev.checked ?? {})[key] },
    }));
    setDirty(true);
  };

  const setCategory = (keys: string[], value: boolean) => {
    if (readOnly) return;
    setAnswers((prev) => {
      const next = { ...(prev.checked ?? {}) };
      for (const k of keys) next[k] = value;
      return { ...prev, checked: next };
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ report: { answers: NormAnswers | null } }>(
        `/projects/${projectId}/team-reports/NORM`,
        { method: 'PUT', data: { building_type: null, answers } },
      );
      if (res.report) setAnswers((res.report.answers ?? {}) as NormAnswers);
      setDirty(false);
      queryClient.setQueryData(QUERY_KEY(projectId), { report: res.report });
      queryClient.invalidateQueries({ queryKey: ['/projects/team-reports', projectId] });
      toast.success('Хадгалагдлаа');
    } catch (e) {
      toast.error('Хадгалж чадсангүй', e instanceof Error ? e.message : 'Алдаа гарлаа');
    } finally {
      setSaving(false);
    }
  };

  const openPrintView = () => {
    if (dirty) {
      toast.warn('Эхлээд хадгална уу', 'Хэвлэхээс өмнө өөрчлөлтүүдээ хадгалах шаардлагатай.');
      return;
    }
    window.open(
      `/app/projects/${projectId}/team-reports/NORM/print?mode=client`,
      '_blank',
      'noopener',
    );
  };

  // ── Каталог засах (mutations) ──────────────────────────────
  const refreshCatalog = () =>
    queryClient.invalidateQueries({ queryKey: NORM_CATALOG_KEY });

  const [busy, setBusy] = useState(false);
  // Норм нэмэх/засах dialog.
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<NormCatalogItem | null>(null);
  const [itemForm, setItemForm] = useState<{ categoryId: string; code: string; title: string }>({
    categoryId: '',
    code: '',
    title: '',
  });
  // Ангилал нэмэх/засах dialog.
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<NormCatalogCategory | null>(null);
  const [catTitle, setCatTitle] = useState('');
  // Устгах баталгаа.
  const [deleteItem, setDeleteItem] = useState<NormCatalogItem | null>(null);
  const [deleteCat, setDeleteCat] = useState<NormCatalogCategory | null>(null);

  const openAddItem = (categoryId: number) => {
    setEditingItem(null);
    setItemForm({ categoryId: String(categoryId), code: '', title: '' });
    setItemDialogOpen(true);
  };
  const openEditItem = (item: NormCatalogItem, categoryId: number) => {
    setEditingItem(item);
    setItemForm({ categoryId: String(categoryId), code: item.code, title: item.title });
    setItemDialogOpen(true);
  };
  const submitItem = async () => {
    const code = itemForm.code.trim();
    const title = itemForm.title.trim();
    const categoryId = Number(itemForm.categoryId);
    if (!code || !title || !Number.isInteger(categoryId)) return;
    setBusy(true);
    try {
      if (editingItem) {
        await apiFetch(`/norm-catalog/items/${editingItem.id}`, {
          method: 'PATCH',
          data: { code, title, category_id: categoryId },
        });
        toast.success('Норм шинэчлэгдлээ');
      } else {
        await apiFetch('/norm-catalog/items', {
          method: 'POST',
          data: { category_id: categoryId, code, title },
        });
        toast.success('Норм нэмэгдлээ');
      }
      setItemDialogOpen(false);
      await refreshCatalog();
    } catch (e) {
      toast.error('Хадгалж чадсангүй', e instanceof Error ? e.message : 'Алдаа гарлаа');
    } finally {
      setBusy(false);
    }
  };

  const openAddCat = () => {
    setEditingCat(null);
    setCatTitle('');
    setCatDialogOpen(true);
  };
  const openEditCat = (cat: NormCatalogCategory) => {
    setEditingCat(cat);
    setCatTitle(cat.title);
    setCatDialogOpen(true);
  };
  const submitCat = async () => {
    const title = catTitle.trim();
    if (!title) return;
    setBusy(true);
    try {
      if (editingCat) {
        await apiFetch(`/norm-catalog/categories/${editingCat.id}`, {
          method: 'PATCH',
          data: { title },
        });
        toast.success('Ангилал шинэчлэгдлээ');
      } else {
        await apiFetch('/norm-catalog/categories', { method: 'POST', data: { title } });
        toast.success('Ангилал нэмэгдлээ');
      }
      setCatDialogOpen(false);
      await refreshCatalog();
    } catch (e) {
      toast.error('Хадгалж чадсангүй', e instanceof Error ? e.message : 'Алдаа гарлаа');
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteItem = async () => {
    if (!deleteItem) return;
    setBusy(true);
    try {
      await apiFetch(`/norm-catalog/items/${deleteItem.id}`, { method: 'DELETE' });
      toast.success('Норм устгагдлаа');
      setDeleteItem(null);
      await refreshCatalog();
    } catch (e) {
      toast.error('Устгаж чадсангүй', e instanceof Error ? e.message : 'Алдаа гарлаа');
    } finally {
      setBusy(false);
    }
  };
  const confirmDeleteCat = async () => {
    if (!deleteCat) return;
    setBusy(true);
    try {
      await apiFetch(`/norm-catalog/categories/${deleteCat.id}`, { method: 'DELETE' });
      toast.success('Ангилал устгагдлаа');
      setDeleteCat(null);
      await refreshCatalog();
    } catch (e) {
      toast.error('Устгаж чадсангүй', e instanceof Error ? e.message : 'Алдаа гарлаа');
    } finally {
      setBusy(false);
    }
  };

  // Search filters which rows DISPLAY — never mutates `checked` state.
  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      catalog
        .map((cat) => ({
          ...cat,
          items: q
            ? cat.items.filter(
                (it) =>
                  it.code.toLowerCase().includes(q) || it.title.toLowerCase().includes(q),
              )
            : cat.items,
        }))
        // Засах горимд хоосон ангилал ч харагдана (устгах/нэмэхэд хэрэгтэй).
        .filter((cat) => cat.items.length > 0 || (editMode && !q)),
    [catalog, q, editMode],
  );

  const totalChecked = useMemo(
    () => catalog.reduce((n, c) => n + c.items.filter((it) => checked[it.key]).length, 0),
    [catalog, checked],
  );

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
    <div className="space-y-4">
      {/* Hero card — brand accent (баг биш тул багийн өнгө ашиглахгүй). */}
      <Card className="overflow-hidden border-border/40 shadow-sm">
        <div className="h-1 w-full bg-primary/70" />
        <CardContent className="py-4 sm:py-5">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Badge variant="outline" className="gap-1.5 text-xs font-semibold px-2.5 py-1">
                <ListChecks className="w-3.5 h-3.5" /> НД
              </Badge>
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-tight truncate">Норм дүрэм</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Мөрдөж буй БНбД-г тэмдэглэнэ · нийт {totalChecked} сонгосон
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {!readOnly && !editMode && stateChip}
              {canEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant={editMode ? 'default' : 'outline'}
                  onClick={() => setEditMode((v) => !v)}
                  title="Каталогийн норм, ангиллыг засах"
                >
                  <Pencil className="w-4 h-4 mr-1.5" /> Норм засах
                </Button>
              )}
              {!editMode && (
                <Button type="button" size="sm" variant="outline" onClick={openPrintView}>
                  <Printer className="w-4 h-4 mr-1.5" /> Тайлан харах
                </Button>
              )}
              {!readOnly && !editMode && (
                <Button type="button" size="sm" onClick={save} disabled={saving || !dirty}>
                  <Save className="w-4 h-4 mr-1.5" />
                  {saving ? 'Хадгалж байна…' : 'Хадгалах'}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/40 shadow-sm">
        <CardContent className="py-4 space-y-3">
          {/* Toolbar — search + (edit mode) шинэ ангилал. */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative max-w-sm flex-1 min-w-[180px]">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Норм хайх (код эсвэл нэр)…"
                className="pl-8 pr-8 h-8 text-xs"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Цэвэрлэх"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {editMode && isAdmin && (
              <Button type="button" size="sm" variant="outline" onClick={openAddCat}>
                <FolderPlus className="w-4 h-4 mr-1.5" /> Ангилал нэмэх
              </Button>
            )}
          </div>

          {catalogQuery.isLoading && !catalogQuery.data ? (
            <div className="py-10 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto" />
            </div>
          ) : catalogQuery.error ? (
            <p className="py-8 text-center text-sm text-destructive">
              Каталог ачаалж чадсангүй: {catalogQuery.error.message}
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {q ? 'Хайлтад тохирох норм олдсонгүй.' : 'Каталог хоосон байна.'}
            </p>
          ) : (
            <Accordion type="multiple" defaultValue={catalog.map((c) => c.key)} className="w-full">
              {filtered.map((cat) => {
                const allKeys = cat.items.map((it) => it.key);
                const checkedCount = allKeys.filter((k) => checked[k]).length;
                const allChecked = checkedCount === allKeys.length && allKeys.length > 0;
                return (
                  <AccordionItem key={cat.key} value={cat.key}>
                    <AccordionTrigger className="hover:no-underline">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-left">{cat.title}</span>
                        <Badge variant="outline" className="text-[10px] tabular-nums">
                          {checkedCount}/{cat.items.length}
                        </Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      {/* Category toolbar (edit mode). */}
                      {editMode ? (
                        <div className="mb-2 flex items-center gap-2 flex-wrap">
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => openAddItem(cat.id)}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                            >
                              <Plus className="h-3 w-3" /> Норм нэмэх
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditCat(cat)}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-3 w-3" /> Ангиллын нэр
                          </button>
                          {isAdmin && cat.items.length === 0 && (
                            <button
                              type="button"
                              onClick={() => setDeleteCat(cat)}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive hover:underline"
                            >
                              <Trash2 className="h-3 w-3" /> Ангилал устгах
                            </button>
                          )}
                        </div>
                      ) : (
                        !readOnly && (
                          <div className="mb-2">
                            <button
                              type="button"
                              onClick={() => setCategory(allKeys, !allChecked)}
                              className="text-[11px] font-medium text-primary hover:underline"
                            >
                              {allChecked ? 'Бүгдийг цэвэрлэх' : 'Бүгдийг сонгох'}
                            </button>
                          </div>
                        )
                      )}
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {cat.items.map((it) => (
                          <div key={it.key} className="flex items-start gap-1">
                            <label
                              htmlFor={`norm-${it.key}`}
                              className={cn(
                                'flex flex-1 min-w-0 items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm',
                                !readOnly && 'cursor-pointer hover:bg-muted/50',
                                checked[it.key] && 'bg-primary/5',
                              )}
                            >
                              <Checkbox
                                id={`norm-${it.key}`}
                                className="mt-0.5"
                                checked={checked[it.key] === true}
                                onCheckedChange={() => toggle(it.key)}
                                disabled={readOnly}
                              />
                              <span className="min-w-0">
                                <span className="font-medium">{it.code}</span>
                                <span className="text-muted-foreground"> — {it.title}</span>
                              </span>
                            </label>
                            {editMode && (
                              <div className="flex items-center gap-0.5 pt-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => openEditItem(it, cat.id)}
                                  className="p-1 text-muted-foreground hover:text-foreground"
                                  aria-label="Засах"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                {isAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => setDeleteItem(it)}
                                    className="p-1 text-muted-foreground hover:text-destructive"
                                    aria-label="Устгах"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}

          {/* Бусад норм — каталогт ороогүй нэмэлт. */}
          <div className="space-y-1.5 pt-2">
            <label className="text-xs font-medium text-muted-foreground">
              Бусад норм / нэмэлт тайлбар
            </label>
            <Textarea
              rows={2}
              value={answers.other ?? ''}
              onChange={(e) => {
                setAnswers((prev) => ({ ...prev, other: e.target.value }));
                setDirty(true);
              }}
              placeholder="Каталогт ороогүй норм дүрэм байвал энд бичнэ үү…"
              disabled={readOnly}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Норм нэмэх/засах dialog ── */}
      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Норм засах' : 'Норм нэмэх'}</DialogTitle>
            <DialogDescription>
              Кодыг богино дугаараар, нэрийг тодорхойлолтоор бичнэ.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Ангилал</Label>
              <Select
                value={itemForm.categoryId}
                onValueChange={(v) => setItemForm((f) => ({ ...f, categoryId: v }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Ангилал сонгох" />
                </SelectTrigger>
                <SelectContent>
                  {catalog.map((cat) => (
                    <SelectItem key={cat.id} value={String(cat.id)}>
                      {cat.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Код</Label>
              <Input
                value={itemForm.code}
                onChange={(e) => setItemForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="ж: БНбД 31-01-21"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Нэр</Label>
              <Textarea
                rows={2}
                value={itemForm.title}
                onChange={(e) => setItemForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Тайлбар нэр…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialogOpen(false)}>
              Болих
            </Button>
            <Button
              onClick={submitItem}
              disabled={
                busy ||
                !itemForm.code.trim() ||
                !itemForm.title.trim() ||
                !itemForm.categoryId
              }
              className="gap-1.5"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingItem ? 'Хадгалах' : 'Нэмэх'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Ангилал нэмэх/засах dialog ── */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCat ? 'Ангилал засах' : 'Ангилал нэмэх'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Ангиллын нэр</Label>
            <Input
              value={catTitle}
              onChange={(e) => setCatTitle(e.target.value)}
              placeholder="ж: 9. Тусгай зориулалтын норм"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialogOpen(false)}>
              Болих
            </Button>
            <Button onClick={submitCat} disabled={busy || !catTitle.trim()} className="gap-1.5">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingCat ? 'Хадгалах' : 'Нэмэх'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Устгах баталгаа: норм ── */}
      <Dialog open={!!deleteItem} onOpenChange={(o) => !o && setDeleteItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Норм устгах уу?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{deleteItem?.code}</span> —{' '}
              {deleteItem?.title}. Энэ нормыг каталогоос устгана (бүх төсөлд).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItem(null)}>
              Болих
            </Button>
            <Button variant="destructive" onClick={confirmDeleteItem} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Устгах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Устгах баталгаа: ангилал ── */}
      <Dialog open={!!deleteCat} onOpenChange={(o) => !o && setDeleteCat(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ангилал устгах уу?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{deleteCat?.title}</span> ангиллыг
              устгана.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCat(null)}>
              Болих
            </Button>
            <Button variant="destructive" onClick={confirmDeleteCat} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Устгах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
