/**
 * Ямар ч ноорогт ажиллах client-side autosave (ерөнхий).
 *
 *   const { data, setData, status, dirty, lastSavedAt, commit, save } =
 *     useAutosave<SheetDoc>({ initial: quote.sheet, save: (d) => apiFetch(...) });
 *
 * Зан төлөв:
 *  - `setData(next | (prev) => next)` локал төлөвийг шинэчилж dirty болгоно.
 *  - Идэвхгүй байдал `debounceMs` (2.5с) үргэлжилмэгц saver ажиллана.
 *  - `commit()` шууд flush хийнэ — input blur, submit, `beforeunload` дээр дуудна.
 *  - Хадгалалт явж байх үед saver дахин ажиллахгүй; хамгийн сүүлийн ачааллыг
 *    дараалалд оруулаад дуусмагц дахин гүйнэ (last-write-wins).
 *  - Алдаа гарвал `status='error'`, dirty хэвээр үлдэнэ — «Хадгалах» товч,
 *    blur, beforeunload бүгд retry-ийн зам нээлттэй.
 *
 * ШИНЭЛЭГ БАЙДАЛ: debounce/дараалсан saver нь `dataRef`-ээс (үргэлж хамгийн
 * сүүлийн утга) уншина, closure-оос БИШ. Хуучин алдаа: debounce таймер сүүлийн
 * товчлуур дарахаас ӨМНӨХ рендэрийн `data`-г барьж авдаг байсан тул сүүлийн
 * засвар алга болж, `dirty` худал false болоод commit/«Хадгалах»/beforeunload/
 * submit бүгд түгжигддэг байв. Монотоноор өсөх version тоолуур нь «нислэгийн
 * үед өөрчлөлт орсон уу?» гэдгийг объектын identity-гүйгээр шийднэ.
 *
 * Гарал үүсэл: features/quotes/components/useQuoteAutosave.ts (Quote/QuoteData-
 * аас салгаж generic `<T>` болгов).
 *
 * ⚠️ `initial` нь ЗӨВХӨН эхний рендэрт уншигдана. Өөр баримт руу шилжихдээ
 * компонентоо `key={id}`-ээр remount хийж бүх төлөвийг цэвэрлэнэ.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SaveStatus } from '@/shared/components/SaveBar';

export type { SaveStatus };

/** Нэг удаагийн хадгалалтын үр дүн (`flush()`-ийн дотоод дохио). */
type SaveOutcome = 'saved' | 'dirty' | 'error' | 'busy' | 'disabled';

export interface UseAutosaveOptions<T> {
  /** Эхний утга (зөвхөн mount дээр уншина). */
  initial: T;
  /**
   * Хадгалагч. Буцаах утга нь чөлөөтэй; хэрэв объект дотор `updated_at` /
   * `last_saved_at` (string) байвал `lastSavedAt` түүнээс уншина, эс бөгөөс
   * клиентийн одоогийн цагийг тавина.
   */
  save: (data: T) => Promise<unknown>;
  debounceMs?: number;
  /** false үед autosave түр зогсоно (жишээ нь status != 'draft'). */
  enabled?: boolean;
  /** Сервер дээр сүүлд хадгалагдсан хугацаа (SaveBar-ын «12с өмнө»). */
  initialSavedAt?: string | null;
}

/** Хадгалагчийн хариунаас цагийн тэмдэгтийг сугалж авах (байвал). */
function readSavedAt(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const rec = result as Record<string, unknown>;
  const v = rec.updated_at ?? rec.last_saved_at ?? rec.updatedAt;
  return typeof v === 'string' ? v : null;
}

