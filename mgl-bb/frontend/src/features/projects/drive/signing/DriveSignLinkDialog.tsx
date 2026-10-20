/**
 * «Баримт бичиг» → Word баримт (RFI / CR) — гаднын хүнд (захиалагч) login-гүй гарын үсгийн link
 * (2026-10-12, эзний хүсэлт; DASR-ын «Гарын үсгийн link»-тэй ижил урсгал).  ЗӨВХӨН admin.
 *
 *   1. Мөр сонгоно: баримтын хоосон мөрүүд (захиалагчийнх эхэнд, «Захиалагч» тэмдэгтэй) +
 *      захиалагчийн мөргүй RFI-д «Захиалагч хүлээн авсан мөр нэмэх» (сервер Word хүснэгтэд мөр
 *      нэмж Drive-д шинэ хувилбар болгоно).
 *   2. Link үүсгэмэгц QR код + хуулах + «Илгээх» (утасны share) — захиалагч утсаараа уншуулбал
 *      шууд гарын үсгийн хуудас нээгдэнэ.  Зурмагц гарын үсэг манай Drive-ын ЯГ тэр файлд суна;
 *      төлөв (`live` — эцэг самбарын 3 сек тутмын асуулгаас) бодит цагаар шинэчлэгдэнэ.
 *   3. Түүх: бүх link — цуцлах (хүлээгдэж буй), «Гарын үсэгтэй файл» татах (зурагдсан).
 *
 * Түүхий токентой URL зөвхөн үүсгэсэн агшинд л (DB-д hash) — цонхыг хаавал дахин харах
 * боломжгүй; шинэ link үүсгэхэд тэр мөрийн хуучин link автоматаар цуцлагдана.
 */
import { useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, CheckCircle2, Copy, Download, Eye, Link2, Loader2, Plus, Send, Smartphone, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { formatDateTime } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import type { SignLinkView, SignSlotView } from './types';

const EXPIRY_DAYS = [1, 3, 7, 14, 30] as const;
/** «Захиалагч хүлээн авсан» мөр нэмэх сонголтын түлхүүр (жинхэнэ мөрийн түлхүүртэй давхцахгүй). */
const ADD_ROW = '__add_client_row__';

/** Баримтын мөрийн үүргээс зурагчид харагдах шошго («Захиалагчаас баталсан: (Approved by client)» → «Захиалагчаас баталсан»). */
function slotRoleLabel(slot: Pick<SignSlotView, 'role' | 'client'>): string {
  const role = slot.role
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[:：]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return role || (slot.client ? 'Захиалагч' : 'Гарын үсэг');
}

export type CreateLinkBody = {
  slot_key?: string;
  add_client_row?: boolean;
  role_label: string;
  signer_name_hint: string | null;
  expires_in_days: number;
};

export function DriveSignLinkDialog({
  open,
  fileName,
  slots,
  initialSlotKey,
  clientRowAddable,
  links,
  live,
  onClose,
  onCreate,
  onRevoke,
  onDownload,
}: {
  open: boolean;
  fileName: string;
  /** Link илгээж болох мөрүүд (`can_link`). */
  slots: SignSlotView[];
  initialSlotKey?: string | null;
  clientRowAddable: boolean;
  /** Энэ файлын бүх link (шинэ нь эхэнд). */
  links: SignLinkView[];
  /** Энэ цонхонд үүсгэсэн link-ийн бодит цагийн төлөв. */
  live: SignLinkView | null;
  onClose: () => void;
  onCreate: (body: CreateLinkBody) => Promise<string>;
  onRevoke: (link: SignLinkView) => void;
  onDownload: (link: SignLinkView) => Promise<void>;
}) {
  const { t } = useLanguage();
  // Захиалагчийн мөр эхэнд — тэд л ихэвчлэн гаднаас зурна.
  const ordered = useMemo(() => [...slots].sort((a, b) => Number(b.client) - Number(a.client)), [slots]);
  const firstKey = initialSlotKey ?? ordered[0]?.key ?? (clientRowAddable ? ADD_ROW : null);
  const [selected, setSelected] = useState<string | null>(firstKey);
  const defaultsFor = (key: string | null) => {
    if (key === ADD_ROW) return { role: 'Захиалагч', name: '' };
    const s = ordered.find((x) => x.key === key);
    return { role: s ? slotRoleLabel(s) : '', name: s?.name ?? '' };
  };
  const [roleLabel, setRoleLabel] = useState(() => defaultsFor(firstKey).role);
  const [signerName, setSignerName] = useState(() => defaultsFor(firstKey).name);
  const [days, setDays] = useState<number>(7);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const urlRef = useRef<HTMLInputElement | null>(null);

  const pick = (key: string) => {
    setSelected(key);
    const d = defaultsFor(key);
    setRoleLabel(d.role);
    setSignerName(d.name);
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(t('docSign.linkCopied'));
    } catch {
      // Safari / in-app хөтөч async-ийн дараах clipboard-ыг хориглодог — талбарыг сонгоод үлдээнэ.
      urlRef.current?.focus();
      urlRef.current?.select();
      toast.info(t('docSign.linkCopyManual'));
    }
  };

  const create = async () => {
    if (busy || !selected || !roleLabel.trim()) return;
    setBusy(true);
    try {
      const created = await onCreate({
        ...(selected === ADD_ROW ? { add_client_row: true } : { slot_key: selected }),
        role_label: roleLabel.trim(),
        signer_name_hint: signerName.trim() || null,
        expires_in_days: days,
      });
      setUrl(created);
      await copy(created);
    } catch (err) {
      toast.error(t('docSign.linkCreateFailed'), err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!url) return;
    if ('share' in navigator) {
      try {
        await navigator.share({ title: t('docSign.linkShareTitle'), text: t('docSign.linkShareText', { role: roleLabel }), url });
        return;
      } catch {
        // Хэрэглэгч болиулсан эсвэл дэмжихгүй — хуулахаар.
      }
    }
    await copy(url);
  };

  const download = async (link: SignLinkView) => {
    setRowBusy(link.id);
    try {
      await onDownload(link);
    } catch (err) {
      toast.error(t('docSign.linkDownloadFailed'), err instanceof Error ? err.message : undefined);
    } finally {
      setRowBusy(null);
    }
  };

  const nothingToSign = ordered.length === 0 && !clientRowAddable;
  const pendingFor = (key: string) => links.find((l) => l.slot_key === key && (l.status === 'pending' || l.status === 'signing'));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto" data-testid="doc-sign-link-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" /> {t('docSign.linkDialogTitle')}
          </DialogTitle>
          <DialogDescription className="truncate">{fileName}</DialogDescription>
        </DialogHeader>

        {!url ? (
          <div className="space-y-4">
            {nothingToSign ? (
              <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground" data-testid="doc-sign-link-none">
                {t('docSign.linkNoRows')}
              </p>
            ) : (
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">{t('docSign.linkPickRow')}</div>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                  {ordered.map((slot) => {
                    const who = [slot.position, slot.name].filter(Boolean).join(' · ');
                    const pending = pendingFor(slot.key);
                    return (
                      <Button
                        key={slot.key}
                        type="button"
                        variant="outline"
                        role="radio"
                        aria-checked={selected === slot.key}
                        onClick={() => pick(slot.key)}
                        data-testid="doc-sign-link-option"
                        className={cn(
                          'h-auto flex-col items-start gap-0.5 whitespace-normal rounded-xl p-3 text-left text-sm',
                          selected === slot.key && 'border-primary bg-primary/5 ring-1 ring-primary',
                        )}
                      >
                        <span className="flex w-full items-center gap-1.5 font-medium">
                          <span className="min-w-0 flex-1">{slotRoleLabel(slot)}</span>
                          {slot.client && (
                            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-px text-micro font-medium text-primary">
                              {t('docSign.linkClientTag')}
                            </span>
                          )}
                        </span>
                        <span className="text-xs font-normal text-muted-foreground">{who || t('docSign.emptyName')}</span>
                        {pending && (
                          <span className="text-micro font-normal text-warning">{t('docSign.linkAlreadySent')}</span>
                        )}
                      </Button>
                    );
                  })}
                  {clientRowAddable && (
                    <Button
                      type="button"
                      variant="outline"
                      role="radio"
                      aria-checked={selected === ADD_ROW}
                      onClick={() => pick(ADD_ROW)}
                      data-testid="doc-sign-link-add-row"
                      className={cn(
                        'h-auto flex-col items-start gap-0.5 whitespace-normal rounded-xl border-dashed p-3 text-left text-sm',
                        selected === ADD_ROW && 'border-primary bg-primary/5 ring-1 ring-primary',
                      )}
                    >
                      <span className="flex items-center gap-1.5 font-medium">
                        <Plus className="h-4 w-4 text-primary" /> {t('docSign.linkAddRow')}
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">{t('docSign.linkAddRowHint')}</span>
                    </Button>
                  )}
                </div>
              </div>
            )}

            {!nothingToSign && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="doc-sign-link-role">{t('docSign.linkRoleLabel')}</Label>
                  <Input id="doc-sign-link-role" value={roleLabel} maxLength={120} onChange={(e) => setRoleLabel(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="doc-sign-link-name">
                    {t('docSign.linkSignerName')} <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
                  </Label>
                  <Input
                    id="doc-sign-link-name"
                    value={signerName}
                    maxLength={160}
                    placeholder={t('docSign.linkSignerPlaceholder')}
                    onChange={(e) => setSignerName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-sm font-medium">{t('docSign.linkExpiry')}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {EXPIRY_DAYS.map((d) => (
                      <Button
                        key={d}
                        type="button"
                        size="sm"
                        variant={days === d ? 'default' : 'outline'}
                        onClick={() => setDays(d)}
                        aria-pressed={days === d}
                      >
                        {t('docSign.linkDays', { n: d })}
                      </Button>
                    ))}
                  </div>
                </div>
                <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-xs leading-5 text-muted-foreground">
                  {selected === ADD_ROW ? t('docSign.linkAddRowExplain') : t('docSign.linkExplain')}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col items-center gap-2">
              {/* QR нь камерт уншигдахын тулд үргэлж цагаан дэвсгэр дээр (харанхуй горимд ч). */}
              <div className="rounded-xl border border-border bg-white p-2">
                <QRCodeSVG value={url} size={176} level="M" marginSize={1} aria-label={t('docSign.linkQr')} />
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Smartphone className="h-3.5 w-3.5" /> {t('docSign.linkQrHint')}
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                ref={urlRef}
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 text-xs"
                data-testid="doc-sign-link-url"
              />
              <Button type="button" variant="outline" size="icon" onClick={() => void copy(url)} aria-label={t('docSign.linkCopy')}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <LiveStatus live={live} />
          </div>
        )}

        {links.length > 0 && (
          <div className="border-t border-border pt-3" data-testid="doc-sign-link-history">
            <div className="mb-2 text-xs font-medium text-muted-foreground">{t('docSign.linkHistory')}</div>
            <ul className="space-y-1.5">
              {links.slice(0, 8).map((l) => (
                <li key={l.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">
                      {l.role_label} · {t(`docSign.linkStatus.${l.status}`)}
                    </div>
                    <div className="truncate text-muted-foreground">
                      {l.status === 'signed'
                        ? `${l.signed_name ?? ''}${l.signed_at ? ` · ${formatDateTime(l.signed_at)}` : ''}`
                        : t('docSign.linkUntil', { at: formatDateTime(l.expires_at) })}
                    </div>
                  </div>
                  {l.status === 'pending' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 px-2"
                      onClick={() => onRevoke(l)}
                      data-testid="doc-sign-link-revoke"
                    >
                      <X className="h-3.5 w-3.5" /> {t('docSign.linkRevoke')}
                    </Button>
                  )}
                  {l.status === 'signed' && l.snapshot_ready && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 px-2"
                      disabled={rowBusy === l.id}
                      onClick={() => void download(l)}
                      data-testid="doc-sign-link-download"
                    >
                      {rowBusy === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      {t('docSign.linkSignedFile')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          {!url ? (
            <Button
              type="button"
              disabled={busy || nothingToSign || !selected || !roleLabel.trim()}
              onClick={() => void create()}
              data-testid="doc-sign-link-create"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {selected === ADD_ROW ? t('docSign.linkCreateWithRow') : t('docSign.linkCreate')}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                {t('common.close')}
              </Button>
              <Button type="button" onClick={() => void share()}>
                <Send className="h-4 w-4" /> {t('docSign.linkShare')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Link-ийн бодит цагийн төлөв — зурагч нээсэн, яг одоо харж байгаа, зурсан. */
export function LiveStatus({ live, compact = false }: { live: SignLinkView | null; compact?: boolean }) {
  const { t } = useLanguage();
  if (!live) return null;
  const base = cn('flex items-center gap-1.5 rounded-lg', compact ? 'text-micro' : 'px-2.5 py-2 text-xs');
  if (live.status === 'signed') {
    return (
      <div className={cn(base, !compact && 'bg-success/10', 'text-success')} data-testid="doc-sign-link-live">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        {t('docSign.linkSignedBy', { name: live.signed_name ?? '', at: live.signed_at ? formatDateTime(live.signed_at) : '' })}
      </div>
    );
  }
  if (live.status === 'signing') {
    return (
      <div className={cn(base, !compact && 'bg-primary/10', 'text-primary')} data-testid="doc-sign-link-live">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> {t('docSign.linkSigningNow')}
      </div>
    );
  }
  if (live.status !== 'pending') return null;
  if (live.viewing_now) {
    return (
      <div className={cn(base, !compact && 'bg-primary/10', 'text-primary')} data-testid="doc-sign-link-live">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        {t('docSign.linkViewingNow')}
      </div>
    );
  }
  return (
    <div className={cn(base, !compact && 'bg-muted/50', 'text-muted-foreground')} data-testid="doc-sign-link-live">
      <Eye className="h-3.5 w-3.5 shrink-0" />
      {live.first_viewed_at
        ? t('docSign.linkOpenedAt', { at: formatDateTime(live.last_viewed_at ?? live.first_viewed_at) })
        : t('docSign.linkNotOpened', { at: formatDateTime(live.expires_at) })}
    </div>
  );
}
