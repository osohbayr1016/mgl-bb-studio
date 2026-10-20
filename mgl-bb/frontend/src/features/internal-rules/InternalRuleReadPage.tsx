import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  PenLine,
  ScrollText,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';

import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage, pickLocalized } from '@/shared/i18n';
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
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Label } from '@/ui/label';
import { Markdown } from '@/features/handbook/markdown';
import { AnnouncementBody } from '@/features/announcements/components/AnnouncementBody';
import { isBodyEmpty } from '@/features/announcements/lib/announcementHtml';

import { fetchRule, ruleKeys, signRule } from './api';
import type { RuleDetail } from './api';
import { RuleAttachmentList } from './components/RuleAttachmentList';
import { SignatureImage } from './components/SignatureImage';

/**
 * Дотоод журам — уншиж, гарын үсгээр баталгаажуулах хуудас (`/app/rules/:id`).
 *
 * Гурван алхам, дарааллаар нээгдэнэ:
 *   1. УНШИХ — бичвэрийн төгсгөл дэлгэцэнд орсны дараа л (IntersectionObserver)
 *      «уншиж танилцлаа» нүд идэвхжинэ.  Богино бичвэрт төгсгөл шууд
 *      харагддаг тул саад болохгүй; урт журамд «доошоо гүйлгээгүй ч зурчихлаа»
 *      гэдгийг хаана.
 *   2. ГАРЫН ҮСЭГ — профайлын хадгалсан гарын үсэг (`users.signature_url`).
 *      Байхгүй бол ЭНД ЗУРЖ/байршуулж профайлдаа хадгална (`SignatureCapture` →
 *      `PATCH /auth/profile`) — ProfilePage-ийн ижил зам, тусдаа хуудас руу
 *      явуулахгүй.  Эзний шийдвэр (2026-09-21): гарын үсэг нэг л газар —
 *      профайлд; журам бүрд шинээр зурахгүй.
 *   3. БАТАЛГААЖУУЛАХ — confirm dialog → `POST /:id/sign` (version_id +
 *      content_hash: «ЯГ энэ бичвэрийг харсан»).  Сервер профайлын зургийг
 *      хувийн bucket руу хуулж мөр бичнэ; буцаах боломжгүй.
 *
 * Гарын үсэг ХУВИЛБАРТ холбогдоно: админ бичвэрийг шинээр нийтэлбэл энэ
 * хуудас дахин «зураагүй» болж, `previous` нь «v1-д … зурсан байсан» гэж
 * тайлбарлана.
 */
