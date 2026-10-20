/**
 * «Захиалагчид нээх» — нэг хавтас/файлыг аль байгууллагад харуулахыг сонгох
 * цонх (миграц 0327).  Мөр бүрийн Share2 товчноос нээгдэнэ.
 *
 *   • Зөвхөн энэ төсөлд ИДЭВХТЭЙ эрхтэй байгууллага сонгогдоно (сервер ч
 *     409-өөр шалгадаг) — эрхгүй бол «Захиалагч урих» рүү хөтөлнө.
 *   • Хавтас нээвэл ДЭД МОД бүхэлдээ, файл нээвэл зөвхөн тэр файл — цонх
 *     үүнийг ил хэлнэ (ажилтан «зөвхөн энэ хавтас» гэж бодож болзошгүй).
 *   • Сонголтын өөрчлөлт = нэмэгдсэн байгууллагад POST, хасагдсанд DELETE
 *     (revoke); ижил бол юу ч илгээхгүй.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { describeDriveError } from './driveErrors';
import {
  clientSharesKey,
  createClientShare,
  fetchClientShares,
  revokeClientShare,
  type ClientDriveShare,
} from './clientShareApi';
import type { DriveItem } from './types';

export function ClientShareDialog({
  projectId,
  item,
  onClose,
  onInvite,
}: {
  projectId: number;
  /** null = хаалттай. */
  item: DriveItem | null;
  onClose: () => void;
  /** «Захиалагч урих» — байгууллага/хүн үүсгэх цонх руу. */
  onInvite: () => void;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const open = item !== null;
  const shares = useQuery({
    queryKey: clientSharesKey(projectId),
    queryFn: () => fetchClientShares(projectId),
    enabled: open,
    staleTime: 15_000,
  });

  const orgs = shares.data?.orgs ?? [];
  /** Энэ зүйлийг аль байгууллагад аль хэдийн нээсэн бэ — org_id → share. */
  const existing = useMemo(() => {
    const m = new Map<number, ClientDriveShare>();
    for (const s of shares.data?.shares ?? []) {
      if (item && s.drive_item_id === item.id && !s.revoked_at) m.set(s.org_id, s);
    }
    return m;
  }, [shares.data, item]);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [forId, setForId] = useState<string | null>(null);

  // Цонх нээгдэх / өгөгдөл ирэх үед одоогийн төлөвөөр урьдчилан бөглөнө.
  useEffect(() => {
    if (!item || !shares.data) return;
    if (forId === item.id) return;
    setForId(item.id);
    setSelected(new Set(existing.keys()));
    setNote([...existing.values()][0]?.note ?? '');
  }, [item, shares.data, existing, forId]);
  useEffect(() => {
    if (!item) setForId(null);
  }, [item]);

  const toggle = (orgId: number, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(orgId);
      else next.delete(orgId);
      return next;
    });
  };

  const save = async () => {
    if (!item) return;
    const add = [...selected].filter((id) => !existing.has(id));
    const remove = [...existing.values()].filter((s) => !selected.has(s.org_id));
    if (add.length === 0 && remove.length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      if (add.length > 0) {
        await createClientShare(projectId, { org_ids: add, item_id: item.id, note: note.trim() || null });
      }
      for (const s of remove) await revokeClientShare(projectId, s.id);
      await qc.invalidateQueries({ queryKey: clientSharesKey(projectId) });
      toast.success(
        add.length > 0
          ? t('projectDrive.clientShare.savedOpened', { name: item.name, count: add.length })
          : t('projectDrive.clientShare.savedClosed', { name: item.name }),
      );
      onClose();
    } catch (err) {
      toast.error(t(describeDriveError(err).key));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('projectDrive.clientShare.title')}</DialogTitle>
          <DialogDescription className="break-words">
            {item?.kind === 'folder'
              ? t('projectDrive.clientShare.folderHint', { name: item.name })
              : t('projectDrive.clientShare.fileHint', { name: item?.name ?? '' })}
          </DialogDescription>
        </DialogHeader>

        {shares.isPending ? (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : shares.isError ? (
          <p className="text-sm text-destructive">{t(describeDriveError(shares.error).key)}</p>
        ) : orgs.length === 0 ? (
          <div className="space-y-3 rounded-lg border border-dashed border-border p-4 text-center">
            <FolderOpen className="mx-auto h-6 w-6 text-muted-foreground/60" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">{t('projectDrive.clientShare.noOrgs')}</p>
            <Button size="sm" variant="outline" onClick={onInvite}>
              <UserPlus className="h-4 w-4" /> {t('projectDrive.clientShare.invite')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <ul className="divide-y divide-border/60 rounded-lg border border-border">
              {orgs.map((o) => {
                const id = `cs-org-${o.org_id}`;
                const already = existing.get(o.org_id);
                return (
                  <li key={o.org_id} className="flex items-center gap-3 px-3 py-2">
                    <Checkbox
                      id={id}
                      checked={selected.has(o.org_id)}
                      onCheckedChange={(v) => toggle(o.org_id, v === true)}
                      disabled={busy}
                    />
                    <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block truncate text-sm font-medium">{o.org_name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {t('projectDrive.clientShare.contactCount', { count: o.contact_count })}
                        {already ? ` · ${t('projectDrive.clientShare.alreadyShared')}` : ''}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('projectDrive.clientShare.notePlaceholder')}
              maxLength={500}
              disabled={busy}
            />
            <div className="flex justify-between">
              <Button size="sm" variant="ghost" onClick={onInvite} disabled={busy}>
                <UserPlus className="h-4 w-4" /> {t('projectDrive.clientShare.invite')}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={busy || shares.isPending || orgs.length === 0}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
