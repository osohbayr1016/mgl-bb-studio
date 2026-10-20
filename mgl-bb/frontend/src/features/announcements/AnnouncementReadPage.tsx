import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Megaphone, PenLine, ShieldCheck, UserCheck } from 'lucide-react';

import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { apiFetch, ApiError, mediaUrl } from '@/shared/api/client';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { ErrorState } from '@/shared/components/ErrorState';
import { SignatureCapture } from '@/shared/components/SignatureCapture';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { formatDateTime } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Label } from '@/ui/label';

import { ackAnnouncement, announcementKeys, fetchAnnouncement } from './api';
import type { AnnouncementDetail } from './api';
import { AckSignatureImage } from './components/AckSignatureImage';
import { AnnouncementBody } from './components/AnnouncementBody';
import { KIND_I18N } from './lib/labels';

/**
 * Нийтийн мэдээлэл — уншиж, (шаардлагатай бол) баталгаажуулах хуудас
 * (`/app/announcements/:id`).
 *
 * `ack_mode`:
 *   none      — уншина л, доор юу ч гарахгүй.
 *   confirm   — төгсгөл хүртэл уншсаны дараа «уншиж танилцлаа» чагт → батлах.
 *   signature — дээрх + ПРОФАЙЛЫН гарын үсэг (`users.signature_url`); байхгүй бол
 *               энд зурж/байршуулж профайлдаа хадгална (`SignatureCapture` →
 *               `PATCH /auth/profile`) — Дотоод журамтай ижил зам.
 *
 * Баталгаа ХУВИЛБАРТ (`ack_version`) холбогдоно: админ «дахин баталгаажуул»
 * гэж шинэчилбэл энэ хуудас дахин «хүлээгдэж буй» болж, `previous` нь
 * «v1-д … баталгаажуулсан байсан» гэж тайлбарлана.
 */
export default function AnnouncementReadPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = Number(rawId);
  const { t } = useLanguage();
  const { user, checkAuth } = useAuth();
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: announcementKeys.detail(id),
    queryFn: () => fetchAnnouncement(id),
    enabled: Number.isInteger(id) && id > 0,
    retry: false,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: announcementKeys.detail(id) });
    void queryClient.invalidateQueries({ queryKey: announcementKeys.list });
  };

  const a = q.data?.announcement;
  const header = (
    <PageHeader
      icon={Megaphone}
      backTo="/app/announcements"
      eyebrow={a ? t(KIND_I18N[a.kind]) : undefined}
      title={a ? a.title : t('announcements.pageTitle')}
      description={
        a
          ? `${formatDateTime(a.published_at)}${a.published_by_name ? ` · ${a.published_by_name}` : ''}${a.ack_version > 1 ? ` · v${a.ack_version}` : ''}`
          : undefined
      }
    />
  );

  if (q.isLoading) {
    return (
      <PageContainer>
        {header}
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        </div>
      </PageContainer>
    );
  }
  if (q.isError || !q.data) {
    return (
      <PageContainer>
        {header}
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </PageContainer>
    );
  }

  const data = q.data;
  const needsAck = data.announcement.ack_mode !== 'none' && data.in_audience;
  return (
    <PageContainer>
      {header}
      {needsAck && data.my_ack ? (
        <AckedCard data={data} />
      ) : needsAck && data.previous ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('announcements.newVersionNotice', { version: data.previous.ack_version, date: formatDateTime(data.previous.acked_at) })}</span>
        </div>
      ) : null}
      {!data.in_audience && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{t('announcements.notInAudience')}</div>
      )}

      <Body data={data} gate={needsAck && !data.my_ack} />

      {needsAck && !data.my_ack && (
        <AckFlow
          data={data}
          currentUserSignatureUrl={user?.signature_url ?? data.profile_signature_url}
          onAcked={invalidate}
          onProfileSignatureSaved={async () => {
            await checkAuth();
            invalidate();
          }}
        />
      )}
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */

