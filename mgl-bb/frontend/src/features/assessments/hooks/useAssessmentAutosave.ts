import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { SaveStatus } from '@/shared/components/SaveBar';
import { assessmentKeys, saveResponse } from '../api';
import type { AssessmentAnswers, AssessmentResponseDetail } from '../types';

/**
 * Нэг үнэлгээний маягтын хариултыг autosave хийх hook.
 *
 * `features/pgp/usePgpAutosave.ts`-ийн хэв маягийг ЯГ дагасан: 2.5с debounce,
 * blur / beforeunload / unmount дээр шууд flush, хадгалалт нисэж байх үед
 * хамгийн сүүлийн payload-ыг дараалалд оруулж (last-write-wins) дараа нь дахин
 * илгээнэ. Төлөв нь `@/shared/components/SaveBar`-т шууд дамжина.
 *
 * ЧУХАЛ: `responseId` mount дотор тогтмол гэж үзнэ — өөр маягт руу шилжихэд
 * дуудагч тал `key={response.id}`-ээр компонентоо remount хийж бүх state-ийг
 * цэвэрлэнэ.
 *
 * `enabled` нь `status === 'draft' && round_status === 'open'` — илгээгдсэн
 * эсвэл хаагдсан маягт дээр ямар ч бичилт явахгүй (сервер ч 4xx буцаана,
 * гэхдээ энд түгжсэнээр дэмий хүсэлт, буруу «Хадгалж байна…» гарахгүй).
 */
export function useAssessmentAutosave(
  responseId: number,
  initial: AssessmentAnswers,
  initialSavedAt: string | null,
  enabled: boolean,
) {
  const queryClient = useQueryClient();
  const [answers, setLocal] = useState<AssessmentAnswers>(initial);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(initialSavedAt);

  const answersRef = useRef<AssessmentAnswers>(initial);
  const dirtyRef = useRef(false);
  const inFlight = useRef(false);
  const versionRef = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `enabled`-ийг ref-ээр барина — beforeunload/unmount дээр хамгийн сүүлийн
  // утгыг унших хэрэгтэй (closure-т хөлдөөж болохгүй).
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const performSave = useCallback(async () => {
    if (!enabledRef.current) return;
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus('saving');
    const sentVersion = versionRef.current;
    const sentAnswers = answersRef.current;
    try {
      const res = await saveResponse(responseId, sentAnswers);
      // Маягтын кэшийг шууд шинэчилнэ — эс бөгөөс буцаж ороход staleTime
      // дуустал хуучин хариултууд дүүргэгдэнэ.
      queryClient.setQueryData<{ response: AssessmentResponseDetail }>(
        assessmentKeys.response(responseId),
        (prev) => (prev ? { ...prev, response: { ...prev.response, answers: { ...sentAnswers } } } : prev),
      );
      // Профайлын «Бөглөх шаардлагатай» / «Миний үнэлэх хүмүүс» жагсаалтын явц
      // (answered_count) хоцрохгүйн тулд stale болгоно. `refetchType: 'none'` —
      // одоо ямар ч жагсаалт дэлгэц дээр байхгүй тул дэмий сүлжээ хэрэггүй.
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.my, refetchType: 'none' });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.myReviews, refetchType: 'none' });

      const stillDirty = versionRef.current !== sentVersion;
      if (res.updated_at) setLastSavedAt(res.updated_at);
      setDirty(stillDirty);
      dirtyRef.current = stillDirty;
      setStatus(stillDirty ? 'idle' : 'saved');
    } catch {
      setStatus('error');
      // dirty хэвээр — retry (commit / SaveBar товч / beforeunload) нээлттэй.
    } finally {
      inFlight.current = false;
      if (versionRef.current !== sentVersion) void performSave();
    }
  }, [responseId, queryClient]);

  /** Нэг мөрийн оноог тавина (1..5). Debounce тоолуурыг дахин эхлүүлнэ. */
  const setAnswer = useCallback(
    (itemId: string, value: number) => {
      if (!enabledRef.current) return;
      const next = { ...answersRef.current, [itemId]: value };
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

  // blur / хуудас солих / «Хадгалах» товч дээр шууд flush (хүлээхгүй).
  const commit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!dirtyRef.current && status !== 'error') return;
    void performSave();
  }, [performSave, status]);

  /**
   * Хүлээгдэж буй БҮХ бичилтийг дуустал хүлээнэ. Илгээхийн (submit) өмнө
   * заавал дуудна: эс бөгөөс сүүлийн хариулт debounce-д сууж байхад submit
   * түрүүлж очоод маягт түгжигдэн, тэр хариулт БҮРМӨСӨН алдагдана.
   *
   * `performSave` нь нисэж буй хүсэлт байвал шууд буцдаг тул давталтаар
   * хүлээнэ. `false` буцаавал (сүлжээ тасарсан) дуудагч тал submit-ыг зогсооно.
   */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    if (!enabledRef.current) return true;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (!dirtyRef.current) return true;
      if (inFlight.current) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      await performSave();
    }
    return !dirtyRef.current;
  }, [performSave]);

  // Unmount + before-unload үед хагас бөглөсөн маягтыг алдахгүйгээр flush.
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

  return { answers, setAnswer, status, dirty, lastSavedAt, commit, flush, save: performSave };
}

export default useAssessmentAutosave;
