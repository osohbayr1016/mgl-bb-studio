import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { roleLabelKey } from '@/shared/lib/roles';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { Card, CardContent } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';

import {
  createHandbookEntry,
  deleteHandbookEntry,
  fetchHandbookAdmin,
  handbookKeys,
  updateHandbookEntry,
  HANDBOOK_ANY,
  HANDBOOK_AUDIENCE_ROLES,
  HANDBOOK_LEVELS,
} from './api';
import type { HandbookEntry, HandbookEntryInput, HandbookStatus } from './api';

/**
 * Гарын авлагын админ — `/app/admin/handbook`.
 *
 * ЗӨВХӨН admin.  Сервер тал `requireAdmin()`-ээр хамгаалагдсан ч энд бас
 * шалгана: эс бөгөөс инженер URL бичээд ороход хуудасны хүрээ зурагдчихаад
 * бүх query 403 болж, «эвдэрсэн» мэт харагдана (AttendanceAdminPage-ийн
 * тайлбартай ижил шалтгаан).
 *
 * `GET /api/handbook/admin` нь draft-ыг бас буцаадаг тул энэ жагсаалт нь
 * ажилтны хардаг хуудсаас ИЛҮҮ мөртэй байж болно — тэрийг «Ноорог» шошгоор
 * ялгана.
 */

interface FormState {
  /** null = шинэ бичлэг. */
  id: number | null;
  role: string;
  level_code: string;
  title_mn: string;
  title_en: string;
  body_md: string;
  sort_order: string;
  status: HandbookStatus;
}

const BLANK_FORM: FormState = {
  id: null,
  role: HANDBOOK_ANY,
  level_code: HANDBOOK_ANY,
  title_mn: '',
  title_en: '',
  body_md: '',
  sort_order: '0',
  status: 'published',
};

function toForm(entry: HandbookEntry): FormState {
  return {
    id: entry.id,
    role: entry.role,
    level_code: entry.level_code,
    title_mn: entry.title_mn,
    title_en: entry.title_en ?? '',
    body_md: entry.body_md,
    sort_order: String(entry.sort_order),
    status: entry.status,
  };
}

