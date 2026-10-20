import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Loader2, RefreshCw, TriangleAlert, X } from 'lucide-react';

import { ApiError, apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import type { Team } from '@/shared/types';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Skeleton } from '@/ui/skeleton';

import {
  ALL_TEAMS,
  curationActionFor,
  curationSourceType,
  normalizeTeamCode,
  parseBulkOutcomes,
  pickCount,
  reconcileByCount,
  reconcileByPresence,
} from '../curation';
import {
  isAssistantIntent,
  type AssistantIntent,
  type AssistantLogRow,
  type BulkResult,
  type BulkResultRow,
  type ExamplePayload,
  type ExamplesResponse,
  type PendingResponse,
  type ReviewResponse,
} from '../types';
import { LogCard } from './LogCard';
import { BulkResultPanel } from './BulkResultPanel';
import { CorrectDialog, RejectDialog } from './ReviewDialogs';

/** Сервер тал `limit`-ийг 200-аар таслана. */
const PENDING_LIMIT = 200;
/** `MAX_EXAMPLE_BATCH = 500` — түүнээс ДООГУУР байлгана. */
const MAX_BULK = 200;

const PENDING_KEY = ['/revit/assistant/pending', 'queue'] as const;

/** Серверийн НИЙТ тооны БОЛОМЖИТ талбарын нэрс (`curation.ts` → `pickCount`). */
const PROMOTE_COUNT_KEYS = ['added', 'promoted', 'inserted', 'created', 'count'] as const;
const REJECT_COUNT_KEYS = ['rejected', 'closed_logs', 'changed', 'count'] as const;

/**
 * БАГЦ ГАРЦ — мөр тус бүрийн үр дүнг буцаадаг ЦОРЫН ГАНЦ роут.
 *
 * ⚠️ ЭНЭ НЬ ПРОДАКШНД БАЙХГҮЙ БАЙЖ БОЛНО.  Frontend (Pages) ба worker нь
 * ТУСДАА deploy хийгддэг тул хуудас нь шинэ, worker нь хуучин байх цонх
 * ҮРГЭЛЖ байдаг.  Тэр цонхонд багц үйлдэл 404 өгч БҮТЭН УНАВАЛ хянагч
 * ажиллаж чадахгүй — тиймээс НЭГ УДАА 404 барьж, ХУУЧИН хос гарц руу
 * (`/assistant/examples` + `/assistant/review`) буцна.  Хуучин гарц нь
 * мөр тус бүрийн хариу өгдөггүй тул тайлан нь `reconcileBy*`-ээр
 * ТААМАГЛАСАН төлөв харуулна — ажиллагаа зогсохгүй.
 */
const BULK_ROUTE = '/revit/assistant/bulk-review';

interface PendingTabProps {
  currentUserId: number | null;
  /**
   * URL-д амьдардаг багийн шүүлт (`?team=BA`).  `null` = бүх баг.
   * ⚠️ Төлөв нь ЭНД БИШ, `AssistantCurationPage`-д — `?tab=`-тай ИЖИЛ
   * URL-д байх ёстой (хянагч шүүсэн дараалалаа холбоосоор хуваалцана).
   */
  team: string | null;
  onTeamChange: (next: string | null) => void;
}

