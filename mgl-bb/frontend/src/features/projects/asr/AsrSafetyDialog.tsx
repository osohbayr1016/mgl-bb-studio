import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { ApiError } from '@/shared/api/client';
import { ErrorState } from '@/shared/components/ErrorState';
import { useAuth } from '@/shared/context/AuthContext';
import { SignatureCapture } from '@/shared/components/SignatureCapture';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Label } from '@/ui/label';
import { useAsrSafetyAcknowledge, useAsrSafetyContent } from './api';

/**
 * ХАБ-ын (хөдөлмөрийн аюулгүй байдал, эрүүл ахуй) мэдээлэл + танилцсан
 * баталгаа — «Шинэ тайлан» ба тайлангийн засварлагчийн ХООРОНД заавал
 * орох алхам (эзний хүсэлт 2026-09-21).
 *
 * Дөрвөн шат:
 *   1. уншина  — гүйлгэлтийн хаалт ЗОРИУД байхгүй (эзний хүсэлт 2026-09-28:
 *                чагтыг доош гүйлгэлгүйгээр шууд тэмдэглэж болдог байх)
 *   2. чагтална — «уншиж ойлгосон» (серверт ч `confirmed: true` шаардана)
 *   3. зурна   — профайлд хадгалсан гарын үсэг (`users.signature_url`)
 *                байвал АВТОМАТААР орно (эзний хүсэлт 2026-09-23);
 *                үгүй бол `SignatureCapture` (canvas / файл) → `/media/<key>`
 *   4. батална — `POST /safety/acknowledgements` → `onConfirmed(ackId)`;
 *                дуудагч тэр id-тай ноорог нээнэ, сервер түүнгүйгээр
 *                тайлан үүсгэхгүй.
 *
 * Бичвэр нь СЕРВЕРЭЭС (`lib/asrSafety.ts`) — энд нэг ч өгүүлбэр байхгүй,
 * учир нь гарын үсэг зурсан мөр `content_hash`-аараа яг тэр бичвэрт
 * холбогдох ёстой.  Бичвэр солигдсон (409 `STALE_CONTENT`) бол дахин
 * татаж, чагтыг арилгана.
 */
export function AsrSafetyDialog({
  open,
  projectId,
  onOpenChange,
  onConfirmed,
}: {
  open: boolean;
  /** Мэдэгдэж байвал баталгаанд хадгална; /app/asr-аас бол төсөл дараа сонгогдоно. */
  projectId: number | null;
  onOpenChange: (v: boolean) => void;
  onConfirmed: (ackId: number) => void;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const content = useAsrSafetyContent(open);
  const profileSignature = user?.signature_url ?? null;
  const ack = useAsrSafetyAcknowledge();

  const [checked, setChecked] = useState(false);
  const [sigUrl, setSigUrl] = useState<string | null>(null);

  const data = content.data;
  const busy = ack.isPending;

  /**
   * Профайлын гарын үсгийг цонх нээгдэхэд шууд тавина — тайлан үүсгэж буй
   * хүн нь нэвтэрсэн хэрэглэгч учраас «хэн зурж байна» асуух зүйлгүй.
   * Хэрэглэгч хүсвэл дээрээс нь дахин зурж/сольж болно (тиймээс зөвхөн
   * ХООСОН үед тавина).
   */
  useEffect(() => {
    if (open && profileSignature) setSigUrl((prev) => prev ?? profileSignature);
  }, [open, profileSignature]);

  const canConfirm = checked && !!sigUrl && !!data && !busy;

  const confirm = async () => {
    if (!data || !sigUrl || !checked) return;
    try {
      const res = await ack.mutateAsync({
        project_id: projectId,
        content_version: data.content.version,
        content_hash: data.hash,
        signature_url: sigUrl,
        confirmed: true,
      });
      toast.success(t('asr.safety.confirmed'));
      onConfirmed(res.acknowledgement.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STALE_CONTENT') {
        // Бичвэр солигдсон — хуучин hash-тай баталгаа хүчингүй.  Шинийг
        // татаж, чагтыг арилгана; гарын үсэг хэвээр үлдэнэ.
        toast.warn(t('asr.safety.stale'));
        setChecked(false);
        void content.refetch();
        return;
      }
      toast.error(err instanceof Error ? err.message : t('asr.safety.failed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent
        className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:flex sm:max-w-2xl sm:gap-0 sm:p-0"
        data-testid="asr-safety-dialog"
      >
        <DialogHeader className="shrink-0 space-y-1 border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
            {t('asr.safety.title')}
          </DialogTitle>
          <DialogDescription>{t('asr.safety.hint')}</DialogDescription>
        </DialogHeader>

        <div
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4"
          data-testid="asr-safety-body"
        >
          {content.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : content.isError || !data ? (
            <ErrorState error={content.error} onRetry={() => void content.refetch()} />
          ) : (
            <div className="space-y-5">
              {data.content.placeholder && (
                <Callout tone="warn">{t('asr.safety.placeholderWarning')}</Callout>
              )}

              <div className="space-y-1">
                <h3 className="text-base font-semibold">{data.content.title}</h3>
                {data.content.intro && (
                  <p className="text-sm text-muted-foreground">{data.content.intro}</p>
                )}
              </div>

              {data.content.sections.map((s, i) => (
                <section key={i} className="space-y-1.5">
                  <h4 className="text-sm font-semibold">
                    {i + 1}. {s.heading}
                  </h4>
                  <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
                    {s.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}

              <p className="text-xs text-muted-foreground">
                {t('asr.safety.version', { version: data.content.version })}
              </p>

              {/* ---- 2. чагт ---- */}
              <label
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm"
                data-testid="asr-safety-confirm-row"
              >
                <Checkbox
                  checked={checked}
                  disabled={busy}
                  onCheckedChange={(v) => setChecked(v === true)}
                  className="mt-0.5"
                  data-testid="asr-safety-checkbox"
                />
                <span>{data.content.confirmText}</span>
              </label>

              {/* ---- 3. гарын үсэг ---- */}
              <div className="space-y-2 rounded-lg border p-3" data-testid="asr-safety-signature">
                <Label className="text-sm font-medium">{t('asr.safety.signatureLabel')}</Label>
                <p className="text-xs text-muted-foreground">{t('asr.safety.signatureHint')}</p>
                <SignatureCapture
                  value={sigUrl}
                  onChange={setSigUrl}
                  disabled={busy}
                  savedUrl={profileSignature}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t px-5 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            className="gap-2"
            disabled={!canConfirm}
            onClick={() => void confirm()}
            data-testid="asr-safety-submit"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            {t('asr.safety.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Callout({ tone, children }: { tone: 'warn'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
        tone === 'warn' && 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200',
      )}
      role="status"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
