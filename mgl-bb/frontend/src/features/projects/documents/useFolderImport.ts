import { useCallback, useRef, useState } from 'react';
import { uploadFile } from '@/shared/api/client';
import { createFolderTreeApi, findConflictsApi, registerFilesApi } from './api';
import type { ImportFileInput, ImportProgress, ScannedFile, ScannedTree } from './types';

/**
 * Бүтэн хавтсыг оруулах хоолой.  Дөрвөн алхам, тус бүр нь БАГЦ дуудлага —
 * файл бүрт хавтас үүсгээд, мөргөлдөөн шалгаад, бүртгэвэл 2000 файлтай
 * хавтас 6000 гаруй хүсэлт болно.
 *
 *   1. хавтасны мод   → POST /documents/folders/bulk   (1 хүсэлт)
 *   2. мөргөлдөөн     → POST /documents/conflicts      (1 хүсэлт)
 *   3. хэрэглэгчээс   → «Солих уу / Алгасах уу» НЭГ удаа асууна
 *   4. байршуулах     → R2 руу файл бүрээр, бүртгэл нь 25-аар багцалж
 *
 * Байршуулалт нь зэрэгцээ 3 урсгалтай: нэг нэгээр нь явуулбал сүлжээний
 * хүлээлт нийлбэр болно, хэт олон бол Worker-ийн санах ой ба хөтөчийн
 * холболтын хязгаарт тулна.
 */

const UPLOAD_CONCURRENCY = 3;
const REGISTER_BATCH = 25;

export type ConflictAsk = (names: string[]) => Promise<'replace' | 'skip' | 'cancel'>;

const IDLE: ImportProgress = {
  phase: 'done',
  done: 0,
  total: 0,
  currentName: '',
  created: 0,
  replaced: 0,
  skipped: 0,
  failed: [],
};

export function useFolderImport() {
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const cancelled = useRef(false);

  const cancel = useCallback(() => {
    cancelled.current = true;
  }, []);

  const run = useCallback(
    async (
      archiveId: number,
      rootFolderId: number | null,
      tree: ScannedTree,
      askConflict: ConflictAsk,
    ): Promise<ImportProgress> => {
      cancelled.current = false;
      let state: ImportProgress = {
        ...IDLE,
        phase: 'folders',
        total: tree.files.length,
        failed: tree.blocked.map((name) => ({ name, reason: 'bad_file_type' })),
      };
      const push = (patch: Partial<ImportProgress>) => {
        state = { ...state, ...patch };
        setProgress(state);
      };
      push({});

      // 1. Хавтасны мод.
      let folderIds: Record<string, number> = {};
      if (tree.dirs.length > 0) {
        folderIds = await createFolderTreeApi(archiveId, rootFolderId, tree.dirs);
      }
      const folderOf = (dir: string): number | null => folderIds[dir] ?? rootFolderId;

      // 2. Мөргөлдөөн — байршуулахын ӨМНӨ, дэмий трафик гаргахгүйн тулд.
      push({ phase: 'checking' });
      const conflicts = await findConflictsApi(
        archiveId,
        tree.files.map((f) => ({ folder_id: folderOf(f.dir), title: f.name })),
      );

      // 3. Нэг удаагийн асуулт (Windows-ын Replace/Skip логик).
      let policy: 'replace' | 'skip' = 'skip';
      if (conflicts.length > 0) {
        const answer = await askConflict(conflicts.map((cf) => cf.title));
        if (answer === 'cancel') {
          push({ phase: 'done' });
          return state;
        }
        policy = answer;
      }
      const conflicting = new Set(
        conflicts.map((cf) => `${cf.folder_id ?? 0} ${cf.title.toLowerCase()}`),
      );

      // 4. Байршуулах + бүртгэх.
      push({ phase: 'uploading' });
      const pending: ImportFileInput[] = [];

      const flush = async () => {
        if (pending.length === 0) return;
        const batch = pending.splice(0, pending.length);
        try {
          const res = await registerFilesApi(archiveId, batch);
          push({
            created: state.created + res.created.length,
            replaced: state.replaced + res.replaced.length,
            skipped:
              state.skipped + res.skipped.filter((s) => s.reason === 'exists').length,
            failed: [
              ...state.failed,
              ...res.skipped
                .filter((s) => s.reason !== 'exists')
                .map((s) => ({ name: s.title, reason: s.reason })),
            ],
          });
        } catch {
          push({
            failed: [...state.failed, ...batch.map((f) => ({ name: f.title, reason: 'register' }))],
          });
        }
      };

      const queue = [...tree.files];
      const worker = async () => {
        for (;;) {
          if (cancelled.current) return;
          const item = queue.shift();
          if (!item) return;
          const folderId = folderOf(item.dir);
          if (policy === 'skip' && conflicting.has(`${folderId ?? 0} ${item.name.toLowerCase()}`)) {
            push({ done: state.done + 1, skipped: state.skipped + 1 });
            continue;
          }
          push({ currentName: item.name });
          try {
            const url = await uploadFile(item.file);
            pending.push({
              folder_id: folderId,
              title: item.name,
              file_url: url,
              file_name: item.name,
              file_type: item.file.type || null,
              file_size: item.file.size,
              on_conflict: policy,
            });
          } catch {
            push({ failed: [...state.failed, { name: item.name, reason: 'upload' }] });
          }
          push({ done: state.done + 1 });
          if (pending.length >= REGISTER_BATCH) await flush();
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length || 1) }, worker),
      );
      await flush();
      push({ phase: 'done', currentName: '' });
      return state;
    },
    [],
  );

  const clear = useCallback(() => setProgress(null), []);

  return { progress, run, cancel, clear };
}

/** Импортод орох файлын нэрийг харуулах туслах. */
export function fileLabel(f: ScannedFile): string {
  return f.dir ? `${f.dir}/${f.name}` : f.name;
}
