/* ==========================================================================
   useCopyStructure — «Бүтэц татах» хуудасны ӨГӨГДЛИЙН давхарга
   ==========================================================================

   Хоёрхон дуудлага:
     1. `dry_run: true`  → урьдчилсан төлөвлөгөө (тоо ширхэг + ДЭЭД ХЯЗГААР).
     2. `dry_run` үгүй   → бодит хуулбар.

   ⚠️ ЖИНГИЙН ТООЦООЛОЛ ЭНД БАЙХГҮЙ.  Дээд хязгаар болон хуулагдах мөрийн
   тоог ЗӨВХӨН сервер бодно (`backend/src/lib/structureCopyPlan.ts`).
   Фронтенд дээр давхардуулбал энэ кодбааз дахь нэгтгэлийн томьёоны 12 дахь
   хуулбар болно — CLAUDE.md-ийн шууд хориглосон зүйл.

   Хоёр цагийн хязгаарыг ЗОРИУДААР гараар өгсөн: `apiFetch`-ийн өгөгдмөл нь
   12 секунд бөгөөд POST-ыг ХЭЗЭЭ Ч давтдаггүй.  Бодит хуулбар нь ~2400 мөр
   хүртэл INSERT хийж болох тул 12 секунд хүрэлцэхгүй, харин timeout болсон
   POST-ыг давтвал бүтэц ХОЁР УДАА үүсэх байсан.

   ⚠️ Дуудагч нь `selection`-ыг ЗААВАЛ `useMemo`-оор тогтворжуулна.  Рендер
   бүрд шинэ объект дамжуулбал доорх debounce-ын effect тасралтгүй дахин
   эхэлж, урьдчилсан харалт хэзээ ч ирэхгүй. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { ApiError, apiFetch } from '@/shared/api/client';

import type {
  CopyCommitResult,
  CopyPlan,
  CopyPreviewResponse,
  CopySelectionInput,
  CopySelectionWire,
} from './types';

/** Сонголт өөрчлөгдөөд амарсны дараа л урьдчилан харна. */
const PREVIEW_DEBOUNCE_MS = 250;
/** Урьдчилсан тооцоо нь бичихгүй тул богино хязгаар хангалттай. */
const PREVIEW_TIMEOUT_MS = 30_000;
/** Бодит хуулбар: ~2400 мөрийн багц INSERT. */
const COMMIT_TIMEOUT_MS = 60_000;

/** `null` талбаруудыг хүсэлтийн биеэс БҮРМӨСӨН хасна — сервер тал «түлхүүр
 *  байхгүй» ба `null` хоёрыг адилхан «бүгд» гэж уншдаг ч, ачааллыг жижиг
 *  байлгах нь 1051 ажилтай төсөл дээр мэдэгдэхүйц. */
function toWireSelection(selection: CopySelectionInput): CopySelectionWire {
  const wire: CopySelectionWire = {};
  if (selection.team_ids) wire.team_ids = selection.team_ids;
  if (selection.block_ids) wire.block_ids = selection.block_ids;
  if (selection.drawing_ids) wire.drawing_ids = selection.drawing_ids;
  if (selection.component_ids) wire.component_ids = selection.component_ids;
  if (selection.task_ids) wire.task_ids = selection.task_ids;
  return wire;
}

/** Кэшийн түлхүүр + debounce-ийн харьцуулалтад ашиглах тогтвортой мөр. */
function selectionKey(selection: CopySelectionInput): string {
  return JSON.stringify([
    selection.team_ids,
    selection.block_ids,
    selection.drawing_ids,
    selection.component_ids,
    selection.task_ids,
  ]);
}

export interface UseCopyStructureArgs {
  targetProjectId: number;
  sourceProjectId: number | null;
  selection: CopySelectionInput;
  enabled: boolean;
}

export interface UseCopyStructureResult {
  preview: CopyPlan | null;
  previewLoading: boolean;
  /** `true` бол дэлгэц дээрх төлөвлөгөө нь ОДООГИЙН сонголтынх БИШ:
   *  debounce хүлээж байна, хүсэлт нисэж байна, эсвэл `placeholderData`
   *  өмнөх түлхүүрийн хариуг байрандаа барьж байна.  Ийм үед ДЭЭД ХЯЗГААР
   *  худал тоо болох тул «Хуулах» товч ХОРИГЛОГДОНО (эзний шийдвэр #1-ийн
   *  «таазыг үргэлж харуулна» нөхцөл). */
  previewStale: boolean;
  previewError: Error | null;
  commit: (opts: { link: boolean; confirmReplace: boolean }) => Promise<CopyCommitResult>;
  committing: boolean;
}

