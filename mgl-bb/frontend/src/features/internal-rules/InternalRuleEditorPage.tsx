import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Eye, Info, Loader2, Paperclip, Pencil, Save, ScrollText, Send, Users } from 'lucide-react';

import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { ApiError } from '@/shared/api/client';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { ErrorState } from '@/shared/components/ErrorState';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { formatDateTime } from '@/shared/lib/time';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { AnnouncementEditor } from '@/features/announcements/components/AnnouncementEditor';
import { AnnouncementBody } from '@/features/announcements/components/AnnouncementBody';
import {
  isBodyEmpty,
  stripDangerousHtml,
  toDisplayHtml,
  toStoredHtml,
} from '@/features/announcements/lib/announcementHtml';

import { createRule, fetchRulesAdmin, publishRule, ruleKeys, updateRule } from './api';
import type { AdminRule, AdminRuleAttachment, RuleInput } from './api';
import { RuleAttachmentsEditor } from './components/RuleAttachmentsEditor';
import { RuleFileIcon } from './components/RuleFileIcon';
import { RuleSignaturesDialog } from './components/RuleSignaturesDialog';
import { useRuleFileUploads } from './hooks/useRuleFileUploads';
import { formatFileSize, markdownToHtml } from './lib/ruleFiles';

const BACK = '/app/admin/announcements?tab=rules';

/**
 * Дотоод журам — бичих / засах хуудас (`/app/admin/rules/:id`, `new` = шинэ).
 *
 * 2026-09-25 хүртэл журмыг жижиг dialog доторх markdown textarea-аар бичдэг
 * байсан тул Word-оор бэлдсэн журмыг оруулах арга байгаагүй (прод дээр нэг ч
 * журам үүсээгүй байв).  Одоо «Мэдээ, зарлал»-ын засварлагчийг
 * (`AnnouncementEditor`) хуваалцана — гарчиг, үсгийн хэмжээ, хүснэгт, зураг,
 * **Word (.docx) файлаас оруулах** — дээр нь ФАЙЛ ХАВСРАЛТ (PDF, Word, Excel…;
 * хувийн bucket, миграц 0347).  Журам нь зөвхөн хавсралт (жишээ нь батлагдсан
 * PDF) байж болно — ажилтны уншигч хуудас тэр файлыг дотроо нээнэ.
 *
 * Хадгалах = АЖЛЫН ХУВЬ (ажилтанд харагдахгүй).  Нийтлэх = шинэ хувилбар —
 * ажилтан бүр дахин гарын үсэг зурна (бие + хавсралт хоёулаа хэшд орно).
 * Хуучин (0330) markdown журмыг нээхэд HTML болгож хөрвүүлнэ; хадгалмагц
 * шинэ хэлбэрт шилжинэ.
 */
export default function InternalRuleEditorPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const isNew = rawId === 'new';
  const id = isNew ? 0 : Number(rawId);
  const { t } = useLanguage();
  const { user } = useAuth();

  // Админы жагсаалтын query-г дахин ашиглана — `/admin` бүх мөрийг бүтэн
  // биетэй, хавсралттай буцаадаг (тусдаа admin GET /:id зам байхгүй).
  const listQ = useQuery({ queryKey: ruleKeys.admin, queryFn: fetchRulesAdmin, retry: false, enabled: !isNew });
  const existing = useMemo(() => listQ.data?.rules.find((r) => r.id === id) ?? null, [listQ.data, id]);

  if (user && user.role !== 'admin') return <Navigate to="/app/rules" replace />;

  const loadingHeader = (
    <PageHeader icon={ScrollText} backTo={BACK} title={isNew ? t('rules.newRule') : t('rules.editTitle')} />
  );
  if (!isNew && listQ.isLoading) {
    return (
      <PageContainer>
        {loadingHeader}
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        </div>
      </PageContainer>
    );
  }
  if (!isNew && (listQ.isError || !existing)) {
    return (
      <PageContainer>
        {loadingHeader}
        {listQ.isError ? (
          <ErrorState error={listQ.error} onRetry={() => void listQ.refetch()} />
        ) : (
          <div className="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {t('rules.notFound')} —{' '}
            <Link to={BACK} className="text-primary underline">
              {t('common.back')}
            </Link>
          </div>
        )}
      </PageContainer>
    );
  }

  // `key` — өөр журам руу шилжихэд маягт бүхэлдээ дахин эхэлнэ.
  return <RuleForm key={existing?.id ?? 'new'} existing={existing} />;
}

interface FormState {
  title_mn: string;
  title_en: string;
  body: string;
  sort_order: string;
}