export function useAutosave<T>({
  initial,
  save,
  debounceMs = 2500,
  enabled = true,
  initialSavedAt = null,
}: UseAutosaveOptions<T>) {
  const [data, setLocalData] = useState<T>(initial);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(initialSavedAt);
  const [error, setError] = useState<string | null>(null);

  // Рендэр бүрт debounce-ыг дахин үүсгэхгүйн тулд ref-үүд.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  // Үргэлж хамгийн шинэ ачаалал — saver эндээс snapshot авна, (хуучирсан байж
  // болох) closure хувьсагчаас ХЭЗЭЭ Ч биш.
  const dataRef = useRef<T>(initial);
  const dirtyRef = useRef(false);
  // Засвар бүрт өснө; saver ямар version илгээснээ тэмдэглээд, нислэгийн үед
  // шинэ засвар орсон эсэхийг (объект identity-гүйгээр) мэдэж авна.
  const versionRef = useRef(0);
  // `save`/`enabled`/`status`-ийн хамгийн сүүлийн утга — доорх callback-уудыг
  // дахин үүсгэхгүйгээр.
  const saveRef = useRef(save);
  saveRef.current = save;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const statusRef = useRef<SaveStatus>(status);
  statusRef.current = status;

  /**
   * `performSave`-ийн үр дүн — `flush()` үүгээр «бүрэн буусан уу?» гэдгийг
   * мэднэ. Гаднаас (`save()`) дуудахад үл хэрэгсэж болно.
   */
  const performSave = useCallback(async (): Promise<SaveOutcome> => {
    if (!enabledRef.current) return 'disabled';
    if (inFlight.current) return 'busy'; // хадгалалт явж байна; дуусмагц дахин шалгана
    inFlight.current = true;
    setStatus('saving');
    setError(null);
    const sentVersion = versionRef.current;
    const payload = dataRef.current;
    try {
      const result = await saveRef.current(payload);
      // Хадгалж байх зуур хэрэглэгч бичсэн бол dirty хэвээр үлдээж, finally
      // блокт дараагийн давталтыг эхлүүлнэ.
      const stillDirty = versionRef.current !== sentVersion;
      setLastSavedAt(readSavedAt(result) ?? new Date().toISOString());
      setDirty(stillDirty);
      dirtyRef.current = stillDirty;
      setStatus(stillDirty ? 'idle' : 'saved');
      return stillDirty ? 'dirty' : 'saved';
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Save failed');
      // dirty хэвээр — retry (commit/save/beforeunload) бүгд нээлттэй үлдэнэ
      return 'error';
    } finally {
      inFlight.current = false;
      if (versionRef.current !== sentVersion && enabledRef.current) {
        // дараалалд орсныг гүйцээх
        void performSave();
      }
    }
  }, []);

  const setData = useCallback(
    (updater: T | ((prev: T) => T)) => {
      const next =
        typeof updater === 'function' ? (updater as (prev: T) => T)(dataRef.current) : updater;
      dataRef.current = next;
      versionRef.current += 1;
      dirtyRef.current = true;
      setLocalData(next);
      setDirty(true);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        void performSave();
      }, debounceMs);
    },
    [debounceMs, performSave],
  );

  // blur / submit / unload дээр flush.
  const commit = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (!dirtyRef.current && statusRef.current !== 'error') return;
    void performSave();
  }, [performSave]);

  /**
   * ХҮЛЭЭДЭГ flush. `commit()` нь зөвхөн хадгалалтыг ЭХЛҮҮЛДЭГ тул серверийн
   * үйлдэл (PDF, орчуулга) түүний араас шууд дуудагдвал ХУУЧИН дэвтэр дээр
   * ажиллах эрсдэлтэй. Энэ нь ноорог сервер дээр бүрэн буутал хүлээнэ:
   * нислэгийн үеийн дуудлага шууд буцдаг тул «цэвэр» болтол давтана
   * (`dirty` ба `inFlight` хоёул тайван болох хүртэл).
   *
   * `false` = хадгалалт унасан (дуудагч үйлдлээ ЦУЦЛАХ ёстой — эс тэгвээс
   * хэрэглэгчийн сүүлийн засвар ороогүй баримт үүснэ).
   */
  const flush = useCallback(async (): Promise<boolean> => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    // ⚠️ Хязгаар нь ХУГАЦААГААР — давталтын тоогоор БИШ. Тоогоор хязгаарлавал
    // хоёр төрлийн давталт (өөрөө хадгалах vs явж буй хадгалалтыг хүлээх) огт
    // өөр цаг иддэг тул хүлээх салаа нь нууц 3 секундын timeout болж, УДААН ч
    // АМЖИЛТТАЙ хадгалалт «хадгалагдсангүй» гэж худал мэдэгдэнэ. Толгойн талбар
    // blur дээр commit хийдэг тул товч дарахад яг энэ салаа ажилладаг.
    const deadline = Date.now() + 60_000;
    let attempts = 0;
    while (Date.now() < deadline && attempts < 10) {
      if (!enabledRef.current) return true;
      if (!dirtyRef.current && !inFlight.current) return true;
      if (inFlight.current) {
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      attempts += 1;
      const outcome = await performSave();
      if (outcome === 'error') return false;
    }
    return false;
  }, [performSave]);

  // Unmount + before-unload үед үргэлж flush — таб хаахад хагас бичсэн ноорог
  // алдагдахгүй.
  useEffect(() => {
    const beforeUnload = () => {
      if (dirtyRef.current) void performSave();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (dirtyRef.current) void performSave();
    };
  }, [performSave]);

  return {
    data,
    setData,
    status,
    dirty,
    error,
    lastSavedAt,
    commit,
    /** Яг одоо хадгал (ил «Хадгалах» товчинд). */
    save: performSave,
    /** Хадгалалт бүрэн буутал ХҮЛЭЭНЭ (сервер талын үйлдлийн өмнө). */
    flush,
  };
}
