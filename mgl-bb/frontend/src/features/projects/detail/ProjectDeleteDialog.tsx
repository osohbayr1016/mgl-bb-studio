/** Admin-only hard-delete confirmation for a project.
 *  Extracted verbatim from `ProjectDetailPage.tsx` when that file was split
 *  into per-component modules — no behavioural change. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Trash2 } from 'lucide-react';

import { apiFetch } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { useLanguage } from '@/shared/i18n';

export function ProjectDeleteDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string | undefined;
  projectName: string;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="w-5 h-5" /> {t('projectDetailPage.deleteProject')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            <span className="font-semibold text-foreground">{projectName}</span>{' '}
            {t('projectDetailPage.deleteConfirm')}
          </p>
          <p className="text-muted-foreground">{t('projectDetailPage.deleteWarning')}</p>
        </div>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="outline" disabled={deleting}>
              {t('projectDetailPage.cancelAction')}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              try {
                await apiFetch(`/projects/${projectId}`, { method: 'DELETE' });
                toast.success(t('projectDetailPage.projectDeleted'));
                navigate('/app/projects');
              } catch (e) {
                toast.error(e instanceof Error ? e.message : t('projectDetailPage.deleteError'));
                setDeleting(false);
              }
            }}
          >
            {deleting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('projectDetailPage.deleting')}
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4 mr-2" /> {t('projectDetailPage.confirmDelete')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ProjectDeleteDialog;
