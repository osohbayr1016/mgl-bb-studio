/**
 * «Захиалагч урих» — Баримт бичгийн хуудаснаас ШУУД: байгууллага (байгаа/шинэ)
 * → энэ төсөлд эрх → холбоо барих хүн үүсгэж урилга (имэйлээр, 2026-09-18).
 *
 * Гурван алхам гурван одоо байгаа route-ыг дарааллаар дуудна
 * (`POST /client-admin/orgs`, `POST /projects/:id/access`,
 * `POST /orgs/:id/contacts` — сүүлийнх нь `send_email`).  Ямар ч алхам
 * унавал өмнөх амжилттай алхмууд ХЭВЭЭР (байгууллага үүссэн бол үлдэнэ) —
 * дараагийн оролдлого «байгаа байгууллага» сонголтоор үргэлжилнэ.
 *
 * Имэйл илгээлт унасан ч (Gmail холбогдоогүй) урилгын холбоос харагдаж
 * хуулагдана — сервер тэр хоёрыг тусад нь буцаадаг.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, MailCheck, MailWarning } from 'lucide-react';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import {
  clientSharesKey,
  createClientOrg,
  fetchClientOrgs,
  grantProjectAccess,
  inviteContact,
  type ContactInviteResult,
} from './clientShareApi';

const NEW_ORG = '__new__';

export function ClientInviteDialog({
  projectId,
  open,
  onClose,
  onInvited,
}: {
  projectId: number;
  open: boolean;
  onClose: () => void;
  /** Урилга амжилттай — дуудагч жагсаалтаа шинэчилнэ. */
  onInvited?: () => void;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const orgsQuery = useQuery({
    queryKey: ['/client-admin/orgs'],
    queryFn: fetchClientOrgs,
    enabled: open,
    staleTime: 30_000,
  });
  const orgs = useMemo(() => (orgsQuery.data?.orgs ?? []).filter((o) => o.status === 'active'), [orgsQuery.data]);

  const [orgChoice, setOrgChoice] = useState<string>(NEW_ORG);
  const [orgName, setOrgName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ContactInviteResult | null>(null);

  useEffect(() => {
    if (!open) {
      setResult(null);
      setBusy(false);
    }
  }, [open]);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit =
    !busy && fullName.trim().length > 0 && emailOk && (orgChoice !== NEW_ORG || orgName.trim().length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      let orgId: number;
      if (orgChoice === NEW_ORG) {
        const created = await createClientOrg(orgName.trim());
        orgId = created.id;
        await qc.invalidateQueries({ queryKey: ['/client-admin/orgs'] });
        // Дараагийн оролдлогод «шинэ» биш «байгаа» гэж үргэлжилнэ.
        setOrgChoice(String(orgId));
      } else {
        orgId = Number(orgChoice);
      }
      await grantProjectAccess(projectId, orgId, 'viewer');
      const res = await inviteContact(orgId, {
        full_name: fullName.trim(),
        email: email.trim(),
        send_email: sendEmail,
        project_id: projectId,
      });
      setResult(res);
      await qc.invalidateQueries({ queryKey: clientSharesKey(projectId) });
      await qc.invalidateQueries({ queryKey: [`/client-admin/projects/${projectId}/access`] });
      onInvited?.();
      if (res.email_sent) toast.success(t('projectDrive.clientInvite.emailSent', { email: email.trim() }));
      else if (res.invite_url) toast.success(t('projectDrive.clientInvite.linkReady'));
      else toast.success(t('projectDrive.clientInvite.existingAdded'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('projectDrive.clientInvite.failed'));
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    if (!result?.invite_url) return;
    void navigator.clipboard.writeText(result.invite_url);
    toast.success(t('common.copied'));
  };

  const reset = () => {
    setResult(null);
    setFullName('');
    setEmail('');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('projectDrive.clientInvite.title')}</DialogTitle>
          <DialogDescription>{t('projectDrive.clientInvite.description')}</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            {result.email_sent ? (
              <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200">
                <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('projectDrive.clientInvite.emailSent', { email: email.trim() })}</span>
              </div>
            ) : result.invite_url ? (
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                <MailWarning className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {result.email_error
                    ? t('projectDrive.clientInvite.emailFailed', { error: result.email_error })
                    : t('projectDrive.clientInvite.emailSkipped')}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('projectDrive.clientInvite.existingAdded')}</p>
            )}
            {result.invite_url && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{result.invite_url}</span>
                <Button size="icon-sm" variant="ghost" onClick={copy} title={t('common.copy')} aria-label={t('common.copy')}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">{t('projectDrive.clientInvite.linkTtl')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ci-org">{t('projectDrive.clientInvite.org')}</Label>
              <Select value={orgChoice} onValueChange={setOrgChoice} disabled={busy}>
                <SelectTrigger id="ci-org" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_ORG}>{t('projectDrive.clientInvite.newOrg')}</SelectItem>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {orgChoice === NEW_ORG && (
                <Input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder={t('projectDrive.clientInvite.orgNamePlaceholder')}
                  disabled={busy}
                  autoFocus
                />
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ci-name">{t('projectDrive.clientInvite.fullName')}</Label>
                <Input id="ci-name" value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ci-email">{t('projectDrive.clientInvite.email')}</Label>
                <Input
                  id="ci-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  aria-invalid={email.length > 0 && !emailOk}
                />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={sendEmail} onCheckedChange={(v) => setSendEmail(v === true)} disabled={busy} />
              {t('projectDrive.clientInvite.sendEmail')}
            </label>
            <p className="text-[11px] text-muted-foreground">{t('projectDrive.clientInvite.accessNote')}</p>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <>
              <Button variant="ghost" onClick={reset}>
                {t('projectDrive.clientInvite.another')}
              </Button>
              <Button onClick={onClose}>{t('common.close')}</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void submit()} disabled={!canSubmit}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t('projectDrive.clientInvite.submit')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
