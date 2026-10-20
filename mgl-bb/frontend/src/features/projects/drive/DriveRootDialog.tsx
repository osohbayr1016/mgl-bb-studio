/**
 * Админ: Drive-ийн ҮНДСЭН хавтас — бүх төслийн хавтсыг агуулсан том хавтас
 * (2026-09-24, `routes/mainProjects.ts` `/drive-root`).
 *
 * Холбосны дараа сервер 2 минут тутмын Drive сонсогчийн тикээр тэр хавтасны
 * шууд хүүхдүүдийг уншиж, холбогдоогүй шинэ хавтас бүрийг ҮНДСЭН ТӨСӨЛ болгон
 * автоматаар нэмнэ (`lib/projectDriveDiscovery.ts`).  Холбох / «Одоо шалгах» /
 * «Буцааж нэмэх» нь cron-ыг хүлээлгүй тэр даруй илрүүлнэ.
 *
 * Админ устгасан / салгасан хавтас «алгасах» жагсаалтад орж дахин
 * автоматаар үүсэхгүй — энд харагдаж, нэг товчоор буцаагдана.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, FolderOpen, Link2, Loader2, RefreshCw, RotateCcw, Unlink } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { formatDateTime } from '@/shared/lib/time';
import { driveRootKey, fetchDriveRoot, restoreIgnoredDriveFolder, setDriveRoot, syncDriveRoot } from './api';
import { describeDriveError } from './driveErrors';
import type { DriveRootState } from './types';

type Busy = 'link' | 'unlink' | 'sync' | `restore:${string}` | null;

export function DriveRootDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const q = useQuery<DriveRootState>({ queryKey: driveRootKey, queryFn: fetchDriveRoot, enabled: open, retry: false });
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const data = q.data;
  const root = data?.root ?? null;

  /** Үр дүнг кэшэнд тавьж, үндсэн төслийн жагсаалтыг шинэчилнэ. */
  const apply = async (res: DriveRootState, announce: boolean) => {
    qc.setQueryData(driveRootKey, res);
    await qc.invalidateQueries({ queryKey: ['project-drive'] });
    if (!announce) return;
    const created = res.created ?? [];
    if (created.length > 0) {
      toast.success(
        t('driveRoot.createdToast', { count: created.length, names: created.map((f) => f.name).join(', ') }),
      );
    } else {
      toast.success(t('driveRoot.noneToast'));
    }
  };

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<DriveRootState>, announce = true) => {
    setBusy(kind);
    setError(null);
    try {
      await apply(await fn(), announce);
      return true;
    } catch (err) {
      setError(t(describeDriveError(err).key));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const link = async () => {
    const folder = value.trim();
    if (!folder) return;
    if (await run('link', () => setDriveRoot(folder))) setValue('');
  };

  const unlink = async () => {
    const ok = await confirmDialog({
      title: t('driveRoot.unlinkTitle'),
      description: t('driveRoot.unlinkConfirm'),
      confirmText: t('projectDrive.unlink'),
      variant: 'destructive',
    });
    if (!ok) return;
    await run('unlink', () => setDriveRoot(null), false);
  };

  const copyEmail = async () => {
    if (!data?.service_email) return;
    try {
      await navigator.clipboard.writeText(data.service_email);
      setCopied(true);
    } catch {
      /* clipboard хаалттай орчин — хэрэглэгч гараар хуулна */
    }
  };

  const last = data?.last ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('driveRoot.title')}</DialogTitle>
          <DialogDescription>{t('driveRoot.intro')}</DialogDescription>
        </DialogHeader>

        {q.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('common.loading')}
          </div>
        ) : q.isError ? (
          <p className="text-sm text-destructive">{t(describeDriveError(q.error).key)}</p>
        ) : data && !data.configured ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
            {t('projectDrive.errNotConfigured')}
          </p>
        ) : (
          <div className="space-y-4">
            {root ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 truncate font-medium">{root.name}</span>
                  <Button size="xs" variant="ghost" asChild>
                    <a href={root.open_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3" /> {t('projectDrive.openInDrive')}
                    </a>
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="ml-auto text-destructive hover:text-destructive"
                    onClick={unlink}
                    disabled={busy !== null}
                  >
                    {busy === 'unlink' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
                    {t('projectDrive.unlink')}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => void run('sync', syncDriveRoot)} disabled={busy !== null}>
                    {busy === 'sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {t('driveRoot.syncNow')}
                  </Button>
                  <span className="text-xs text-muted-foreground">{t('driveRoot.autoHint')}</span>
                </div>
                {last?.error ? (
                  <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
                    {t('driveRoot.lastError', { at: formatDateTime(last.at) })}
                  </p>
                ) : last && last.created.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t('driveRoot.lastCreated', { at: formatDateTime(last.at), names: last.created.join(', ') })}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
                {t('driveRoot.notLinked')}
              </p>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {root ? t('driveRoot.changeLabel') : t('driveRoot.linkLabel')}
              </label>
              <div className="flex gap-2">
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={t('projectDrive.folderPlaceholder')}
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void link();
                    }
                  }}
                />
                <Button onClick={link} disabled={busy !== null || value.trim().length === 0}>
                  {busy === 'link' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  {root ? t('projectDrive.relink') : t('projectDrive.link')}
                </Button>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            {data?.service_email && (
              <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                <p>{t('driveRoot.shareHint')}</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-micro text-foreground">
                    {data.service_email}
                  </code>
                  <Button size="icon-xs" variant="ghost" onClick={copyEmail} title={t('common.copy')}>
                    {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            )}

            {(data?.ignored.length ?? 0) > 0 && (
              <div className="space-y-1.5 border-t border-border pt-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t('driveRoot.ignoredTitle', { count: data!.ignored.length })}
                </p>
                <p className="text-micro text-muted-foreground">{t('driveRoot.ignoredHint')}</p>
                <ul className="max-h-48 space-y-1 overflow-auto">
                  {data!.ignored.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50">
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => void run(`restore:${f.id}`, () => restoreIgnoredDriveFolder(f.id))}
                        disabled={busy !== null}
                      >
                        {busy === `restore:${f.id}` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        {t('driveRoot.restore')}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
