/**
 * Байршуулалтын хоёр жижиг цонх:
 *   • «Шинэ хавтас» — нэр асууж `createDriveFolder(reuse:true)`; ижил нэртэй
 *     байвал алдаа биш, тэр хавтсыг буцаана (UI мэдэгдэнэ);
 *   • «Ижил нэртэй файл байна» — солих (Drive шинэ хувилбар) / хоёуланг
 *     үлдээх / болих — гурван сонголттой тул `confirmDialog` (тийм/үгүй)
 *     хүрэлцэхгүй.
 */
import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { createDriveFolder, renameDriveItem } from './api';
import { describeDriveError } from './driveErrors';
import type { DriveItem, DriveScope, DriveUploadConflict } from './types';

/** «Нэр солих» — файл/хавтас; Drive дээр шууд солигдоно (2026-09-18). */
export function DriveRenameDialog({
  scope,
  id,
  item,
  onClose,
  onRenamed,
}: {
  scope: DriveScope;
  id: number;
  /** null = хаалттай. */
  item: DriveItem | null;
  onClose: () => void;
  onRenamed: (item: DriveItem) => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forId, setForId] = useState<string | null>(null);
  // Цонх нээгдэх бүрт одоогийн нэрийг урьдчилан бичнэ.
  if (item && forId !== item.id) {
    setForId(item.id);
    setName(item.name);
    setError(null);
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!item || !trimmed || busy) return;
    if (trimmed === item.name) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await renameDriveItem(scope, id, item.id, trimmed);
      toast.success(t('projectDrive.renamedToast', { name: res.item.name }));
      await onRenamed(res.item);
      onClose();
    } catch (err) {
      setError(t(describeDriveError(err).key));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={item !== null} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('projectDrive.renameTitle')}</DialogTitle>
            <DialogDescription className="truncate">{item?.name}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={255}
            disabled={busy}
            onFocus={(e) => {
              // Өргөтгөлийг үлдээж нэрийг нь л сонгоно (файлд).
              const dot = item?.kind === 'file' ? e.target.value.lastIndexOf('.') : -1;
              e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
            }}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('projectDrive.renameSave')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DriveNewFolderDialog({
  scope,
  id,
  parentId,
  open,
  onClose,
  onCreated,
}: {
  scope: DriveScope;
  id: number;
  parentId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (item: DriveItem, created: boolean) => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createDriveFolder(scope, id, parentId, trimmed, { reuse: true });
      if (res.created) toast.success(t('projectDrive.newFolderCreated', { name: res.item.name }));
      else toast.info(t('projectDrive.newFolderExists', { name: res.item.name }));
      setName('');
      await onCreated(res.item, res.created);
      onClose();
    } catch (err) {
      setError(t(describeDriveError(err).key));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('projectDrive.newFolderTitle')}</DialogTitle>
            <DialogDescription>{t('projectDrive.uploadHint')}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('projectDrive.newFolderName')}
            maxLength={255}
            disabled={busy}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('projectDrive.newFolderCreate')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DriveUploadConflictDialog({
  names,
  onChoose,
}: {
  /** Хоосон = цонх хаалттай. */
  names: string[];
  /** null = болих. */
  onChoose: (conflict: DriveUploadConflict | null) => void;
}) {
  const { t } = useLanguage();
  const open = names.length > 0;
  const shown = names.slice(0, 5).join(', ') + (names.length > 5 ? ` … (+${names.length - 5})` : '');
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onChoose(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('projectDrive.conflictTitle')}</DialogTitle>
          <DialogDescription>
            {t('projectDrive.conflictBody', { n: String(names.length), names: shown })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <button
            type="button"
            className="w-full rounded-lg border border-border p-3 text-left hover:bg-muted/50"
            onClick={() => onChoose('replace')}
          >
            <p className="text-sm font-medium text-foreground">{t('projectDrive.conflictReplace')}</p>
            <p className="text-xs text-muted-foreground">{t('projectDrive.conflictReplaceHint')}</p>
          </button>
          <button
            type="button"
            className="w-full rounded-lg border border-border p-3 text-left hover:bg-muted/50"
            onClick={() => onChoose('keep')}
          >
            <p className="text-sm font-medium text-foreground">{t('projectDrive.conflictKeep')}</p>
            <p className="text-xs text-muted-foreground">{t('projectDrive.conflictKeepHint')}</p>
          </button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onChoose(null)}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