export default function HandbookAdminPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'admin';

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [error, setError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: handbookKeys.admin,
    queryFn: fetchHandbookAdmin,
    retry: false,
    enabled: isAdmin,
  });

  /** Dialog нээх/хаах цорын ганц гарц — алдааны мессежийг үргэлж цэвэрлэнэ.
   *  (Үүнийг useEffect дотор хийвэл `react-hooks/set-state-in-effect` зөрчинө.) */
  const setDialog = (next: boolean) => {
    setError(null);
    setOpen(next);
  };

  /** Хоёр түлхүүр хоёуланг нь — ажилтны уншилт бас өөрчлөгдсөн. */
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: handbookKeys.admin }),
      queryClient.invalidateQueries({ queryKey: handbookKeys.list }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async (input: FormState) => {
      const payload: HandbookEntryInput = {
        role: input.role,
        level_code: input.level_code,
        title_mn: input.title_mn.trim(),
        title_en: input.title_en.trim() === '' ? null : input.title_en.trim(),
        body_md: input.body_md,
        // Хоосон / буруу тоо бичсэн бол 0 — сервер бүхэл тоо шаардана.
        sort_order: Number.isFinite(Number(input.sort_order)) ? Math.trunc(Number(input.sort_order)) : 0,
        status: input.status,
      };
      return input.id === null
        ? createHandbookEntry(payload)
        : updateHandbookEntry(input.id, payload);
    },
    onSuccess: async () => {
      await invalidate();
      toast.success(t('handbook.saved'));
      setDialog(false);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteHandbookEntry(id),
    onSuccess: invalidate,
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const entries = useMemo(() => listQuery.data?.entries ?? [], [listQuery.data]);

  const roleLabel = (role: string) => {
    if (role === HANDBOOK_ANY) return t('handbook.everyRole');
    return t(roleLabelKey(role));
  };
  const levelLabel = (code: string) => (code === HANDBOOK_ANY ? t('handbook.everyLevel') : code);

  /**
   * «Хэнд зориулсан бэ» сонголт — ЗӨВХӨН гарын авлагыг нээж чаддаг role-ууд
   * (`client` / `worker` нь хуудсанд ч, API-д ч хүрэхгүй тул тэдэнд бичсэн
   * заавар хэнд ч харагдахгүй).  Хуучин бичлэг жагсаалтад байхгүй role-той
   * байвал Select хоосон харагдахгүйн тулд түүнийг нь хадгална.
   */
  const roleOptions = useMemo(() => {
    const list: string[] = [...HANDBOOK_AUDIENCE_ROLES];
    if (form.role !== HANDBOOK_ANY && !list.includes(form.role)) list.push(form.role);
    return list;
  }, [form.role]);

  const openNew = () => {
    setForm(BLANK_FORM);
    setDialog(true);
  };
  const openEdit = (entry: HandbookEntry) => {
    setForm(toForm(entry));
    setDialog(true);
  };

  const remove = async (entry: HandbookEntry) => {
    const ok = await confirmDialog({
      description: t('handbook.deleteConfirm'),
      variant: 'destructive',
    });
    if (!ok) return;
    deleteMutation.mutate(entry.id);
  };

  const submit = () => {
    if (!form.title_mn.trim()) {
      setError(`${t('handbook.titleMn')} — ${t('common.required')}`);
      return;
    }
    saveMutation.mutate(form);
  };

  // Бүх hook дуудагдсаны ДАРАА л role-ийн хаалт (hook дараалал тогтмол байх ёстой).
  if (!isAdmin) return <Navigate to="/app" replace />;

  const newButton = (
    <Button onClick={openNew}>
      <Plus className="mr-1.5 h-4 w-4" aria-hidden />
      {t('handbook.newEntry')}
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader
        icon={BookOpen}
        title={t('handbook.adminTitle')}
        description={t('handbook.pageDesc')}
        actions={newButton}
      />

      {listQuery.isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        </div>
      )}

      {listQuery.isError && (
        <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />
      )}

      {!listQuery.isLoading && !listQuery.isError && entries.length === 0 && (
        <EmptyState
          icon={BookOpen}
          title={t('handbook.empty')}
          description={t('handbook.emptyHint')}
          action={newButton}
        />
      )}

      {entries.length > 0 && (
        <Card className="border-border bg-card/60 backdrop-blur">
          <CardContent className="divide-y divide-border/60 p-0">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-section text-foreground">{entry.title_mn}</span>
                    {entry.status === 'draft' ? (
                      <Badge variant="outline" className="border-warning/30 bg-warning/10 text-micro text-warning">
                        {t('handbook.statusDraft')}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-success/30 bg-success/10 text-micro text-success">
                        {t('handbook.statusPublished')}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="text-micro">
                      {roleLabel(entry.role)}
                    </Badge>
                    <Badge variant="secondary" className="text-micro">
                      {levelLabel(entry.level_code)}
                    </Badge>
                    <span className="text-micro text-muted-foreground">
                      {t('handbook.sortOrder')}: {entry.sort_order}
                    </span>
                  </div>
                  {entry.title_en && (
                    <div className="text-micro text-muted-foreground">{entry.title_en}</div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(entry)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={deleteMutation.isPending}
                    onClick={() => void remove(entry)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" aria-hidden />
              {form.id === null ? t('handbook.newEntry') : t('common.edit')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('handbook.role')}</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HANDBOOK_ANY}>{t('handbook.everyRole')}</SelectItem>
                    {roleOptions.map((r) => (
                      <SelectItem key={r} value={r}>
                        {roleLabel(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{t('handbook.level')}</Label>
                <Select
                  value={form.level_code}
                  onValueChange={(v) => setForm((f) => ({ ...f, level_code: v }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HANDBOOK_ANY}>{t('handbook.everyLevel')}</SelectItem>
                    {HANDBOOK_LEVELS.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                {t('handbook.titleMn')} <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.title_mn}
                maxLength={200}
                onChange={(e) => setForm((f) => ({ ...f, title_mn: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t('handbook.titleEn')}</Label>
              <Input
                value={form.title_en}
                maxLength={200}
                onChange={(e) => setForm((f) => ({ ...f, title_en: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t('handbook.body')}</Label>
              <Textarea
                rows={12}
                maxLength={20000}
                className="font-mono"
                value={form.body_md}
                onChange={(e) => setForm((f) => ({ ...f, body_md: e.target.value }))}
              />
              <p className="text-micro text-muted-foreground">{t('handbook.bodyHint')}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('handbook.sortOrder')}</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{t('handbook.status')}</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v as HandbookStatus }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">{t('handbook.statusDraft')}</SelectItem>
                    <SelectItem value="published">{t('handbook.statusPublished')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialog(false)}
              disabled={saveMutation.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={submit} disabled={saveMutation.isPending}>
              {saveMutation.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              )}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
