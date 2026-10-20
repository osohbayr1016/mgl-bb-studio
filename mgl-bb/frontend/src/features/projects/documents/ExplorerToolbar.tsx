import { FolderPlus, FolderUp, Upload, Pencil, Trash2, Undo2, Recycle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';
import type { ExplorerSelection } from './types';

export function ExplorerToolbar({
  archiveId,
  selection,
  canUndo,
  onNewFolder,
  onUpload,
  onUploadFolder,
  onRename,
  onDelete,
  onUndo,
}: {
  archiveId: number;
  selection: ExplorerSelection;
  canUndo: boolean;
  onNewFolder: () => void;
  onUpload: () => void;
  onUploadFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onUndo: () => void;
}) {
  const { t } = useLanguage();
  // Нэр солих нь загварын хавтсанд ч зөвшөөрөгдөнө (хавтасны биет нь `code`),
  // харин устгах нь загварын бүтцийг хамгаалж хоригтой хэвээр.
  const canRename = selection != null;
  const canDelete = selection != null && (selection.kind === 'file' || !selection.isSystem);
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2.5">
      <Button size="sm" onClick={onNewFolder}>
        <FolderPlus />
        {t('documentsPage.newFolder')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="border-white/20 bg-white text-neutral-900 hover:bg-white/90 dark:bg-white dark:text-neutral-900 dark:hover:bg-white/90"
        onClick={onUpload}
      >
        <Upload />
        {t('documentsPage.upload')}
      </Button>
      <Button size="sm" variant="outline" onClick={onUploadFolder}>
        <FolderUp />
        {t('documentsPage.importFolder')}
      </Button>
      <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
      <Button size="icon-sm" variant="ghost" disabled={!canRename} onClick={onRename} title={t('documentsPage.rename')}>
        <Pencil />
      </Button>
      <Button size="icon-sm" variant="ghost" disabled={!canDelete} onClick={onDelete} title={t('documentsPage.delete')}>
        <Trash2 />
      </Button>
      <Button size="icon-sm" variant="ghost" disabled={!canUndo} onClick={onUndo} title={t('documentsPage.undo')}>
        <Undo2 />
      </Button>
      <div className="ml-auto flex items-center gap-1">
        <Button size="sm" variant="ghost" className="text-muted-foreground" asChild>
          <Link to={`/app/documents/${archiveId}?trash=1`}>
            <Recycle />
            <span className="hidden sm:inline">{t('documentsPage.recycleBin')}</span>
          </Link>
        </Button>
      </div>
    </div>
  );
}