function AckedCard({ data }: { data: AnnouncementDetail }) {
  const { t } = useLanguage();
  const ack = data.my_ack!;
  return (
    <Card className="border-success/40 bg-success/5" data-testid="acked-card">
      <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-success" aria-hidden />
          <div className="space-y-0.5">
            <div className="font-medium text-foreground">
              {ack.ack_kind === 'signature' ? t('announcements.signedTitle') : t('announcements.confirmedTitle')}
            </div>
            <div className="text-sm text-muted-foreground">{t('announcements.ackedAt', { date: formatDateTime(ack.acked_at) })}</div>
            <div className="font-mono text-micro text-muted-foreground" title={ack.content_hash}>
              {t('announcements.contentHash')}: {ack.content_hash.slice(0, 16)}…
            </div>
          </div>
        </div>
        {ack.ack_kind === 'signature' && <AckSignatureImage ackId={ack.id} />}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

/** Төгсгөл хүртэл уншсан дохио — `Body` ба `AckFlow` хоёр карт нэг хуудсан дээр. */
const REACHED_END_EVENT = 'announcements:reached-end';

function Body({ data, gate }: { data: AnnouncementDetail; gate: boolean }) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !gate) return;
    if (typeof IntersectionObserver === 'undefined') {
      const id = window.setTimeout(() => window.dispatchEvent(new Event(REACHED_END_EVENT)), 0);
      return () => window.clearTimeout(id);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          window.dispatchEvent(new Event(REACHED_END_EVENT));
          io.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [gate, data.announcement.ack_version, data.announcement.content_hash]);

  return (
    <Card className="border-border bg-card/60 backdrop-blur">
      <CardContent className="pt-6">
        <AnnouncementBody html={data.announcement.body_html} />
        <div ref={sentinel} className="h-px w-full" aria-hidden />
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function AckFlow({
  data,
  currentUserSignatureUrl,
  onAcked,
  onProfileSignatureSaved,
}: {
  data: AnnouncementDetail;
  currentUserSignatureUrl: string | null;
  onAcked: () => void;
  onProfileSignatureSaved: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const a = data.announcement;
  const withSignature = a.ack_mode === 'signature';
  const [reachedEnd, setReachedEnd] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [savingSignature, setSavingSignature] = useState(false);

  useEffect(() => {
    const on = () => setReachedEnd(true);
    window.addEventListener(REACHED_END_EVENT, on);
    return () => window.removeEventListener(REACHED_END_EVENT, on);
  }, []);
  useEffect(() => {
    setReachedEnd(false);
    setConfirmed(false);
  }, [a.ack_version, a.content_hash]);

  const hasSignature = !!currentUserSignatureUrl;

  const saveProfileSignature = async (url: string | null) => {
    setSavingSignature(true);
    try {
      await apiFetch('/auth/profile', { method: 'PATCH', data: { signature_url: url } });
      await onProfileSignatureSaved();
      if (url) toast.success(t('announcements.signatureSaved'));
    } catch (err) {
      console.error('[announcements] profile signature save failed', err);
      toast.error(t('common.saveFailed'), err instanceof Error ? err.message : undefined);
    } finally {
      setSavingSignature(false);
    }
  };

  const ackMutation = useMutation({
    mutationFn: () => ackAnnouncement(a.id, a.ack_version, a.content_hash ?? ''),
    onSuccess: () => {
      toast.success(withSignature ? t('announcements.signSuccess') : t('announcements.confirmSuccess'));
      onAcked();
    },
    onError: (err: unknown) => {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === 'VERSION_CHANGED' || code === 'HASH_MISMATCH') {
        toast.warn(t('announcements.versionChangedToast'));
        onAcked();
        return;
      }
      if (code === 'ALREADY_ACKED') {
        onAcked();
        return;
      }
      if (code === 'NO_SIGNATURE') {
        toast.error(t('announcements.noSignatureToast'));
        void onProfileSignatureSaved();
        return;
      }
      toast.error(t('announcements.ackFailed'), err instanceof Error ? err.message : undefined);
    },
  });

  const canAck = reachedEnd && confirmed && (!withSignature || hasSignature) && !ackMutation.isPending;

  const submit = async () => {
    if (!canAck) return;
    const ok = await confirmDialog({
      title: withSignature ? t('announcements.confirmSignTitle') : t('announcements.confirmAckTitle'),
      description: t('announcements.confirmBody', { title: a.title }),
      confirmText: withSignature ? t('announcements.signButton') : t('announcements.ackButton'),
    });
    if (!ok) return;
    ackMutation.mutate();
  };

  const finalStep = withSignature ? 3 : 2;

  return (
    <Card id="sec-announcement-ack" className="scroll-mt-24 border-primary/30 bg-primary/5" data-testid="ack-flow">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {withSignature ? <PenLine className="h-4 w-4 text-primary" aria-hidden /> : <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />}
          {withSignature ? t('announcements.signCardTitle') : t('announcements.ackCardTitle')}
          <Badge variant="outline" className="ml-auto text-micro">
            {withSignature ? t('announcements.ackMode.signature') : t('announcements.ackMode.confirm')}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <Step n={1} done={reachedEnd && confirmed} active={!confirmed} title={t('announcements.step1')}>
          {!reachedEnd && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <ChevronDown className="h-4 w-4 animate-bounce" aria-hidden />
              {t('announcements.scrollToEnd')}
            </p>
          )}
          <div className="flex items-start gap-2">
            <Checkbox
              id="announcement-read-confirm"
              checked={confirmed}
              disabled={!reachedEnd}
              onCheckedChange={(v) => setConfirmed(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="announcement-read-confirm" className={cn('text-sm leading-snug', !reachedEnd && 'text-muted-foreground')}>
              {t('announcements.readCheckbox')}
            </Label>
          </div>
        </Step>

        {withSignature && (
          <Step n={2} done={hasSignature} active={confirmed && !hasSignature} title={t('announcements.step2')}>
            {hasSignature ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-block max-w-full rounded-md border border-border bg-white p-2">
                  <img src={mediaUrl(currentUserSignatureUrl)} alt={t('common.signature')} className="h-16 max-w-full object-contain" />
                </div>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <UserCheck className="h-4 w-4 text-success" aria-hidden />
                    {t('announcements.profileSignatureInUse')}
                  </div>
                  <Link to="/app/profile" className="text-primary underline-offset-2 hover:underline">
                    {t('announcements.changeInProfile')}
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">{t('announcements.noProfileSignature')}</p>
                <SignatureCapture value={null} onChange={(url) => void saveProfileSignature(url)} disabled={savingSignature} />
              </div>
            )}
          </Step>
        )}

        <Step n={finalStep} done={false} active={canAck} title={withSignature ? t('announcements.step3Sign') : t('announcements.step3Confirm')}>
          <p className="text-sm text-muted-foreground">{withSignature ? t('announcements.step3SignHint') : t('announcements.step3ConfirmHint')}</p>
          <Button onClick={() => void submit()} disabled={!canAck} className="mt-1" data-testid="ack-button">
            {ackMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden />}
            {withSignature ? t('announcements.signButton') : t('announcements.ackButton')}
          </Button>
        </Step>
      </CardContent>
    </Card>
  );
}

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
          done ? 'border-success bg-success text-success-foreground' : active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted text-muted-foreground',
        )}
        aria-hidden
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : n}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="font-medium text-foreground">{title}</div>
        {children}
      </div>
    </div>
  );
}
