import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import {
  createFolderApi,
  renameFileApi,
  renameFolderApi,
  trashFileApi,
  trashFolderApi,
  uploadIntoFolder,
} from './api';
import type { ExplorerSelection } from './types';
import type { UndoAction } from './useExplorerUndo';

export function useExplorerHandlers(
  archiveId: number,
  folderId: number | null,
  selection: ExplorerSelection,
  pushUndo: (a: UndoAction) => void,
) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  // Чирж/буулгаж оруулахад дарах товч байхгүй тул явцыг оверлэйгээр харуулна.
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['/documents/browse', archiveId] });
  }, [qc, archiveId]);

  // 409 = ижил нэртэй хөрш хавтас байна.  Ерөнхий «болсонгүй» гэвэл
  // хэрэглэгч юуг засахаа мэдэхгүй.
  const fail = (err?: unknown) =>
    toast.error(
      err instanceof ApiError && err.status === 409
        ? t('documentsPage.nameTaken')
        : t('documentsPage.failed'),
    );

  const createFolder = async (name: string) => {
    try {
      const id = await createFolderApi(archiveId, folderId, name);
      pushUndo({ type: 'create-folder', id });
      refresh();
    } catch (err) {
      fail(err);
    }
  };

  const rename = async (name: string) => {
    if (!selection) return;
    try {
      if (selection.kind === 'folder') {
        await renameFolderApi(selection.id, name);
        pushUndo({ type: 'rename-folder', id: selection.id, prev: selection.name });
      } else {
        await renameFileApi(selection.id, name);
        pushUndo({ type: 'rename-file', id: selection.id, prev: selection.name });
      }
      refresh();
    } catch (err) {
      fail(err);
    }
  };

  const remove = async (): Promise<boolean> => {
    if (!selection || (selection.kind === 'folder' && selection.isSystem)) return false;
    if (!(await confirmDialog({ description: t('documentsPage.confirmDelete'), variant: 'destructive' })))
      return false;
    try {
      if (selection.kind === 'folder') {
        await trashFolderApi(selection.id);
        pushUndo({ type: 'trash-folder', id: selection.id });
      } else {
        await trashFileApi(selection.id);
        pushUndo({ type: 'trash-file', id: selection.id });
      }
      refresh();
      return true;
    } catch {
      fail();
      return false;
    }
  };

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const items = Array.from(list);
    setUploading({ done: 0, total: items.length });
    try {
      for (const [i, file] of items.entries()) {
        try {
          const id = await uploadIntoFolder(archiveId, folderId, file);
          pushUndo({ type: 'create-file', id });
        } catch (err) {
          toast.error(
            err instanceof Error && err.message === 'bad_file_type'
              ? t('documentsPage.badFileType')
              : t('documentsPage.failed'),
            file.name,
          );
        }
        setUploading({ done: i + 1, total: items.length });
      }
    } finally {
      setUploading(null);
    }
    refresh();
    if (fileRef.current) fileRef.current.value = '';
  };

  return { fileRef, dirRef, refresh, createFolder, rename, remove, onFiles, uploading };
}
