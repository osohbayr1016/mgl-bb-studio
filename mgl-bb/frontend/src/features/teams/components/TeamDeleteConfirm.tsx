import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/ui/dialog';
import type { Team } from '@/shared/types';
import { useLanguage, pickLocalized } from '@/shared/i18n';

export function TeamDeleteConfirm({
  team,
  onClose,
  onConfirm,
}: {
  team: Team | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t, lang } = useLanguage();
  return (
    <Dialog open={!!team} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('teams.deleteTitle')}</DialogTitle>
          <DialogDescription>
            {t('teams.deleteDesc', {
              name: pickLocalized(lang, team?.name_mn, team?.name_en),
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