/**
 * ХҮЛЭЭГДЭЖ БУЙ дараалал — хүний баталгаажуулах хаалга.
 *
 * ⚠️ Мөрүүдийг клиент талд ДАХИН ЭРЭМБЭЛЭХГҮЙ.  Серверийн `ORDER BY CASE`
 * нь бүтээгдэхүүний шийдвэр: чөлөөт тэмдэглэл → залруулга → 👎 → fallback →
 * бусад.  Энд `sort` дуудвал хамгийн үнэ цэнтэй материал доош булагдана.
 *
 * ⚠️ СОНГОЛТ ТАБ СОЛИХОД ҮЛДЭНЭ, ЗОРИУД.  `AssistantCurationPage` нь
 * `KeepAliveTabs`-ыг ашигладаг тул энэ панель нэг удаа mount хийгдээд
 * ХЭЗЭЭ Ч унтрахгүй — өөрөөр хэлбэл `selected` нь «Хянасан» / «Сургалтын
 * багц» таб руу зочилж буцахад БҮТНЭЭР үлдэнэ.  Энэ нь бодит ажлын
 * урсгалыг дагасан: хянагч 40 мөр сонгосон дундаа «энэ өгүүлбэрийг өмнө нь
 * хассан уу» гэж Хянасан таб руу орж хардаг, тэр үед 40 мөрийн сонголт
 * алдагдах нь дайсагнасан зан төлөв болно.  СОНГОЛТ АРИЛАХ ГУРВАН гарц нь
 * ИЛ бөгөөд ЗОРИУД:
 *   1. «Сонголт цуцлах» товч (хянагчийн ил үйлдэл),
 *   2. багц үйлдэл АМЖИЛТТАЙ дууссаны дараа,
 *   3. одоогийн жагсаалтад БАЙХГҮЙ болсон мөрүүд автоматаар хасагдана
 *      (баг сольсон, эсвэл өөр хянагч шийдвэрлэсэн) — үл үзэгдэх мөрд
 *      багц үйлдэл хийх нь ХАМГИЙН аюултай алдаа.
 */
