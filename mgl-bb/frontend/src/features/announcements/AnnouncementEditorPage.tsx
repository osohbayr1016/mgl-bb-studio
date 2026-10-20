import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Eye, Loader2, Megaphone, Pencil, Save, Send, Users } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { ApiError } from '@/shared/api/client';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { ErrorState } from '@/shared/components/ErrorState';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Checkbox } from '@/ui/checkbox';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Switch } from '@/ui/switch';

import {
  ACK_MODES,
  ANNOUNCEMENT_KINDS,
  EVERYONE,
  announcementKeys,
  createAnnouncement,
  fetchAnnouncementsAdmin,
  publishAnnouncement,
  updateAnnouncement,
} from './api';
import type { AckMode, AdminAnnouncement, AnnouncementInput, AnnouncementKind } from './api';
import { AnnouncementAcksDialog } from './components/AnnouncementAcksDialog';
import { AnnouncementBody } from './components/AnnouncementBody';
import { AnnouncementEditor } from './components/AnnouncementEditor';
import { AudiencePicker } from './components/AudiencePicker';
import { isBodyEmpty, stripDangerousHtml, toDisplayHtml, toStoredHtml } from './lib/announcementHtml';
import { ACK_MODE_I18N, KIND_I18N } from './lib/labels';

const EMPTY: AnnouncementInput = {
  title: '',
  body_html: '',
  kind: 'announcement',
  ack_mode: 'none',
  audience: EVERYONE,
  pinned: false,
};

/**
 * Админ — мэдээлэл бичих / засах (`/app/admin/announcements/:id`, `new` = шинэ).
 *
 * Тусдаа хуудас (dialog биш): засварлагч нь зурагтай, урт агуулгатай.
 * Хадгалах = draft-д PUT/POST; нийтлэх нь тусдаа товч (draft үед).
 * Нийтлэгдсэн, баталгаа шаардсан мэдээллийг засахад «Дахин баталгаажуулахыг
 * шаардах» чагт гарна — сонговол `ack_version` +1, хүрээний ажилтан бүрд
 * мэдэгдэл дахин очно; сонгохгүй бол одоогийн баталгаа хэвээр (жижиг засвар).
 *
 * `body_html` нь ажиллах явцад АБСОЛЮТ зургийн URL-тай (засварлагч тэгж
 * үүсгэдэг), хадгалахдаа `toStoredHtml` → `/media/<key>`.
 */
export default function AnnouncementEditorPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const isNew = rawId === 'new';
  const id = isNew ? 0 : Number(rawId);
  const { t } = useLanguage();

  // Админы жагсаалтын query-г дахин ашиглана (тусдаа GET /:id admin зам байхгүй —
  // /admin бүх мөрийг бүтэн body-тэй буцаадаг).
  const listQ = useQuery({ queryKey: announcementKeys.admin, queryFn: fetchAnnouncementsAdmin, retry: false, enabled: !isNew });
  const existing = useMemo(() => listQ.data?.announcements.find((a) => a.id === id) ?? null, [listQ.data, id]);

  const loadingHeader = (
    <PageHeader icon={Megaphone} backTo="/app/admin/announcements" title={isNew ? t('announcements.new') : t('announcements.editTitle')} />
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
            {t('announcements.notFound')} — <Link to="/app/admin/announcements" className="text-primary underline">{t('common.back')}</Link>
          </div>
        )}
      </PageContainer>
    );
  }

  // `key` — өөр мэдээлэл рүү шилжихэд маягт бүхэлдээ дахин эхэлнэ (effect-ээр
  // seed хийхгүй: анхны утга `useState`-ийн initializer-т).
  return <EditorForm key={existing?.id ?? 'new'} existing={existing} />;
}

