import { useEffect } from 'react';
import type { DocumentItem } from '@/shared/types';
import type { DocFolder, ExplorerSelection } from './types';

function isTyping(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
}

export function useExplorerHotkeys({
  folders,
  files,
  selection,
  onSelect,
  onOpenFolder,
  onOpenFile,
  onRename,
  onDelete,
  onUp,
}: {
  folders: DocFolder[];
  files: DocumentItem[];
  selection: ExplorerSelection;
  onSelect: (s: ExplorerSelection) => void;
  onOpenFolder: (id: number) => void;
  onOpenFile: (file: DocumentItem) => void;
  onRename: () => void;
  onDelete: () => void;
  onUp: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        onUp();
        return;
      }
      const items: ExplorerSelection[] = [
        ...folders.map((f) => ({
          kind: 'folder' as const,
          id: f.id,
          name: f.name,
          isSystem: f.is_system === 1,
        })),
        ...files.map((d) => ({ kind: 'file' as const, id: d.id, name: d.file_name || d.title })),
      ];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length === 0) return;
        const i = items.findIndex(
          (it) => it && selection && it.kind === selection.kind && it.id === selection.id,
        );
        const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i <= 0 ? 0 : i - 1);
        const pick = items[i < 0 ? 0 : next];
        if (pick) onSelect(pick);
        return;
      }
      if (!selection) return;
      if (e.key === 'Enter') {
        if (selection.kind === 'folder') onOpenFolder(selection.id);
        else {
          const file = files.find((d) => d.id === selection.id);
          if (file) onOpenFile(file);
        }
      } else if (e.key === 'F2') {
        onRename();
      } else if (e.key === 'Delete') {
        if (selection.kind === 'file' || !selection.isSystem) onDelete();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [folders, files, selection, onSelect, onOpenFolder, onOpenFile, onRename, onDelete, onUp]);
}