export function PendingTab({ currentUserId, team, onTeamChange }: PendingTabProps) {
  const { t, lang } = useLanguage();
  const queryClient = useQueryClient();

  // ⚠️ Багийн жагсаалтыг ХАТУУ БИЧИХГҮЙ.  `GET /api/teams` нь ямар ч
  //    authenticated дүрд нээлттэй (`routes/teams.ts` — middleware БАЙХГҮЙ),
  //    тиймээс амьд бүртгэлээс уншина.  «Найман салбарын баг» гэсэн тоо
  //    ЭНД ХЭЗЭЭ Ч бичигдэхгүй: `teams` нь түүнээс ОЛОН мөртэй ба
  //    MGMT / EZ / GT-ийн хэрэглэгчид ч бүртгэл үүсгэдэг тул тэдний мөр
  //    курацийн дараалалд БАЙНА — жагсаалтаас хасвал тэр материал хаана ч
  //    харагдахгүй ХОГ болно.  Шүүлт бол ХАРАХ хэрэгсэл; сургалтын хаалга
  //    нь `team_rule_scope` / `model_capabilities` дээр, ЭНД БИШ.
  // ⚠️ `retry: false` — багийн жагсаалт унасан нь курацийг ЗОГСООХ шалтгаан
  //    биш; «бүх баг» сонголт үргэлж ажиллана.
  const teamsQuery = useApiQuery<{ teams: Team[] }>(['/teams'], '/teams', { retry: false });

  const teamOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ code: string; label: string }> = [];
    for (const row of teamsQuery.data?.teams ?? []) {
      const code = normalizeTeamCode(row.code);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      const name = (lang === 'en' ? row.name_en : null) ?? row.name_mn;
      out.push({ code, label: name ? `${code} · ${name}` : code });
    }
    // ⚠️ URL-ээс ирсэн код бүртгэлээс олдоогүй ч (жагсаалт ачаалагдаагүй,
    //    эсвэл баг архивлагдсан) сонголт нь ХАРАГДАХ ёстой — эс бөгөөс
    //    `Select` хоосон харагдаж, шүүлт идэвхтэй хэвээр байгааг хянагч
    //    МЭДЭХГҮЙ.
    if (team && !seen.has(team)) out.push({ code: team, label: team });
    return out;
  }, [teamsQuery.data, team, lang]);

  // ⚠️ Багийн шүүлт нь ЗӨВХӨН `WHERE`-т нэмэгддэг; серверийн
  //    `ORDER BY CASE` (`revit.ts:2158-2170`) ХӨНДӨГДӨХГҮЙ.
  // ⚠️ Түлхүүрт `team` ОРНО, эс бөгөөс BA-гийн дараалал кэшлэгдээд
  //    IZ сонгоход ТЭР ЛЭ жагсаалт эргэж ирнэ.  `invalidate()` нь
  //    `PENDING_KEY`-ээр ЗӨВХӨН УГТВАР тааруулдаг тул бүх багийн хувилбар
  //    нэг дор хүчингүй болно — тэр нь ЗӨВ: нэг мөр дэвшихэд «бүх баг»
  //    жагсаалт ч хуучирна.
  const query = useApiQuery<PendingResponse>(
    [...PENDING_KEY, team],
    `/revit/assistant/pending?limit=${PENDING_LIMIT}${
      team ? `&team=${encodeURIComponent(team)}` : ''
    }`,
  );
  const rows = useMemo(() => query.data?.pending ?? [], [query.data]);

  /**
   * ⚠️ ХУДАЛ БАТАЛГААНААС СЭРГИЙЛЭХ.  Сервер танихгүй query параметрийг
   * ЧИМЭЭГҮЙ үл ойшоодог тул `team_code` багана хараахан нийлүүлэгдээгүй
   * worker дээр `&team=BA` нь 200 буцаана — гэвч жагсаалт ШҮҮГДЭХГҮЙ.
   * Тэр үед `Select` дээр «BA» гэж бичээстэй байхад бүх багийн мөр
   * харагдана: хянагч IZ-ийн өгүүлбэрийг BA-гийнх гэж бодоод дэвшүүлнэ.
   * Мөр буцаж ирсэн атлаа НЭГ Ч мөрөнд `team_code` талбар байхгүй бол
   * тэр нь ЯГ энэ тохиолдол — ил анхааруулна.
   * (Мөр огт байхгүй үед ЮУ Ч дүгнэхгүй — хоосон дараалал нь хуучин
   * worker-ийн нотолгоо БИШ.)
   */
  const teamFilterInactive = useMemo(
    () => team != null && rows.length > 0 && rows.every((r) => r.team_code === undefined),
    [team, rows],
  );

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  /** Татгалзах гэж буй мөрүүд (null = цонх хаалттай). */
  const [rejectIds, setRejectIds] = useState<number[] | null>(null);
  /** Засаад дэвшүүлэх гэж буй мөр. */
  const [correcting, setCorrecting] = useState<AssistantLogRow | null>(null);
  /** Сүүлийн багц үйлдлийн МӨР ТУС БҮРИЙН тайлан (null = тайлан алга). */
  const [result, setResult] = useState<BulkResult | null>(null);
  /** Shift-ээр мужаар сонгоход хэрэглэх «анхаарлын» мөр. */
  const anchorRef = useRef<number | null>(null);
  /** Багц гарц 404 өгсөн үү (нэг удаа тогтоод хуучин гарц руу барина). */
  const bulkRouteMissing = useRef(false);

  /**
   * Багц гарцаар оролдоод, тэр байхгүй бол ХУУЧИН гарцаар явна.
   *
   * ⚠️ ЗӨВХӨН 404 нь буцах шалтгаан.  403 (эрхгүй), 413 (хязгаар хэтэрсэн),
   * 400 (тэмдэглэлгүй татгалзал) зэрэг нь ЖИНХЭНЭ хариултууд — тэднийг
   * хуучин гарцаар «дахин оролдох» нь эрхийн шалгалтыг тойрч гарах гэсэн
   * оролдлого мэт харагдах ба хэрэглэгчид ХУДАЛ амжилт үзүүлж болзошгүй.
   */
  const callBulk = useCallback(
    async (
      action: 'promote' | 'reject',
      ids: number[],
      note: string | null,
      legacy: () => Promise<unknown>,
    ): Promise<unknown> => {
      if (!bulkRouteMissing.current) {
        try {
          return await apiFetch<unknown>(BULK_ROUTE, {
            method: 'POST',
            data: note === null ? { action, log_ids: ids } : { action, log_ids: ids, note },
          });
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) throw err;
          bulkRouteMissing.current = true;
        }
      }
      return legacy();
    },
    [],
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: PENDING_KEY });
    void queryClient.invalidateQueries({ queryKey: ['/revit/assistant/reviewed'] });
  }, [queryClient]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  /**
   * ⚠️ ЖАГСААЛТАД БАЙХГҮЙ МӨРИЙГ СОНГОЛТООС ХАСНА.
   *
   * Баг солиход, эсвэл өөр хянагч зэрэг ажиллаж мөрийг шийдвэрлэсний дараа
   * шинэчлэхэд, сонголтод ҮЛ ҮЗЭГДЭХ id үлдэж болно.  Тэр үед «Сонгосныг
   * хасах (12)» гэж бичээстэй товч нь хянагчийн ХАРААГҮЙ мөрийг устгана —
   * `AND review_status IS NULL` нь эхний шийдвэрийг ялагч болгодог тул
   * буцаах БОЛОМЖГҮЙ.  Тиймээс сонголт нь ҮРГЭЛЖ дэлгэц дээрх мөрүүдийн
   * ДЭД ОЛОНЛОГ байна.
   */
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(rows.map((r) => r.id));
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows]);

  /**
   * ⚠️ ХЭСЭГЧИЛСЭН АМЖИЛТЫГ МӨР ТУС БҮРЭЭР ТОДРУУЛАХ.
   *
   * Сервер `{added: 17}` гэж хэлээд аль 3 нь болоогүйг ХЭЛЭХГҮЙ үед,
   * дараалал ДАХИН уншигдсаны дараа тэр 3 нь ЖАГСААЛТАД ЭРГЭЖ ГАРНА
   * (`/assistant/pending` нь `WHERE curated = 0`).  Тэр агшинд л «аль нь»
   * гэдэг асуултад хариулж чадна.
   *
   * ⚠️ `dataUpdatedAt > result.at` шалгалт нь ЗААВАЛ: үүнгүйгээр үйлдлийн
   * ӨМНӨХ кэш дээр дүгнэж, БҮХ мөрийг «болоогүй» гэж будна.
   */
  const dataUpdatedAt = query.dataUpdatedAt;
  const isFetching = query.isFetching;
  useEffect(() => {
    if (!result || result.requestFailed || isFetching) return;
    if (dataUpdatedAt <= result.at) return;
    if (!result.rows.some((r) => r.status === 'unknown')) return;
    const stillPending = new Set(rows.map((r) => r.id));
    setResult((prev) =>
      prev && prev.at === result.at
        ? { ...prev, rows: reconcileByPresence(prev.rows, stillPending) }
        : prev,
    );
  }, [result, rows, dataUpdatedAt, isFetching]);

  const toggleSelect = useCallback(
    (id: number, next: boolean, range: boolean) => {
      setSelected((prev) => {
        const s = new Set(prev);
        const anchor = anchorRef.current;
        if (range && anchor !== null && anchor !== id) {
          const a = rows.findIndex((r) => r.id === anchor);
          const b = rows.findIndex((r) => r.id === id);
          if (a >= 0 && b >= 0) {
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            for (let i = lo; i <= hi; i += 1) {
              const r = rows[i];
              if (!r) continue;
              if (next) s.add(r.id);
              else s.delete(r.id);
            }
            return s;
          }
        }
        if (next) s.add(id);
        else s.delete(id);
        return s;
      });
      anchorRef.current = id;
    },
    [rows],
  );

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const allVisibleSelected = rows.length > 0 && selectedRows.length === rows.length;
  const someVisibleSelected = selectedRows.length > 0 && !allVisibleSelected;
  const overLimit = selectedRows.length > MAX_BULK;

  const toggleAllVisible = useCallback(
    (checked: boolean) => {
      anchorRef.current = null;
      setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());
    },
    [rows],
  );

  /**
   * Мөрийн ЖИНХЭНЭ санаа: хэрэглэгчийн залруулга нь таамгаас ДЭЭГҮҮР.
   * Хоёулаа танигдахгүй бол дэвшүүлэх боломжгүй (сервер 400 өгнө).
   */
  const intentOf = useCallback((row: AssistantLogRow): AssistantIntent | null => {
    if (isAssistantIntent(row.corrected)) return row.corrected;
    if (isAssistantIntent(row.predicted)) return row.predicted;
    return null;
  }, []);

  const promote = useCallback(
    async (targets: AssistantLogRow[], override?: { intent: AssistantIntent; slot: string }) => {
      const examples: ExamplePayload[] = [];
      const attempted: AssistantLogRow[] = [];
      /** Сервер рүү ОГТ явахгүй мөрүүд — тайланд ИЛ гарна. */
      const skipped: AssistantLogRow[] = [];
      for (const row of targets) {
        const intent = override?.intent ?? intentOf(row);
        if (!intent) {
          skipped.push(row);
          continue;
        }
        // ⚠️ P0-C.  Хянагчийн үйлдлийг ИЛ ялгана: машины таамгийг БАТАЛСАН уу,
        //    эсвэл шошгыг ӨӨРЧИЛСӨН үү.  Харьцуулалт нь ҮРГЭЛЖ `row.predicted`
        //    (машиных) — `row.corrected` нь Revit доторх эцсийн хэрэглэгчийн
        //    залруулга бөгөөд тэр ч бас машинаас ЗӨРСӨН шошго тул «зассан».
        //    Энэ хоёр талбарыг илгээхгүй бол сервер `source_type = 'UNKNOWN'`
        //    тавьж, 0215-ийн бодлогоор мөр сургалтын цөмд ХЭЗЭЭ Ч ОРОХГҮЙ.
        const action = curationActionFor(row.predicted, intent);
        examples.push({
          text: row.text,
          intent,
          slot: override ? override.slot || null : null,
          // ⚠️ `source: 'usage'` нь `log_id`-г ЗААВАЛ шаардана — энэ мөр
          // бодитоор ажиглагдсан гэдгийн ЦОРЫН ГАНЦ нотолгоо.
          source: 'usage',
          log_id: row.id,
          curation_action: action,
          source_type: curationSourceType(action, row.predicted),
        });
        attempted.push(row);
      }

      /** Санаагүй мөрүүдийн тайлангийн мөр — сервер тэднийг ХАРААГҮЙ. */
      const skippedResultRows: BulkResultRow[] = skipped.map((r) => ({
        id: r.id,
        text: r.text,
        status: 'skipped',
        reason: null,
        reasonKey: 'assistantCuration.reasonNoIntent',
        inferred: false,
      }));

      if (examples.length === 0) {
        // ⚠️ Зөвхөн toast БИШ.  40 мөр сонгоод бүгд нь санаагүй байвал
        //    хянагч АЛЬ мөрийг «Засаад авах»-аар оруулахаа мэдэх ёстой.
        setResult({
          kind: 'promote',
          at: Date.now(),
          rows: skippedResultRows,
          serverCount: null,
          perRowFromServer: false,
          requestFailed: false,
        });
        toast.error(t('assistantCuration.noIntentError'));
        return;
      }

      setBusy(true);
      try {
        // ⚠️ СЕРВЕРИЙН тоог харуулна, илгээсэн тоог БИШ.  Роут нь мөрийг
        //    шүүдэг (танихгүй санаа, хоосон бичвэр), тиймээс `added` нь
        //    `examples.length`-ээс БАГА байж болно.  Илгээсэн тоогоо
        //    харуулах нь хянагчид ХУДАЛ баталгаа өгнө.
        const ids = attempted.map((r) => r.id);
        const legacyPromote = () =>
          apiFetch<ExamplesResponse>('/revit/assistant/examples', {
            method: 'POST',
            data: { examples, log_ids: ids },
          }) as Promise<unknown>;
        // ⚠️ «Засаад авах» нь ХЯНАГЧИЙН ГАРААР сонгосон санааг зөөдөг тул
        //    ҮРГЭЛЖ хуучин гарцаар явна — багц гарц нь шошгыг СЕРВЕР талд
        //    (`predicted` / `corrected`-оос) ургуулдаг ба гараар өгсөн
        //    санааг хүлээж авах талбаргүй.  Түүнийг тэнд илгээвэл хянагчийн
        //    залруулга ЧИМЭЭГҮЙ алдагдана.
        const res = override
          ? await legacyPromote()
          : await callBulk('promote', ids, null, legacyPromote);
        const count = pickCount(res, PROMOTE_COUNT_KEYS);
        const parsed = parseBulkOutcomes(res, ids);
        const byId = new Map(attempted.map((r) => [r.id, r.text]));
        const outcomeRows = reconcileByCount(
          parsed.outcomes.map<BulkResultRow>((o) => ({ ...o, text: byId.get(o.id) ?? '' })),
          count,
        );
        setResult({
          kind: 'promote',
          at: Date.now(),
          rows: [...outcomeRows, ...skippedResultRows],
          serverCount: count,
          perRowFromServer: parsed.found,
          requestFailed: false,
        });

        if (count === null) toast.success(t('assistantCuration.promoteDoneUnknown'));
        else toast.success(t('assistantCuration.promoteDone', { count }));
        clearSelection();
        invalidate();
      } catch (err) {
        const message = err instanceof Error ? err.message : t('assistantCuration.actionFailed');
        // ⚠️ ХОЁР ТЭС ӨӨР УНАЛТ.
        //    · 4xx / сүлжээ — сервер бичихээс ӨМНӨ татгалзсан (403, 413,
        //      тэмдэглэлгүй 400).  НЭГ Ч мөр өөрчлөгдөөгүй ⇒ `failed`.
        //    · 5xx — багц бичилтийн ДУНД унасан байж БОЛНО.  Тэднийг
        //      «амжилтгүй» гэж будах нь ХУДАЛ байж мэднэ, тиймээс
        //      `unknown` үлдээгээд дарааллыг ДАХИН уншуулна — доорх
        //      `reconcileByPresence` мөр тус бүрийн үнэнийг гаргана.
        //    Сонголтыг ХОЁУЛАНД нь ХЭВЭЭР үлдээнэ: хянагч дахин 40 мөр
        //    дарж сонгох ёсгүй.
        const midWrite = err instanceof ApiError && err.status >= 500;
        setResult({
          kind: 'promote',
          at: Date.now(),
          rows: [
            ...attempted.map<BulkResultRow>((r) => ({
              id: r.id,
              text: r.text,
              status: midWrite ? 'unknown' : 'failed',
              reason: midWrite ? null : message,
              reasonKey: null,
              inferred: false,
            })),
            ...skippedResultRows,
          ],
          serverCount: null,
          perRowFromServer: false,
          requestFailed: !midWrite,
        });
        if (midWrite) invalidate();
        toast.error(message);
      } finally {
        setBusy(false);
      }
    },
    [callBulk, clearSelection, intentOf, invalidate, t],
  );

  const reject = useCallback(
    async (targets: AssistantLogRow[], note: string) => {
      const ids = targets.map((r) => r.id);
      if (ids.length === 0) return;
      setBusy(true);
      try {
        // ⚠️ СЕРВЕРИЙН `meta.changes`.  `AND review_status IS NULL` нь аль
        //    хэдийн хянагдсан мөрийг алгасдаг тул илгээсэн тоогоо харуулах нь
        //    «хаслаа» гэсэн ХУДАЛ мэдэгдэл болно (жишээ нь өөр хянагч зэрэг
        //    ажиллаж байхад).
        const trimmed = note.trim();
        const res = await callBulk(
          'reject',
          ids,
          trimmed,
          () =>
            apiFetch<ReviewResponse>('/revit/assistant/review', {
              method: 'POST',
              data: { log_ids: ids, outcome: 'rejected', note: trimmed },
            }) as Promise<unknown>,
        );
        const count = pickCount(res, REJECT_COUNT_KEYS);
        const parsed = parseBulkOutcomes(res, ids);
        const byId = new Map(targets.map((r) => [r.id, r.text]));
        const outcomeRows = reconcileByCount(
          parsed.outcomes.map<BulkResultRow>((o) => ({ ...o, text: byId.get(o.id) ?? '' })),
          count,
        );
        setResult({
          kind: 'reject',
          at: Date.now(),
          rows: outcomeRows,
          serverCount: count,
          perRowFromServer: parsed.found,
          requestFailed: false,
        });

        if (count === null) toast.success(t('assistantCuration.rejectDoneUnknown'));
        else toast.success(t('assistantCuration.rejectDone', { count }));
        setRejectIds(null);
        clearSelection();
        invalidate();
      } catch (err) {
        const message = err instanceof Error ? err.message : t('assistantCuration.actionFailed');
        // ⚠️ `promote`-тэй ИЖИЛ дүрэм: 5xx нь «дунд нь унасан байж болно» ⇒
        //    `unknown` үлдээж, дарааллаас тунадаслана.  Дэлгэрэнгүйг дээрх
        //    `promote`-ийн тайлбараас үзнэ үү.  ⚠️ Цонхыг ХААХГҮЙ:
        //    хянагчийн бичсэн шалтгаан алдагдвал дахин бичих ёстой болно.
        const midWrite = err instanceof ApiError && err.status >= 500;
        setResult({
          kind: 'reject',
          at: Date.now(),
          rows: targets.map<BulkResultRow>((r) => ({
            id: r.id,
            text: r.text,
            status: midWrite ? 'unknown' : 'failed',
            reason: midWrite ? null : message,
            reasonKey: null,
            inferred: false,
          })),
          serverCount: null,
          perRowFromServer: false,
          requestFailed: !midWrite,
        });
        if (midWrite) {
          // Үр дүн нь ТОДОРХОЙГҮЙ тул тайланг харуулах ёстой — цонх нь
          // түүнийг халхална.  Харин 4xx (юу ч болоогүй) үед цонх НЭЭЛТТЭЙ
          // үлдэж, хянагчийн бичсэн шалтгаан хадгалагдана.
          setRejectIds(null);
          invalidate();
        }
        toast.error(message);
      } finally {
        setBusy(false);
      }
    },
    [callBulk, clearSelection, invalidate, t],
  );

  /** Татгалзах цонхонд буй мөрүүд — id-г бичвэртэй нь хамт барина. */
  const rejectTargets = useMemo(
    () => (rejectIds == null ? [] : rows.filter((r) => rejectIds.includes(r.id))),
    [rejectIds, rows],
  );

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (query.isError) {
    return <p className="text-body text-destructive">{t('assistantCuration.loadFailed')}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={team ?? ALL_TEAMS}
          onValueChange={(v) => onTeamChange(v === ALL_TEAMS ? null : normalizeTeamCode(v))}
        >
          <SelectTrigger
            size="sm"
            className="w-56"
            aria-label={t('assistantCuration.teamFilterLabel')}
          >
            <SelectValue placeholder={t('assistantCuration.teamFilterLabel')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TEAMS}>{t('assistantCuration.teamFilterAll')}</SelectItem>
            {teamOptions.map((o) => (
              <SelectItem key={o.code} value={o.code}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-body text-muted-foreground">
          {t('assistantCuration.queueCount', { count: rows.length })}
        </span>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={invalidate} disabled={busy}>
          <RefreshCw aria-hidden />
          {t('assistantCuration.refresh')}
        </Button>
      </div>

      {/* ⚠️ БАГЦ ҮЙЛДЛИЙН ЭГНЭЭ.  `sticky` нь ЗААВАЛ: дараалал 200 мөр
          хүртэл урт байж болох ба хянагч доошоо гүйж явахдаа сонгодог.
          Наалддаггүй эгнээ нь «сонгоод дээш нь гүйж очиж товч дарах» гэсэн
          үнэ цэнгүй ажлыг 200 мөр тутамд шаардана. */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-background/95 p-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <label className="flex cursor-pointer items-center gap-2 text-body">
          <Checkbox
            checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
            disabled={busy || rows.length === 0}
            onCheckedChange={(v) => toggleAllVisible(v === true)}
            aria-label={t('assistantCuration.selectAllVisible')}
          />
          {t('assistantCuration.selectAllVisible')}
        </label>

        {/* ⚠️ `aria-live` — дэлгэц уншигч хэрэглэгч сонголтын тоог
            checkbox бүр дээр дахин уншихгүйгээр мэдэх ЦОРЫН ГАНЦ зам. */}
        <span aria-live="polite" className="text-body font-medium">
          {t('assistantCuration.selectedCount', {
            count: selectedRows.length,
            total: rows.length,
          })}
        </span>

        <Button
          variant="ghost"
          size="sm"
          disabled={busy || selectedRows.length === 0}
          onClick={clearSelection}
        >
          <X aria-hidden />
          {t('assistantCuration.clearSelection')}
        </Button>

        {/* Shift-мужийн заавар — байхгүй бол хэн ч олохгүй боломж. */}
        {rows.length > 1 ? (
          <span className="hidden text-micro text-muted-foreground lg:inline">
            {t('assistantCuration.bulkRangeHint')}
          </span>
        ) : null}

        <span className="flex-1" />

        <Button
          size="sm"
          disabled={busy || selectedRows.length === 0 || overLimit}
          onClick={() => void promote(selectedRows)}
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCheck aria-hidden />}
          {t('assistantCuration.bulkPromote', { count: selectedRows.length })}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy || selectedRows.length === 0}
          onClick={() => setRejectIds(selectedRows.map((r) => r.id))}
        >
          {t('assistantCuration.bulkReject', { count: selectedRows.length })}
        </Button>

        {/* ⚠️ Товч ЯАГААД унтарснаа хэлэх ёстой.  Урьд нь `> MAX_BULK` үед
            «Сонгосныг авах (240)» гэж бичээстэй товч ЧИМЭЭГҮЙ идэвхгүй
            болдог байсан. */}
        {overLimit ? (
          <p className="w-full text-micro text-amber-600">
            {t('assistantCuration.bulkLimitHint', { max: MAX_BULK })}
          </p>
        ) : null}
      </div>

      {result ? (
        <BulkResultPanel
          result={result}
          onDismiss={() => setResult(null)}
          onReselect={(ids) => {
            // Зөвхөн ОДООГИЙН жагсаалтад БАЙГАА мөрийг сэргээнэ — алга
            // болсон мөрийг сонгох нь үл үзэгдэх сонголт үүсгэнэ.
            const live = new Set(rows.map((r) => r.id));
            setSelected(new Set(ids.filter((id) => live.has(id))));
            anchorRef.current = null;
          }}
        />
      ) : null}

      {teamFilterInactive ? (
        <div className="flex gap-2 rounded-md bg-amber-500/10 p-3 text-body">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <p className="break-words">{t('assistantCuration.teamFilterInactive')}</p>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-body text-muted-foreground">
          {team ? t('assistantCuration.emptyPendingTeam') : t('assistantCuration.emptyPending')}
        </p>
      ) : null}

      <div className="space-y-3">
        {rows.map((row) => (
          <LogCard
            key={row.id}
            row={row}
            selected={selected.has(row.id)}
            onToggleSelect={toggleSelect}
            isOwn={currentUserId != null && row.user_id === currentUserId}
            actions={
              <>
                <Button
                  size="sm"
                  disabled={busy || intentOf(row) == null}
                  onClick={() => void promote([row])}
                >
                  {t('assistantCuration.promote')}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setCorrecting(row)}>
                  {t('assistantCuration.correctAndPromote')}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => setRejectIds([row.id])}
                >
                  {t('assistantCuration.reject')}
                </Button>
              </>
            }
          />
        ))}
      </div>

      {/* ⚠️ `requireNote` — курацийн дараалалд шалтгаан нь ЗААВАЛ.  Багцаар
          40 мөр хаяхад «яагаад» гэдэг нь `assistant_logs.review_note`-д
          ҮҮРД үлддэг ЦОРЫН ГАНЦ сөрөг дохио; хоосон үлдээвэл тэр 40 мөр
          нь дараагийн долоо хоногийн хяналтад ХОГ болно. */}
      <RejectDialog
        open={rejectIds != null}
        count={rejectTargets.length}
        busy={busy}
        requireNote
        onCancel={() => setRejectIds(null)}
        onConfirm={(note) => void reject(rejectTargets, note)}
      />

      <CorrectDialog
        open={correcting != null}
        defaultIntent={(correcting ? intentOf(correcting) : null) ?? 'unknown'}
        busy={busy}
        onCancel={() => setCorrecting(null)}
        onConfirm={(intent, slot) => {
          const row = correcting;
          setCorrecting(null);
          if (row) void promote([row], { intent, slot });
        }}
      />
    </div>
  );
}