function EditorForm({ existing }: { existing: AdminAnnouncement | null }) {
  const isNew = existing === null;
  const id = existing?.id ?? 0;
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<AnnouncementInput>(() =>
    existing
      ? {
          title: existing.title,
          body_html: toDisplayHtml(existing.body_html),
          kind: existing.kind,
          ack_mode: existing.ack_mode,
          audience: existing.audience,
          pinned: existing.pinned,
        }
      : EMPTY,
  );
  const [preview, setPreview] = useState(false);
  const [reack, setReack] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [acksOpen, setAcksOpen] = useState(false);

  const patch = <K extends keyof AnnouncementInput>(key: K, value: AnnouncementInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: announcementKeys.admin });
    void queryClient.invalidateQueries({ queryKey: announcementKeys.list });
    if (id) void queryClient.invalidateQueries({ queryKey: announcementKeys.detail(id) });
  };
  const onError = (err: unknown) => {
    const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : undefined;
    toast.error(t('common.saveFailed'), msg);
  };

  const payload = (): AnnouncementInput => ({ ...form, body_html: toStoredHtml(form.body_html) });

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return (await createAnnouncement(payload())).announcement;
      const r = await updateAnnouncement(id, { ...payload(), reack });
      return r.announcement;
    },
    onSuccess: (a: AdminAnnouncement) => {
      toast.success(t('announcements.savedToast'));
      setDirty(false);
      setReack(false);
      invalidate();
      if (isNew) navigate(`/app/admin/announcements/${a.id}`, { replace: true });
    },
    onError,
  });

  const publish = useMutation({
    mutationFn: async () => {
      // Нийтлэхийн өмнө засварыг хадгална — draft хэвээр байгаа тул reack хамаагүй.
      let targetId = id;
      if (isNew) targetId = (await createAnnouncement(payload())).announcement.id;
      else if (dirty) await updateAnnouncement(id, payload());
      return { targetId, ...(await publishAnnouncement(targetId, true)) };
    },
    onSuccess: (r) => {
      toast.success(t('announcements.publishedToast', { count: r.notified }));
      setDirty(false);
      invalidate();
      navigate('/app/admin/announcements');
    },
    onError,
  });

  const valid = form.title.trim().length > 0 && !isBodyEmpty(form.body_html);
  const busy = save.isPending || publish.isPending;
  const showReack = !!existing && existing.status === 'published' && form.ack_mode !== 'none' && existing.total_acks > 0;

  const confirmPublish = async () => {
    const ok = await confirmDialog({
      title: t('announcements.publishConfirmTitle'),
      description: t('announcements.publishConfirmShort', { title: form.title }),
      confirmText: t('announcements.publish'),
    });
    if (ok) publish.mutate();
  };

  const header = (
    <PageHeader
      icon={Megaphone}
      backTo="/app/admin/announcements"
      title={isNew ? t('announcements.new') : t('announcements.editTitle')}
      description={existing ? `${t(`announcements.status.${existing.status}`)}${existing.ack_version > 1 ? ` · v${existing.ack_version}` : ''}` : undefined}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setPreview((p) => !p)} data-testid="preview-toggle">
            {preview ? <Pencil className="mr-1.5 h-4 w-4" aria-hidden /> : <Eye className="mr-1.5 h-4 w-4" aria-hidden />}
            {preview ? t('announcements.backToEdit') : t('announcements.preview')}
          </Button>
          {existing && existing.ack_mode !== 'none' && existing.status !== 'draft' && (
            <Button type="button" variant="outline" size="sm" onClick={() => setAcksOpen(true)}>
              <Users className="mr-1.5 h-4 w-4" aria-hidden />
              {t('announcements.acks')} {existing.acked_count}/{existing.roster_count}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => save.mutate()} disabled={!valid || busy || (!dirty && !isNew && !reack)} data-testid="save-button">
            {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-1.5 h-4 w-4" aria-hidden />}
            {t('common.save')}
          </Button>
          {(isNew || existing?.status === 'draft') && (
            <Button type="button" size="sm" onClick={() => void confirmPublish()} disabled={!valid || busy} data-testid="publish-button">
              {publish.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-1.5 h-4 w-4" aria-hidden />}
              {t('announcements.publish')}
            </Button>
          )}
        </div>
      }
    />
  );

  return (
    <PageContainer>
      {header}

      {existing?.status === 'published' && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('announcements.editingPublishedNotice')}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="min-w-0 space-y-4 lg:col-span-8">
          <Card className="border-border bg-card/60 backdrop-blur">
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-1.5">
                <Label htmlFor="ann-title">{t('announcements.fieldTitle')}</Label>
                <Input
                  id="ann-title"
                  value={form.title}
                  maxLength={200}
                  onChange={(e) => patch('title', e.target.value)}
                  placeholder={t('announcements.fieldTitlePlaceholder')}
                  disabled={busy}
                  data-testid="title-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('announcements.fieldBody')}</Label>
                {preview ? (
                  <div className="rounded-md border border-border px-4 py-3" data-testid="preview-body">
                    <h2 className="mb-3 text-title text-foreground">{form.title || '—'}</h2>
                    <AnnouncementBody html={stripDangerousHtml(toStoredHtml(form.body_html))} />
                  </div>
                ) : (
                  <AnnouncementEditor
                    defaultHtml={form.body_html}
                    onChange={(html) => patch('body_html', html)}
                    placeholder={t('announcements.fieldBodyPlaceholder')}
                  />
                )}
                <p className="text-micro text-muted-foreground">{t('announcements.fieldBodyHint')}</p>
              </div>
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
                <Label>{t('announcements.fieldKind')}</Label>
                <Select value={form.kind} onValueChange={(v) => patch('kind', v as AnnouncementKind)} disabled={busy}>
                  <SelectTrigger data-testid="kind-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ANNOUNCEMENT_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(KIND_I18N[k])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('announcements.fieldAckMode')}</Label>
                <Select value={form.ack_mode} onValueChange={(v) => patch('ack_mode', v as AckMode)} disabled={busy}>
                  <SelectTrigger data-testid="ack-mode-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACK_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(ACK_MODE_I18N[m])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-micro text-muted-foreground">{t(`announcements.ackModeHint.${form.ack_mode}`)}</p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="ann-pinned" className="text-sm">
                  {t('announcements.fieldPinned')}
                </Label>
                <Switch id="ann-pinned" checked={form.pinned} onCheckedChange={(v) => patch('pinned', v)} disabled={busy} />
              </div>
              {showReack && (
                <div className={cn('flex items-start gap-2 rounded-md border px-3 py-2', reack ? 'border-warning/40 bg-warning/10' : 'border-border')}>
                  <Checkbox id="ann-reack" checked={reack} onCheckedChange={(v) => setReack(v === true)} className="mt-0.5" data-testid="reack-checkbox" />
                  <Label htmlFor="ann-reack" className="text-sm leading-snug">
                    {t('announcements.reackLabel')}
                    <span className="block text-micro font-normal text-muted-foreground">{t('announcements.reackHint', { count: existing?.acked_count ?? 0 })}</span>
                  </Label>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border bg-card/60 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-section">
                {t('announcements.fieldAudience')}
                <Badge variant="outline" className="text-micro">
                  {form.audience.roles.length + form.audience.team_ids.length === 0 ? t('announcements.audience.everyone') : t('announcements.audience.limited')}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AudiencePicker value={form.audience} onChange={(a) => patch('audience', a)} disabled={busy} />
            </CardContent>
          </Card>
        </div>
      </div>

      <AnnouncementAcksDialog item={existing} open={acksOpen} onOpenChange={setAcksOpen} />
    </PageContainer>
  );
}
