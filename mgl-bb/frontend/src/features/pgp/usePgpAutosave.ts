import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/shared/api/client';
import type { PgpPlan } from '@/shared/types';
import type { SaveStatus } from '@/shared/components/SaveBar';

type Answers = Record<string, string>;

/**
 * Нэг PGP-ийн маягтын agуулгыг client талд autosave хийх hook —
 * useQuoteAutosave-ийн хэв маягийг (2.5с debounce, blur/beforeunload flush,
 * in-flight үед хамгийн сүүлийн payload-ыг queue, last-write-wins) дуурайв.
 *
 * ЧУХАЛ: `planId` mount дотор тогтмол гэж үзнэ — period солигдоход хэрэглэгч
 * талаас `key={plan.id}`-ээр компонентыг remount хийж бүх state-ийг цэвэрлэнэ.
 */
export function usePgpAutosave(planId: number, initial: Answers, initialSavedAt: string | null) {
  const queryClient = useQueryClient();
  const [answers, setLocal] = useState<Answers>(initial);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(initialSavedAt);

  const answersRef = useRef<Answers>(initial);
  const dirtyRef = useRef(false);
  const inFlight = useRef(false);
  const versionRef = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performSave = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus('saving');
    const sentVersion = versionRef.current;
    const sentAnswers = answersRef.current;
    try {
      const res = await apiFetch<{ ok: boolean; updated_at: string | null }>(`/pgp/${planId}`, {
        method: 'PUT',
        data: { answers: sentAnswers },
      });
      // Ирцийн гарах-хаалт болон профайл таб '/pgp/my' кэшийг хуваалцдаг тул
      // хадгалагдсан хариултыг шууд тусгана — эс бөгөөс staleTime дуустал
      // хаалт тайлагдахгүй, буцаж очиход маягт хуучин кэшээс дүүргэгдэнэ.
      queryClient.setQueryData<{ plans: PgpPlan[] }>(['/pgp/my'], (prev) =>
        prev
          ? {
              ...prev,
              plans: prev.plans.map((p) =>
                p.id === planId
                  ? { ...p, answers: { ...sentAnswers }, updated_at: res.updated_at ?? p.updated_at }
                  : p,
              ),
            }
          : prev,
      );
      const stillDirty = versionRef.current !== sentVersion;
      if (res.updated_at) setLastSavedAt(res.updated_at);
      setDirty(stillDirty);
      dirtyRef.current = stillDirty;
      setStatus(stillDirty ? 'idle' : 'saved');
    } catch {
      setStatus('error');
      // dirty хэвээр — retry (commit/save/beforeunload) нээлттэй үлдэнэ.
    } finally {
      inFlight.current = false;
      if (versionRef.current !== sentVersion) void performSave();
    }
  }, [planId, queryClient]);

  const setField = useCallback(
    (key: string, value: string) => {
      const next = { ...answersRef.current, [key]: value };
      answersRef.current = next;
      versionRef.current += 1;
      dirtyRef.current = true;
      setLocal(next);
      setDirty(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void performSave(), 2500);
    },
    [performSave],
  );

  // blur / "Хадгалах" товч дээр шууд flush.
  const commit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!dirtyRef.current && status !== 'error') return;
    void performSave();
  }, [performSave, status]);

  // Unmount + before-unload үед хагас бичсэн маягтыг алдахгүйгээр flush.
  useEffect(() => {
    const beforeUnload = () => {
      if (dirtyRef.current) void performSave();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      if (timer.current) clearTimeout(timer.current);
      if (dirtyRef.current) void performSave();
    };
  }, [performSave]);

  return { answers, setField, status, dirty, lastSavedAt, commit, save: performSave };
}
