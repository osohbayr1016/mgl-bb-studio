import { FileWarning } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { useLanguage } from '@/shared/i18n';

/**
 * Ижил нэртэй файл олдвол НЭГ удаа асууна — Windows-ын «Replace / Skip»
 * логик, гэхдээ аппын өөрийн харагдац (эзний заавар, 2026-09-03).
 *
 * «Солих» нь хуучин файлыг УСТГАДАГГҮЙ: шинэ revision болж нэмэгддэг тул
 * буруу дарж бичсэн зүйлийг сэргээх боломжтой хэвээр.
 */
export function ConflictDialog({
  open,
  names,
  onDecide,
}: {
  open: boolean;
  names: string[];
  onDecide: (choice: 'replace' | 'skip' | 'cancel') => void;
}) {
  const { t } = useLanguage();
  const preview = names.slice(0, 8);
  const rest = names.length - preview.length;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onDecide('cancel')}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning className="h-5 w-5 text-amber-500" />
            {t('documentsPage.conflictTitle', { count: names.length })}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('documentsPage.conflictBody')}</p>
        <ul className="max-h-48 overflow-auto rounded-lg border border-border bg-muted/40 p-2 text-xs">
          {preview.map((name) => (
            <li key={name} className="truncate px-1 py-0.5 font-mono">
              {name}
            </li>
          ))}
          {rest > 0 ? (
            <li className="px-1 py-0.5 text-muted-foreground">
              {t('documentsPage.conflictMore', { count: rest })}
            </li>
          ) : null}
        </ul>
        <DialogFooter className="mt-2 gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => onDecide('cancel')}>
            {t('common.cancel')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onDecide('skip')}>
              {t('documentsPage.conflictSkip')}
            </Button>
            <Button onClick={() => onDecide('replace')}>
              {t('documentsPage.conflictReplace')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
