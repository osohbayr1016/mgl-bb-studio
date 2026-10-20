import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { SaveStatus } from '@/shared/components/SaveBar';
import { assessmentKeys, updateTemplate } from '../api';
import { draftToSchema } from '../lib/schemaDraft';
import type { SchemaDraft } from '../lib/schemaDraft';

/**
 * Асуулгын загварыг (template) autosave хийх hook.
 *
 * `useAssessmentAutosave`-ийн ЯГ ижил хэв маяг: 2.5с debounce, blur /
 * beforeunload / unmount дээр шууд flush, хадгалалт нисэж байх үед хамгийн
 * сүүлийн ноорогийг дараалалд оруулж (last-write-wins) дараа нь дахин илгээнэ.
 *
 * Ялгаа: код / монгол нэр ХООСОН бол сервер 400 буцаах тул хүсэлт огт
 * илгээхгүй — оронд нь `blocked` тугийг өргөнө.  Ингэснээр админ гарчгаа
 * түр цэвэрлэхэд хадгалалт чимээгүй уначихгүй, дэлгэц дээр шалтгаан харагдана.
 */
export function useTemplateAutosave(templateId: number, initial: SchemaDraft, savedAt: string) {
  const queryClient = useQueryClient();
  const [draft, setLocal] = useState<SchemaDraft>(initial);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [dirty, setDirty] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(savedAt || null);

  const draftRef = useRef<SchemaDraft>(initial);
  const dirtyRef = useRef(false);
  const inFlight = useRef(false);
  const versionRef = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performSave = useCallback(async () => {
    if (inFlight.current) return;
    const current = draftRef.current;
    if (!current.code.trim() || !current.titleMn.trim()) {
      setBlocked(true);
      setStatus('error');
      return;
    }
    setBlocked(false);
    inFlight.current = true;
    setStatus('saving');
    const sentVersion = versionRef.current;
    try {
      // Сэрэмжлүүлгүүд (жингийн нийлбэр 100 биш г.м) autosave-ийг ХОРИГЛОХГҮЙ —
      // репогийн конвенцоор тэдгээр нь зөөлөн, хагас зохиосон асуулга ч
      // хадгалагдана (docs/dev/assessments-spec.md §1).
      const { schema } = draftToSchema(current);
      const res = await updateTemplate(templateId, {
        code: current.code.trim(),
        title_mn: current.titleMn.trim(),
        title_en: current.titleEn.trim() || null,
        description: current.description.trim() || null,
        team_codes: current.teamCodes,
        senior_user_ids: current.seniorUserIds,
        schema,
      });
      queryClient.setQueryData(assessmentKeys.template(templateId), res);
      void queryClient.invalidateQueries({
        queryKey: assessmentKeys.templates,
        refetchType: 'none',
      });

      const stillDirty = versionRef.current !== sentVersion;
      setLastSavedAt(res.template.updated_at);
      setDirty(stillDirty);
      dirtyRef.current = stillDirty;
      setStatus(stillDirty ? 'idle' : 'saved');
    } catch {
      setStatus('error');
      // dirty хэвээр — retry (SaveBar товч / beforeunload) нээлттэй.
    } finally {
      inFlight.current = false;
      if (versionRef.current !== sentVersion) void performSave();
    }
  }, [templateId, queryClient]);

  /** Ноорогийг бүхэлд нь солино (schemaDraft-ийн туслахууд шинэ объект буцаадаг). */
  const setDraft = useCallback(
    (next: SchemaDraft) => {
      draftRef.current = next;
      versionRef.current += 1;
      dirtyRef.current = true;
      setLocal(next);
      setDirty(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void performSave(), 2500);
    },
    [performSave],
  );

  /** blur / хуудас солих / «Хадгалах» товч дээр шууд flush. */
  const commit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!dirtyRef.current && status !== 'error') return;
    void performSave();
  }, [performSave, status]);

  /** Хүлээгдэж буй БҮХ бичилтийг дуустал хүлээнэ (нийтлэхийн өмнө заавал). */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
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

  return { draft, setDraft, status, dirty, blocked, lastSavedAt, commit, flush, save: performSave };
}

export default useTemplateAutosave;
