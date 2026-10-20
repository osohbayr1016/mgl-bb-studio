import { useCallback, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, Link2, Loader2, RefreshCw, Send, X } from 'lucide-react';
import { apiFetch, apiFetchBlob } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';

export type SigningSlotOption = {
  slot: 'client' | 'arch' | 'site';
  label: string;
  roleLabel: string;
  signerNameHint?: string | null;
  disabled?: boolean;
};

type CreatedLink = {
  id: number;
  url: string;
  expires_at: string;
  status: 'pending';
  role_label: string;
  slot: 'client' | 'arch' | 'site';
};

type HistoryRow = {
  id: number;
  slot: 'client' | 'arch' | 'site';
  role_label: string;
  status: 'pending' | 'signed' | 'revoked' | 'expired';
  expires_at: string;
  signed_name: string | null;
  signed_at: string | null;
  snapshot_ready: number;
  document_sha256: string | null;
};

const STATUS_LABEL: Record<HistoryRow['status'], string> = {
  pending: 'Хүлээгдэж буй',
  signed: 'Зурагдсан',
  revoked: 'Цуцлагдсан',
  expired: 'Хугацаа дууссан',
};

export function SigningLinkButton({
  kind,
  entityId,
  options,
  buttonLabel = 'Гарын үсгийн link',
  size = 'sm',
  onCreated,
}: {
  kind: 'correspondence' | 'asr';
  entityId: number;
  options: SigningSlotOption[];
  buttonLabel?: string;
  size?: 'sm' | 'default';
  onCreated?: () => void;
}) {
  const enabledOptions = useMemo(() => options.filter((o) => !o.disabled), [options]);
  const first = enabledOptions[0] ?? options[0];
  const [open, setOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(first?.slot ?? 'client');
  const selected = options.find((o) => o.slot === selectedSlot) ?? first;
  const [roleLabel, setRoleLabel] = useState(first?.roleLabel ?? '');
  const [signerName, setSignerName] = useState(first?.signerNameHint ?? '');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await apiFetch<{ requests: HistoryRow[] }>(
        `/signing-links?kind=${kind}&entity_id=${entityId}`,
      );
      setHistory(res.requests);
    } catch {
      setHistory([]);
    }
  }, [kind, entityId]);

  const revoke = async (id: number) => {
    setRowBusy(id);
    try {
      await apiFetch(`/signing-links/${id}`, { method: 'DELETE' });
      toast.success('Link цуцлагдлаа');
      setCreated((c) => (c && c.id === id ? null : c));
      await loadHistory();
      onCreated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Цуцалж чадсангүй');
    } finally {
      setRowBusy(null);
    }
  };

  /** Зурагдсан баримтын өөрчлөгдөхгүй PDF нотолгоо (байхгүй бол эхлээд үүсгэнэ). */
  const evidence = async (row: HistoryRow) => {
    setRowBusy(row.id);
    try {
      if (!row.snapshot_ready) {
        await apiFetch(`/signing-links/${row.id}/snapshot`, { method: 'POST' });
        await loadHistory();
      }
      const blob = await apiFetchBlob(`/signing-links/${row.id}/snapshot`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `signed-${kind}-${entityId}-${row.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Нотолгоо татаж чадсангүй');
    } finally {
      setRowBusy(null);
    }
  };

  const select = (slot: 'client' | 'arch' | 'site') => {
    const option = options.find((o) => o.slot === slot);
    if (!option || option.disabled) return;
    setSelectedSlot(slot);
    setRoleLabel(option.roleLabel);
    setSignerName(option.signerNameHint ?? '');
    setCreated(null);
    setCopied(false);
  };

  const openDialog = () => {
    const option = enabledOptions[0] ?? first;
    if (option) {
      setSelectedSlot(option.slot);
      setRoleLabel(option.roleLabel);
      setSignerName(option.signerNameHint ?? '');
    }
    setCreated(null);
    setCopied(false);
    setOpen(true);
    void loadHistory();
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Link clipboard-д хуулагдлаа');
    } catch {
      // Safari/in-app browser: async дараах clipboard бичилтийг хориглодог.
      // prompt() биш — талбарыг сонгоод гараар хуулах боломж үлдээнэ.
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
      toast.info('Link-ийг сонгосон байна — «Хуулах» дарах эсвэл гараар хуулна уу');
    }
  };

  const create = async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const result = await apiFetch<CreatedLink>('/signing-links', {
        method: 'POST',
        data: {
          kind,
          entity_id: entityId,
          slot: selected.slot,
          role_label: roleLabel.trim() || selected.roleLabel,
          signer_name_hint: signerName.trim() || null,
          expires_in_days: days,
        },
      });
      setCreated(result);
      onCreated?.();
      void loadHistory();
      await copy(result.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Link үүсгэж чадсангүй');
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!created) return;
    if ('share' in navigator) {
      try {
        await navigator.share({
          title: 'Гарын үсэг зурах хүсэлт',
          text: `${created.role_label} — баримттай танилцаад гарын үсгээ зурна уу.`,
          url: created.url,
        });
        return;
      } catch {
        // User cancelled or Web Share is unavailable for this browser.
      }
    }
    await copy(created.url);
  };

  if (!first || enabledOptions.length === 0) return null;

  return (
    <>
      <Button type="button" variant="outline" size={size} className="gap-1.5" onClick={openDialog}>
        <Link2 className="h-4 w-4" /> {buttonLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Client-д гарын үсэг зуруулах link</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {enabledOptions.length > 1 && (
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">Гарын үсгийн мөр</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {options.map((option) => (
                    <Button
                      type="button"
                      variant="outline"
                      key={option.slot}
                      disabled={option.disabled}
                      onClick={() => select(option.slot)}
                      className={
                        'h-auto flex-col items-start whitespace-normal rounded-xl p-3 text-left text-sm ' +
                        (selectedSlot === option.slot ? 'border-primary bg-primary/5 ring-1 ring-primary' : '')
                      }
                    >
                      <span className="font-medium">{option.label}</span>
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        {option.disabled ? 'Аль хэдийн зурагдсан' : option.roleLabel}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {!created ? (
              <>
                <label className="block text-sm font-medium">
                  Гарын үсэг зурагчид харагдах нэршил
                  <input
                    value={roleLabel}
                    onChange={(e) => setRoleLabel(e.target.value)}
                    maxLength={120}
                    className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 outline-none focus:border-primary"
                  />
                </label>

                <label className="block text-sm font-medium">
                  Гарын үсэг зурах хүний нэр <span className="font-normal text-muted-foreground">(сонголттой)</span>
                  <input
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    maxLength={160}
                    placeholder="Жишээ: Б.Бат"
                    className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 outline-none focus:border-primary"
                  />
                </label>

                <label className="block text-sm font-medium">
                  Link хүчинтэй хугацаа
                  <select
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                    className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 outline-none focus:border-primary"
                  >
                    <option value={1}>1 өдөр</option>
                    <option value={3}>3 өдөр</option>
                    <option value={7}>7 өдөр</option>
                    <option value={14}>14 өдөр</option>
                    <option value={30}>30 өдөр</option>
                  </select>
                </label>

                <div className="rounded-xl border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                  Link нээсэн хүн ERP-д login хийхгүй. Зөвхөн энэ баримтыг харж, сонгосон мөрөнд
                  гарын үсэг зурна. Шинэ link үүсгэхэд өмнөх хүлээгдэж буй link автоматаар цуцлагдана.
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-success/30 bg-success/10 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-success">
                    <Check className="h-4 w-4" /> Link бэлэн
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {created.role_label} · {new Date(created.expires_at).toLocaleDateString('mn-MN')} хүртэл
                  </p>
                </div>
                <div className="flex gap-2">
                  <input
                    ref={urlInputRef}
                    readOnly
                    value={created.url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-10 min-w-0 flex-1 rounded-lg border bg-muted/20 px-3 text-xs"
                  />
                  <Button type="button" variant="outline" onClick={() => copy(created.url)}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}

            {history.length > 0 && (
              <div className="border-t pt-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Өмнөх link-үүд</div>
                <ul className="space-y-1.5">
                  {history.slice(0, 6).map((row) => (
                    <li key={row.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {row.role_label} · {STATUS_LABEL[row.status]}
                        </div>
                        <div className="truncate text-muted-foreground">
                          {row.status === 'signed'
                            ? `${row.signed_name ?? ''} · ${row.signed_at ? new Date(row.signed_at).toLocaleString('mn-MN') : ''}`
                            : `${new Date(row.expires_at).toLocaleDateString('mn-MN')} хүртэл`}
                        </div>
                      </div>
                      {row.status === 'pending' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1 px-2"
                          disabled={rowBusy === row.id}
                          onClick={() => void revoke(row.id)}
                        >
                          {rowBusy === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                          Цуцлах
                        </Button>
                      )}
                      {row.status === 'signed' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1 px-2"
                          disabled={rowBusy === row.id}
                          onClick={() => void evidence(row)}
                          title={row.document_sha256 ? `SHA-256: ${row.document_sha256}` : 'PDF нотолгоо үүсгэх'}
                        >
                          {rowBusy === row.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : row.snapshot_ready ? (
                            <Download className="h-3.5 w-3.5" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          {row.snapshot_ready ? 'PDF нотолгоо' : 'Нотолгоо үүсгэх'}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <DialogFooter>
            {!created ? (
              <Button type="button" className="gap-2" disabled={busy || !roleLabel.trim()} onClick={create}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                Link үүсгэх
              </Button>
            ) : (
              <Button type="button" className="gap-2" onClick={share}>
                <Send className="h-4 w-4" /> Илгээх / хуулах
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
