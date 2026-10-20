/** Admin-only editor for a project's display title.
 *  Extracted verbatim from `ProjectDetailPage.tsx` when that file was split
 *  into per-component modules — no behavioural change. */
import { Loader2, Pencil } from 'lucide-react';

import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { useLanguage } from '@/shared/i18n';

export function ProjectTitleDialog({
  open,
  onClose,
  draft,
  onDraftChange,
  saving,
  onSave,
  projectName,
}: {
  open: boolean;
  onClose: () => void;
  draft: string;
  onDraftChange: (v: string) => void;
  saving: boolean;
  onSave: () => void;
  projectName: string;
}) {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-primary" /> {t('projectDetailPage.editTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <Textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={3}
            placeholder={t('projectDetailPage.titlePlaceholder')}
            autoFocus
          />
          <p className="text-[11px] text-muted-foreground">
            {t('projectDetailPage.titleEmptyHint', { name: projectName })}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ProjectTitleDialog;