interface CommitVars {
  link: boolean;
  confirmReplace: boolean;
  /** ⚠️ DEBOUNCE ХИЙГДСЭН сонголт — хамгийн сүүлийнх БИШ.  Админы харсан
   *  ДЭЭД ХЯЗГААР нь яг энэ сонголтоос бодогдсон тул бичигдэх сонголт нь
   *  мөн энэ байх ЁСТОЙ.  Амьд (live) сонголтыг илгээвэл дэлгэц дээрх тоо
   *  ба бичигдэх бүтэц хоёр зөрнө. */
  selection: CopySelectionInput;
}

export function useCopyStructure({
  targetProjectId,
  sourceProjectId,
  selection,
  enabled,
}: UseCopyStructureArgs): UseCopyStructureResult {
  const key = useMemo(() => selectionKey(selection), [selection]);

  /* Debounce хийгдсэн хувилбар — зөвхөн урьдчилсан харалтад. */
  const [debounced, setDebounced] = useState<{ key: string; value: CopySelectionInput }>(() => ({
    key,
    value: selection,
  }));

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced({ key: selectionKey(selection), value: selection });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [selection]);

  const canPreview = enabled && sourceProjectId != null && targetProjectId > 0;

  const previewQuery = useQuery<CopyPreviewResponse, ApiError>({
    queryKey: ['/projects', targetProjectId, 'copy-structure', sourceProjectId, debounced.key],
    queryFn: () =>
      apiFetch<CopyPreviewResponse>(`/projects/${targetProjectId}/copy-structure`, {
        method: 'POST',
        data: {
          source_project_id: sourceProjectId,
          selection: toWireSelection(debounced.value),
          dry_run: true,
        },
        timeoutMs: PREVIEW_TIMEOUT_MS,
      }),
    enabled: canPreview,
    // Сонголт солигдох бүрд тоонууд «хоосон → дүүрэн» гэж анивчих нь
    // ДЭЭД ХЯЗГААРЫГ уншихад саад болно.  Өмнөх төлөвлөгөөг байрандаа
    // үлдээж, зөвхөн бүдгэрүүлж (previewLoading) харуулна.
    placeholderData: (prev) => prev,
    // Сервер 400 NO_SELECTION гэх мэт ЗӨВ хариу буцаадаг тул давтах нь
    // утгагүй — алдааг шууд UI дээр буулгана.
    retry: false,
    staleTime: 30_000,
  });

  const commitMutation = useMutation<CopyCommitResult, ApiError, CommitVars>({
    mutationFn: async (vars) => {
      if (sourceProjectId == null) {
        throw new ApiError(400, 'BAD_REQUEST', { code: 'BAD_REQUEST' });
      }
      return apiFetch<CopyCommitResult>(`/projects/${targetProjectId}/copy-structure`, {
        method: 'POST',
        data: {
          source_project_id: sourceProjectId,
          selection: toWireSelection(vars.selection),
          link: vars.link,
          confirm_replace: vars.confirmReplace,
        },
        timeoutMs: COMMIT_TIMEOUT_MS,
      });
    },
  });

  const { mutateAsync } = commitMutation;
  const debouncedSelection = debounced.value;
  /* ⚠️ `selection` БИШ `debounced.value`.  Дэлгэц дээрх төлөвлөгөө (тоо
   * ширхэг + ДЭЭД ХЯЗГААР) нь debounce хийгдсэн сонголтоос бодогдсон тул
   * бодит хуулбар нь ЯГ ТҮҮНИЙГ бичих ёстой.  (Дуудагч нь `previewStale`
   * үед товчийг хориглодог тул хоёулаа ижил байх ёстой ч, гар аргаар
   * (Enter, автомат тест) дуудагдвал ч зөрөх боломжгүй байлгав.) */
  const commit = useCallback(
    (opts: { link: boolean; confirmReplace: boolean }) =>
      mutateAsync({ ...opts, selection: debouncedSelection }),
    [mutateAsync, debouncedSelection],
  );

  /* «Хуучирсан» гурван эх сурвалж.  `isPlaceholderData` нь заавал ХЭРЭГТЭЙ:
   * `placeholderData: (prev) => prev` нь ШИНЭ түлхүүрийн хүсэлт нисэж байх
   * зуур ӨМНӨХ төлөвлөгөөг байрандаа үлдээдэг тул `data` нь `null` биш
   * атлаа одоогийн сонголтынх БИШ байна. */
  const previewStale =
    canPreview &&
    (previewQuery.isFetching || previewQuery.isPlaceholderData || debounced.key !== key);

  return {
    preview: previewQuery.data?.plan ?? null,
    // debounce хүлээж буй үе ч «ачаалж байна» — эс тэгвээс тоонууд 250 мс
    // хуучин утгаараа хөдөлгөөнгүй зогсоод, дарсан эсэх нь эргэлзээтэй.
    previewLoading: canPreview && (previewQuery.isFetching || debounced.key !== key),
    previewStale,
    previewError: previewQuery.error ?? null,
    commit,
    committing: commitMutation.isPending,
  };
}

export default useCopyStructure;