function RuleForm({ existing }: { existing: AdminRule | null }) {
  const isNew = existing === null;
  const id = existing?.id ?? 0;
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Хуучин markdown журам засварлагчид HTML болж нээгдэнэ.
  const convertedFromMarkdown = !!existing && existing.body_format === 'markdown' && existing.body_md.trim() !== '';
  const [form, setForm] = useState<FormState>(() => ({
    title_mn: existing?.title_mn ?? '',
    title_en: existing?.title_en ?? '',
    body: existing
      ? existing.body_format === 'html'
        ? toDisplayHtml(existing.body_md)
        : markdownToHtml(existing.body_md)
      : '',
    sort_order: String(existing?.sort_order ?? 0),
  }));
  const [attachments, setAttachments] = useState<AdminRuleAttachment[]>(() => existing?.attachments ?? []);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };
  const onBodyChange = useCallback((html: string) => {
    setForm((f) => ({ ...f, body: html }));
    setDirty(true);
  }, []);

  // Хавсралтын тоог upload-ын дунд уншихад (хаалт 20 файл).
  const countRef = useRef(attachments.length);
  useEffect(() => {
    countRef.current = attachments.length;
  }, [attachments.length]);
  const getCount = useCallback(() => countRef.current, []);
  const onAdded = useCallback((att: AdminRuleAttachment) => {
    setAttachments((prev) => [...prev, att]);
    setDirty(true);
  }, []);
  const uploads = useRuleFileUploads({ getCount, onAdded });
  const { addFiles, getLocalFile } = uploads;
  const onAttachFiles = useCallback((files: File[]) => void addFiles(files), [addFiles]);

  // Хадгалаагүй өөрчлөлттэй хуудсыг санамсаргүй хаахаас сэргийлнэ.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ruleKeys.admin });
    void queryClient.invalidateQueries({ queryKey: ruleKeys.list });
    if (id) void queryClient.invalidateQueries({ queryKey: ruleKeys.detail(id) });
  };
  const onError = (err: unknown) => {
    const code = err instanceof ApiError ? err.code : undefined;
    if (code === 'UNCHANGED') {
      toast.warn(t('rules.unchanged'));
      return;
    }
    toast.error(t('common.saveFailed'), err instanceof Error ? err.message : undefined);
  };

  const payload = (): RuleInput => {
    const sort = Number.parseInt(form.sort_order, 10);
    return {
      title_mn: form.title_mn.trim(),
      title_en: form.title_en.trim() || null,
      body_md: toStoredHtml(form.body),
      body_format: 'html',
      sort_order: Number.isFinite(sort) ? sort : 0,
      attachments: attachments.map((a) => ({ key: a.key, name: a.name })),
    };
  };

  const save = useMutation({
    mutationFn: async () => (isNew ? (await createRule(payload())).rule : (await updateRule(id, payload())).rule),
    onSuccess: (rule: AdminRule) => {
      toast.success(t('rules.saved'));
      setDirty(false);
      invalidate();
      if (isNew) navigate(`/app/admin/rules/${rule.id}`, { replace: true });
    },
    onError,
  });

  const publish = useMutation({
    mutationFn: async () => {
      // Нийтлэхийн өмнө засварыг хадгална — нийтлэх нь ажлын хувийг агшин болгоно.
      let targetId = id;
      if (isNew) targetId = (await createRule(payload())).rule.id;
      else if (dirty) await updateRule(id, payload());
      return publishRule(targetId);
    },
    onSuccess: () => {
      toast.success(t('rules.published'));
      setDirty(false);
      invalidate();
      navigate(BACK);
    },
    onError: (err) => {
      invalidate();
      onError(err);
    },
  });

  const hasTitle = form.title_mn.trim().length > 0;
  const hasContent = !isBodyEmpty(form.body) || attachments.length > 0;
  const busy = save.isPending || publish.isPending || uploads.uploading.length > 0;
  const isPublished = existing?.status === 'published';
  const canPublish =
    hasTitle &&
    hasContent &&
    existing?.status !== 'archived' &&
    (isNew || dirty || !isPublished || existing?.has_unpublished_changes === true);

  const confirmPublish = async () => {
    const ok = await confirmDialog({
      title: t('rules.publishConfirmTitle'),
      description: existing?.current_version
        ? t('rules.publishConfirmAgain', { version: existing.current_version + 1 })
        : t('rules.publishConfirmFirst'),
      confirmText: t('rules.publish'),
    });
    if (ok) publish.mutate();
  };

  const header = (
    <PageHeader
      icon={ScrollText}
      backTo={BACK}
      title={isNew ? t('rules.newRule') : t('rules.editTitle')}
      description={
        existing
          ? [
              existing.status === 'draft'
                ? t('rules.statusDraft')
                : existing.status === 'archived'
                  ? t('rules.statusArchived')
                  : t('rules.statusPublished'),
              existing.current_version ? `v${existing.current_version}` : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setPreview((p) => !p)} data-testid="preview-toggle">
            {preview ? <Pencil className="mr-1.5 h-4 w-4" aria-hidden /> : <Eye className="mr-1.5 h-4 w-4" aria-hidden />}
            {preview ? t('announcements.backToEdit') : t('announcements.preview')}
          </Button>
          {existing && existing.current_version_id !== null && (
            <Button type="button" variant="outline" size="sm" onClick={() => setRosterOpen(true)}>
              <Users className="mr-1.5 h-4 w-4" aria-hidden />
              {t('rules.signatures')} {existing.signed_count}/{existing.roster_count}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => save.mutate()}
            disabled={!hasTitle || busy || (!dirty && !isNew)}
            data-testid="save-button"
          >
            {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-1.5 h-4 w-4" aria-hidden />}
            {t('common.save')}
          </Button>
          {existing?.status !== 'archived' && (
            <Button
              type="button"
              size="sm"
              onClick={() => void confirmPublish()}
              disabled={!canPublish || busy}
              title={!hasContent ? t('rules.publishNeedsContent') : undefined}
              data-testid="publish-button"
            >
              {publish.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-1.5 h-4 w-4" aria-hidden />}
              {isPublished ? t('rules.publishNewVersion') : t('rules.publish')}
            </Button>
          )}
        </div>
      }
    />
  );

  return (
    <PageContainer>
      {header}

      {isPublished && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('rules.editingPublishedNotice')}</span>
        </div>
      )}
      {convertedFromMarkdown && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('rules.convertedFromMarkdown')}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="min-w-0 space-y-4 lg:col-span-8">
          <Card className="border-border bg-card/60 backdrop-blur">
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-1.5">
                <Label htmlFor="rule-title-mn">
                  {t('rules.titleMn')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="rule-title-mn"
                  value={form.title_mn}
                  maxLength={200}
                  onChange={(e) => patch('title_mn', e.target.value)}
                  placeholder={t('rules.titlePlaceholder')}
                  disabled={busy}
                  data-testid="rule-title-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('rules.body')}</Label>
                {preview ? (
                  <div className="space-y-4 rounded-md border border-border px-4 py-3" data-testid="preview-body">
                    <h2 className="text-title text-foreground">{form.title_mn || '—'}</h2>
                    <AnnouncementBody html={stripDangerousHtml(toStoredHtml(form.body))} />
                    {attachments.length > 0 && (
                      <ul className="space-y-1 border-t border-border pt-3">
                        {attachments.map((a) => (
                          <li key={a.key} className="flex items-center gap-2 text-sm text-foreground">
                            <RuleFileIcon name={a.name} className="h-4 w-4 text-muted-foreground" />
                            <span className="truncate">{a.name}</span>
                            <span className="text-micro text-muted-foreground">{formatFileSize(a.size)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <AnnouncementEditor
                    defaultHtml={form.body}
                    onChange={onBodyChange}
                    placeholder={t('rules.bodyPlaceholder')}
                    onAttachFiles={onAttachFiles}
                  />
                )}
                <p className="text-micro text-muted-foreground">{t('rules.bodyHint')}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/60 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-section">
                <Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden />
                {t('rules.files.title')}
                {attachments.length > 0 && (
                  <Badge variant="outline" className="text-micro">
                    {attachments.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RuleAttachmentsEditor
                ruleId={existing?.id ?? null}
                attachments={attachments}
                uploading={uploads.uploading}
                getLocalFile={getLocalFile}
                onAddFiles={onAttachFiles}
                onRemove={(key) => {
                  setAttachments((prev) => prev.filter((a) => a.key !== key));
                  setDirty(true);
                }}
                disabled={save.isPending || publish.isPending}
              />
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-4 lg:col-span-4">
          <Card className="border-border bg-card/60 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-section">{t('announcements.settings')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="rule-title-en">{t('rules.titleEn')}</Label>
                <Input
                  id="rule-title-en"
                  value={form.title_en}
                  maxLength={200}
                  onChange={(e) => patch('title_en', e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rule-sort">{t('rules.sortOrder')}</Label>
                <Input
                  id="rule-sort"
                  type="number"
                  inputMode="numeric"
                  className="sm:w-32"
                  value={form.sort_order}
                  onChange={(e) => patch('sort_order', e.target.value)}
                  disabled={busy}
                />
              </div>
              {existing && existing.current_version !== null && (
                <div className="space-y-1 rounded-md border border-border px-3 py-2 text-micro text-muted-foreground">
                  <div>
                    v{existing.current_version} · {formatDateTime(existing.published_at)}
                  </div>
                  <div>{t('rules.signedProgress', { signed: existing.signed_count, total: existing.roster_count })}</div>
                </div>
              )}
              <p className="text-micro text-muted-foreground">{t('rules.editHint')}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <RuleSignaturesDialog rule={existing} open={rosterOpen} onOpenChange={setRosterOpen} />
    </PageContainer>
  );
}
