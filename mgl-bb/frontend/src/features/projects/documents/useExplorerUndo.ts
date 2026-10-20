import { useCallback, useEffect, useRef, useState } from 'react';

export type UndoAction =
  | { type: 'create-folder'; id: number }
  | { type: 'create-file'; id: number }
  | { type: 'rename-folder'; id: number; prev: string }
  | { type: 'rename-file'; id: number; prev: string }
  | { type: 'trash-folder'; id: number }
  | { type: 'trash-file'; id: number }
  | { type: 'restore-folder'; id: number }
  | { type: 'restore-file'; id: number };

type UndoFns = {
  trashFolder: (id: number) => Promise<void>;
  trashFile: (id: number) => Promise<void>;
  restoreFolder: (id: number) => Promise<void>;
  restoreFile: (id: number) => Promise<void>;
  renameFolder: (id: number, name: string) => Promise<void>;
  renameFile: (id: number, name: string) => Promise<void>;
};

export function useExplorerUndo(fns: UndoFns, onDone: () => void) {
  const stack = useRef<UndoAction[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const fnsRef = useRef(fns);
  fnsRef.current = fns;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const push = useCallback((a: UndoAction) => {
    stack.current.push(a);
    setCanUndo(true);
  }, []);

  const undo = useCallback(async () => {
    const a = stack.current.pop();
    setCanUndo(stack.current.length > 0);
    if (!a) return;
    const f = fnsRef.current;
    if (a.type === 'create-folder') await f.trashFolder(a.id);
    else if (a.type === 'create-file') await f.trashFile(a.id);
    else if (a.type === 'rename-folder') await f.renameFolder(a.id, a.prev);
    else if (a.type === 'rename-file') await f.renameFile(a.id, a.prev);
    else if (a.type === 'trash-folder') await f.restoreFolder(a.id);
    else if (a.type === 'trash-file') await f.restoreFile(a.id);
    else if (a.type === 'restore-folder') await f.trashFolder(a.id);
    else await f.trashFile(a.id);
    onDoneRef.current();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      void undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  return { push, undo, canUndo };
}