export default function InternalRuleReadPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = Number(rawId);
  const { t, lang } = useLanguage();
  const { user, checkAuth } = useAuth();
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ruleKeys.detail(id),
    queryFn: () => fetchRule(id),
    enabled: Number.isInteger(id) && id > 0,
    retry: false,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ruleKeys.detail(id) });
    void queryClient.invalidateQueries({ queryKey: ruleKeys.list });
  };

  const header = (
    <PageHeader
      icon={ScrollText}
      backTo="/app/rules"
      title={q.data ? pickLocalized(lang, q.data.rule.title_mn, q.data.rule.title_en) : t('rules.pageTitle')}
      description={
        q.data
          ? t('rules.versionMeta', {
              version: q.data.rule.version,
              date: formatDateTime(q.data.rule.published_at),
            })
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
  return (
    <PageContainer>
      {header}
      {data.signature ? (
        <SignedCard data={data} />
      ) : data.previous ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {t('rules.newVersionNotice', {
              version: data.previous.version,
              date: formatDateTime(data.previous.signed_at),
            })}
          </span>
        </div>
      ) : null}

      <RuleBody data={data} signed={data.signature !== null} />

      {!data.signature && (
        <SignFlow
          data={data}
          currentUserSignatureUrl={user?.signature_url ?? data.profile_signature_url}
          onSigned={invalidate}
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

function SignedCard({ data }: { data: RuleDetail }) {
  const { t } = useLanguage();
  const sig = data.signature!;
  return (
    <Card className="border-success/40 bg-success/5">
      <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-success" aria-hidden />
          <div className="space-y-0.5">
            <div className="font-medium text-foreground">{t('rules.signedTitle')}</div>
            <div className="text-sm text-muted-foreground">
              {t('rules.signedAt', { date: formatDateTime(sig.signed_at) })} · v{data.rule.version}
            </div>
            <div className="font-mono text-micro text-muted-foreground" title={sig.content_hash}>
              {t('rules.contentHash')}: {sig.content_hash.slice(0, 16)}…
            </div>
          </div>
        </div>
        <SignatureImage signatureId={sig.id} />
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Журмын бичвэр.  Доод талын `sentinel` нь «төгсгөл хүртэл уншсан»
 * дохио — `SignFlow` тэр дохиог `document`-оос биш, энэ компонентын
 * custom event-ээр авна (ижил хуудсан дээрх хоёр карт).
 */
const REACHED_END_EVENT = 'rules:reached-end';

function RuleBody({ data, signed }: { data: RuleDetail; signed: boolean }) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || signed) return;
    if (typeof IntersectionObserver === 'undefined') {
      // Хуучин хөтөч: дүү компонентын listener бүртгэгдсэний ДАРАА дохио өгнө.
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
  }, [signed, data.rule.version_id]);

  const { rule } = data;
  const bodyEmpty =
    rule.body_format === 'html' ? isBodyEmpty(rule.body_md) : rule.body_md.trim() === '';

  // Хавсралт нь бичвэрийн ДАРАА, төгсгөлийн дохионы ӨМНӨ — «уншиж танилцсан»
  // нь хавсралтыг ч хамарна.  Бие хоосон (журам нь ганц файл) бол эхний
  // харагдах файл хуудсан дотроо нээгдэнэ.
  return (
    <Card className="border-border bg-card/60 backdrop-blur">
      <CardContent className="space-y-6 pt-6">
        {!bodyEmpty &&
          (rule.body_format === 'html' ? <AnnouncementBody html={rule.body_md} /> : <Markdown body={rule.body_md} />)}
        <RuleAttachmentList ruleId={rule.id} attachments={rule.attachments} inlineFirst={bodyEmpty} />
        <div ref={sentinel} className="h-px w-full" aria-hidden />
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function SignFlow({
  data,
  currentUserSignatureUrl,
  onSigned,
  onProfileSignatureSaved,
}: {
  data: RuleDetail;
  currentUserSignatureUrl: string | null;
  onSigned: () => void;
  onProfileSignatureSaved: () => Promise<void>;
}) {
  const { t, lang } = useLanguage();
  const [reachedEnd, setReachedEnd] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [savingSignature, setSavingSignature] = useState(false);

  useEffect(() => {
    const on = () => setReachedEnd(true);
    window.addEventListener(REACHED_END_EVENT, on);
    return () => window.removeEventListener(REACHED_END_EVENT, on);
  }, []);
  // Шинэ хувилбар ирвэл алхмууд дахин эхэлнэ.
  useEffect(() => {
    setReachedEnd(false);
    setConfirmed(false);
  }, [data.rule.version_id]);

  const hasSignature = !!currentUserSignatureUrl;

  const saveProfileSignature = async (url: string | null) => {
    setSavingSignature(true);
    try {
      await apiFetch('/auth/profile', { method: 'PATCH', data: { signature_url: url } });
      await onProfileSignatureSaved();
      if (url) toast.success(t('rules.signatureSaved'));
    } catch (err) {
      console.error('[rules] profile signature save failed', err);
      toast.error(t('common.saveFailed'), err instanceof Error ? err.message : undefined);
    } finally {
      setSavingSignature(false);
    }
  };

  const signMutation = useMutation({
    mutationFn: () => signRule(data.rule.id, data.rule.version_id, data.rule.content_hash),
    onSuccess: () => {
      toast.success(t('rules.signSuccess'));
      onSigned();
    },
    onError: (err: unknown) => {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === 'VERSION_CHANGED' || code === 'HASH_MISMATCH') {
        toast.warn(t('rules.versionChangedToast'));
        onSigned();
        return;
      }
      if (code === 'ALREADY_SIGNED') {
        onSigned();
        return;
      }
      if (code === 'NO_SIGNATURE') {
        toast.error(t('rules.noSignatureToast'));
        void onProfileSignatureSaved();
        return;
      }
      toast.error(t('rules.signFailed'), err instanceof Error ? err.message : undefined);
    },
  });

  const canSign = reachedEnd && confirmed && hasSignature && !signMutation.isPending;

  const submit = async () => {
    if (!canSign) return;
    const ok = await confirmDialog({
      title: t('rules.confirmTitle'),
      description: t('rules.confirmBody', {
        title: pickLocalized(lang, data.rule.title_mn, data.rule.title_en),
        version: data.rule.version,
      }),
      confirmText: t('rules.confirmButton'),
    });
    if (!ok) return;
    signMutation.mutate();
  };

  return (
    <Card id="sec-rule-sign" className="scroll-mt-24 border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PenLine className="h-4 w-4 text-primary" aria-hidden />
          {t('rules.signCardTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* 1 — уншсан */}
        <Step n={1} done={reachedEnd && confirmed} active={!confirmed} title={t('rules.step1')}>
          {!reachedEnd && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <ChevronDown className="h-4 w-4 animate-bounce" aria-hidden />
              {t('rules.scrollToEnd')}
            </p>
          )}
          <div className="flex items-start gap-2">
            <Checkbox
              id="rule-read-confirm"
              checked={confirmed}
              disabled={!reachedEnd}
              onCheckedChange={(v) => setConfirmed(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="rule-read-confirm" className={cn('text-sm leading-snug', !reachedEnd && 'text-muted-foreground')}>
              {t('rules.readCheckbox')}
            </Label>
          </div>
        </Step>

        {/* 2 — гарын үсэг */}
        <Step n={2} done={hasSignature} active={confirmed && !hasSignature} title={t('rules.step2')}>
          {hasSignature ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-block max-w-full rounded-md border border-border bg-white p-2">
                <img
                  src={mediaUrl(currentUserSignatureUrl)}
                  alt={t('common.signature')}
                  className="h-16 max-w-full object-contain"
                />
              </div>
              <div className="space-y-1 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <UserCheck className="h-4 w-4 text-success" aria-hidden />
                  {t('rules.profileSignatureInUse')}
                </div>
                <Link to="/app/profile" className="text-primary underline-offset-2 hover:underline">
                  {t('rules.changeInProfile')}
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('rules.noProfileSignature')}</p>
              <SignatureCapture value={null} onChange={(url) => void saveProfileSignature(url)} disabled={savingSignature} />
              <Link to="/app/profile" className="text-sm text-primary underline-offset-2 hover:underline">
                {t('rules.openProfile')}
              </Link>
            </div>
          )}
        </Step>

        {/* 3 — баталгаажуулах */}
        <Step n={3} done={false} active={canSign} title={t('rules.step3')}>
          <p className="text-sm text-muted-foreground">{t('rules.step3Hint')}</p>
          <Button onClick={() => void submit()} disabled={!canSign} className="mt-1">
            {signMutation.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden />
            )}
            {t('rules.signButton')}
          </Button>
        </Step>
      </CardContent>
    </Card>
  );
}

function Step({
  n,
  title,
  done,
  active,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
          done
            ? 'border-success bg-success text-success-foreground'
            : active
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-muted text-muted-foreground',
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
