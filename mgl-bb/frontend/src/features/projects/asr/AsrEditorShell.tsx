import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  FileText,
  Loader2,
  NotebookPen,
  Pencil,
  Printer,
  ScrollText,
  Send,
  Trash2,
} from 'lucide-react';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { ApiError } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLocalDraft } from '@/shared/hooks/useLocalDraft';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/ui/sheet';
import {
  useAsrApprove,
  useAsrCreateIn,
  useAsrDelete,
  useAsrPatch,
  useAsrReject,
  useAsrSubmit,
} from './api';
import { AsrEditor, type AsrChange } from './AsrEditor';
import { AsrPagedDocument } from './AsrPagedDocument';
import { ASR_DOC_SCREEN_STYLES } from './asrPrintStyles';
import { downloadAsrPdf } from './downloadAsrPdf';
import { downloadAsrDocx } from './buildAsrDocx';
import { asrProjectInfoFrom } from './projectInfo';
import { hasMeetingRequests } from './meetingDoc';
import { AsrReviewBar } from './AsrReviewBar';
import { SigningLinkButton } from '@/features/signing/SigningLinkButton';
import {
  formStateFrom,
  isAsrPersisted,
  patchBodyFrom,
  redBookGap,
  redBookStatusOf,
  reportTypeOf,
  usesMeetingForm,
  type AsrFormState,
  type AsrReport,
  type AsrTeamOption,
} from './types';

/**
 * Тайлангийн засварлагч.  Утсанд доороос гарах Sheet, десктоп дээр
 * Dialog (2026-09-25-аас A4 цаас багтах өргөнтэй — засварлагч нь баримтын
 * хэлбэртэй) — гэхдээ НЭГ л `AsrEditor`, нэг props объект
 * (`MailInboxPage.tsx`-ийн rail/reading хэв маяг).
 *
 * `useMediaQuery`-г ашиглаж байгаа нь санамсаргүй биш: `use-mobile.ts`
 * эхний render дээр `false` буцаадаг тул Dialog mount болоод Sheet рүү
 * үсрэх ба гарын үсгийн canvas дахин mount болж хагас зурсан зураас
 * алдагдана.
 *
 * ХОЁР ГОРИМ (эзний хүсэлт 2026-09-28):
 *   • «Баримт» — ӨГӨГДМӨЛ: хадгалагдсан тайлан нээхэд шууд хэвлэгдэх баримт
 *     A4 хуудсуудад хуваагдаж харагдана (`AsrPagedDocument`, хэвлэх хуудастай
 *     ИЖИЛ).  Хэвлэх / PDF / Word / батлах / илгээх эндээс.
 *   • «Засварлах» — хуучин засварлагч (`AsrEditor`).  Эндээс «Баримт» руу
 *     буцахад хүлээгдэж буй засварыг ЭХЛЭЭД серверт бичнэ — баримт нь
 *     серверийн хариунаас (`docEntry`) зурагддаг.
 *   Хадгалаагүй шинэ тайлан, сэргээх боломжтой локал ноорогтой тайлан,
 *   `initialMode='edit'` (хэвлэх хуудасны «Засварлах») шууд засварлагчаар.
 *
 * Ноорог хоёр давхар хамгаалалттай:
 *   1) сервер тал — 2.5с debounce-той PATCH;
 *   2) localStorage — 500мс debounce, таб фон руу орох/хаагдах үед flush.
 * Талбай дээр сүлжээ унасан үед (2) л ажиллана.
 */

const AUTOSAVE_MS = 2500;
/**
 * Дараалсан амжилтгүй автомат хадгалалтын дээд тоо.
 *
 * Хадгалалт бүтэлгүйтэхэд `dirty` нь `true` хэвээр үлддэг ба алдааны
 * төлөв дахин render хийдэг тул effect дахин ажиллаж, шинэ 2.5с timeout
 * тавьж, дахин унаж … гэсэн ТӨГСГӨЛГҮЙ ГОГЦОО үүсдэг байсан: сүлжээ
 * тасарсан утас нээлттэй засварлагчтай хэвтэхэд API руу секунд тутам
 * хүсэлт бөмбөгддөг.  Гурав унасны дараа автомат хадгалалт зогсоно —
 * локал ноорог localStorage-д АЮУЛГҮЙ үлдэх тул өгөгдөл алдагдахгүй,
 * хэрэглэгч «Ноорог хадгалах» дарж (тоолуур тэглэгдэнэ) эсвэл илгээх
 * үедээ дахин оролдоно.
 */
const AUTOSAVE_MAX_FAILURES = 3;
const draftKey = (id: number) => `mgl:asr-draft:${id}`;
/**
 * ХАДГАЛААГҮЙ тайлангийн локал ноорогийн түлхүүр.
 *
 * ⚠️ `client_uuid`-аар түлхүүрлэнэ, `id`-аар БИШ: хадгалаагүй тайлангийн id
 *    үргэлж 0 тул нийтлэг түлхүүр хэрэглэвэл өмнө хаясан ноорог дараагийн
 *    «Шинэ тайлан» дээр «сэргээх үү?» гэж гарч ирнэ.
 */
const newDraftKey = (clientUuid: string) => `mgl:asr-draft:new:${clientUuid}`;

export interface AsrEditorShellProps {
  projectId: number;
  entry: AsrReport;
  teamOptions: AsrTeamOption[];
  canReview: boolean;
  currentUserId: number | null;
  isAdmin: boolean;
  open: boolean;
  onClose: () => void;
  onChanged: (id?: number) => void;
  /**
   * ХАДГАЛААГҮЙ тайлан анх удаа серверт үүссэн — дуудагч одооноос бодит
   * id-тай ажиллана (URL солих / `openId` тавих).  Зөвхөн `entry.id === 0`
   * үед дуудагдана.
   */
  onCreated?: (id: number) => void;
  /** `'edit'` бол «Баримт» биш засварлагчаар нээнэ (`?edit=1`). */
  initialMode?: 'view' | 'edit';
}

export function AsrEditorShell(props: AsrEditorShellProps) {
  const { entry, open, onClose } = props;
  const { t } = useLanguage();
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const title = entry.doc_no ?? t('asr.new');
  const body = <AsrEditorBody {...props} />;

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        {/* ⚠️ `sm:` breakpoint-ээс дээш DialogContent нь үндсэн дээрээ
            `sm:grid sm:gap-4 sm:p-6` болдог (ui/dialog.tsx).  Зөвхөн
            breakpoint-гүй `flex`-ийг өгвөл media query дотор `sm:grid`
            хожиж, доторх `flex-1 min-h-0 overflow-y-auto` утгагүй болж
            маягт гүйлгэгдэхээ болино.  Тиймээс `sm:` хувилбар бүрийг нь
            тодорхой дарж өгөх ёстой. */}
        <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:flex sm:max-w-5xl sm:gap-0 sm:p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle className="font-mono text-base">{title}</DialogTitle>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      {/* `max-h-[92vh]` нь `dvh`-г дэмждэггүй хуучин iOS Safari-д зориулсан
          нөөц хязгаар — эс бөгөөс өндөр нь `h-auto` болж, sheet агуулгын
          хэрээр сунаж гүйлгэлт алга болно. */}
      <SheetContent
        side="bottom"
        className="flex h-[92dvh] max-h-[92vh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0"
      >
        <SheetTitle className="shrink-0 border-b px-4 py-3 pr-12 font-mono text-base">
          {title}
        </SheetTitle>
        {body}
      </SheetContent>
    </Sheet>
  );
}

function AsrEditorBody({
  projectId,
  entry,
  teamOptions,
  canReview,
  currentUserId,
  isAdmin,
  onClose,
  onChanged,
  onCreated,
  initialMode,
}: AsrEditorShellProps) {
  const { t } = useLanguage();

  /*
   * Засах эрх — `routes/authorSupervision.ts`-ийн `PATCH /:id` gate-ийн
   * ТОЛИН ТУСГАЛ.  Хоёр талыг ХАМТ өөрчил.
   *
   *   • зохиогч — ӨӨРИЙН тайланг ДУРЫН төлөвт (хүлээгдэж буй, батлагдсан ч —
   *     эзний шийдвэр, 2026-09-30): «Засварлах» таб дээр дармагц засна,
   *     зураг нэмэх / солих орно;
   *   • админ  — ДУРЫН тайланг ДУРЫН төлөвт (эзний шийдвэр, 2026-08-28):
   *     илгээгдсэн материалыг хараад засаад ТЭГЭЭД батлах нь хяналтын
   *     үндсэн урсгал.
   *
   * ⚠️ Өөр хүний БАТЛАГДСАН тайлан админд нэмэлт цоожтой: «Засварлах» дарж
   *    ил тайлна — тамга, гарын үсэгтэй албан баримт санамсаргүй товшилтоор
   *    өөрчлөгдөх ёсгүй.  Зохиогчийн хувьд «Засварлах» таб өөрөө тэр ил алхам.
   */
  const [unlocked, setUnlocked] = useState(false);
  /** Серверт үүссэн үү?  `false` бол дуу бичлэг / PDF / хэвлэх / устгах алга. */
  const persisted = isAsrPersisted(entry);
  const ownReport = entry.author_id === currentUserId;
  /** Админ + өөр хүний батлагдсан = цоожтой; «Засварлах» дарж тайлна. */
  const needsUnlock = isAdmin && !ownReport && entry.status === 'approved';
  const editable = ownReport || (isAdmin && (!needsUnlock || unlocked));
  const readOnly = !editable;
  /** Ноорог/буцаагдсан = илгээх урсгал; бусад нь «засаад батлах» урсгал. */
  const canSubmit = editable && (entry.status === 'draft' || entry.status === 'rejected');
  /** Илгээгдсэн / батлагдсан тайланг засаж байгаа — юу болж байгааг ил хэлнэ. */
  const editingLocked = editable && !canSubmit;
  /** Мэдэгдлийн бичвэр: өөрийнхөө тайлан уу, админ өөр хүнийхийг үү. */
  const adminEditing = isAdmin && !ownReport;

  const [form, setForm] = useState<AsrFormState>(() => formStateFrom(entry));
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [restorable, setRestorable] = useState(false);

  const key = persisted ? draftKey(entry.id) : newDraftKey(entry.client_uuid);
  const { saved: localDraft, persist, clear } = useLocalDraft<AsrFormState>(key);

  /*
   * «Баримт» / «Засварлах».  Сэргээх боломжтой локал ноорог байвал шууд
   * засварлагчаар — эс бөгөөс «Сэргээх үү?» мөр далд горимд нуугдаж,
   * хэрэглэгч бичсэнээ алдсан гэж ойлгоно.
   */
  const [mode, setMode] = useState<'view' | 'edit'>(() => {
    if (!persisted || initialMode === 'edit') return 'edit';
    const draftDiffers =
      editable &&
      localDraft != null &&
      JSON.stringify(localDraft) !== JSON.stringify(formStateFrom(entry));
    return draftDiffers ? 'edit' : 'view';
  });

  /*
   * «Баримт» горимын өгөгдөл = СЕРВЕРИЙН хамгийн сүүлийн хувилбар.  Prop
   * (дуудагчийн refetch) ба PATCH-ийн хариу (`save`) хоёулаа шинэчилнэ —
   * засвараас «Баримт» руу шилжихэд refetch-ийг хүлээхгүй, шууд шинэ баримт.
   */
  const [docEntry, setDocEntry] = useState(entry);
  const [prevEntryProp, setPrevEntryProp] = useState(entry);
  if (entry !== prevEntryProp) {
    setPrevEntryProp(entry);
    setDocEntry(entry);
  }

  /*
   * ХАДГАЛААГҮЙ ноорогийн танилцуулга.
   *
   * ⚠️ Сервер тал `project_info`-г ЗӨВХӨН хадгалагдсан тайлан дээр буцаана
   *    (`loadDetail`) — id байхгүй тайлан түүнд байхгүй.  Тиймээс энд
   *    төслийн дэлгэрэнгүйг татаж, ИХЭР resolver-ээр ижил утга гаргана.
   * ⚠️ Түлхүүр нь `useProjectDetail`-ийнхтэй ЯГ ижил (`['/projects', id]`,
   *    id нь МӨР) — төслийн хуудсан дээр таб дотор нээгдэхэд кэшийг
   *    хуваалцаж, нэмэлт сүлжээний дуудлага гарахгүй.
   * «Баримт» горим ч үүнийг хэрэглэнэ — толгойн Doc. No. / маягтын
   * «Төслийн нэр» нь `project.name`-ээс (хэвлэх хуудастай ижил эх сурвалж).
   */
  const projectDetail = useApiQuery<Parameters<typeof asrProjectInfoFrom>[0]>(
    ['/projects', String(projectId)],
    `/projects/${projectId}`,
  );
  const liveProjectInfo = useMemo(
    () => (projectDetail.data ? asrProjectInfoFrom(projectDetail.data) : null),
    [projectDetail.data],
  );

  const create = useAsrCreateIn();
  const patch = useAsrPatch();
  const submit = useAsrSubmit();
  const approve = useAsrApprove();
  const reject = useAsrReject();
  const del = useAsrDelete();

  // Серверийн хувилбараас ЗӨРСӨН локал ноорог байвал л сэргээхийг санал болгоно.
  useEffect(() => {
    if (!editable || !localDraft) return;
    if (JSON.stringify(localDraft) !== JSON.stringify(formStateFrom(entry))) setRestorable(true);
    // Зөвхөн mount дээр нэг удаа шийднэ — дараа нь өөрийн бичилт нь
    // баннерыг дахин гаргах ёсгүй.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `form`-ийн хамгийн сүүлийн утгыг debounce хийсэн хадгалалтад хүргэх ref.
  // Render үед БИШ, effect дотор шинэчилнэ (render цэвэр байх ёстой).
  const latest = useRef(form);
  const dirty = useRef(false);
  const failures = useRef(0);

  /**
   * @returns Серверт хүрсэн эсэх.  ⚠️ Дуудагч нар ЭНЭ УТГЫГ ШАЛГАХ ЁСТОЙ —
   *          өмнө нь `save()` нь алдааг залгичаад `void` буцаадаг байсан
   *          тул `doSubmit` бүтэлгүй хадгалалтын дараа ч үргэлжилж,
   *          сервер ХУУЧИН агуулга дээр шалгалтаа хийдэг байв: хэрэглэгч
   *          бүх зүйлээ бөглөсөн атлаа «Дор хаяж нэг багийг сонгоно уу»
   *          гэсэн ТӨӨРӨГДҮҮЛЭХ 400 иддэг байсан (жинхэнэ шалтгаан нь
   *          сүлжээ байтал).
   */
  /**
   * @param opts.silent  `true` бол шинээр үүссэн id-г дуудагчид ХЭЛЭХГҮЙ.
   *   `doSubmit` үүнийг ашиглана: дуудагч id-г мэдмэгц засварлагчийг бодит
   *   мөр рүү сольж ДАХИН MOUNT хийдэг бөгөөд тэр нь илгээлтийн дундуур
   *   болбол баталгаажуулах цонх ба `submit` мутаци салсан компонент дээр
   *   үлдэнэ.  Илгээлт дуусмагц (эсвэл унамагц) `doSubmit` өөрөө хэлнэ.
   * @returns Хадгалагдсан тайлангийн id, эсвэл `null` (сервер хүрсэнгүй).
   */
  const save = useCallback(
    async (opts?: { silent?: boolean }): Promise<number | null> => {
      if (!editable) return entry.id;
      setSaveState('saving');
      try {
        let id = entry.id;
        if (!persisted) {
          /*
           * ЭНД, ЗӨВХӨН ЭНД тайлан бодитоор үүснэ.  «Шинэ тайлан» дарахад
           * биш — эзний шийдвэр (2026-09-04): бодлоо өөрчилсөн хэрэглэгч
           * жагсаалтад хоосон ноорог үлдээх ёсгүй.
           *
           * ⚠️ Давхар үүсэхээс `client_uuid` хамгаална: сервер тэр түлхүүрээр
           *    dedupe хийж БАЙГАА мөрөө буцаадаг тул сүлжээ тасарсны дараах
           *    дахин оролдлого хоёр дахь тайлан үүсгэхгүй.
           */
          const res = await create.mutateAsync({
            project_id: projectId,
            client_uuid: entry.client_uuid,
            report_date: latest.current.report_date,
            // ХАБ-ын танилцсан баталгаа — «Шинэ тайлан» дарахад зурсан
            // (`AsrSafetyDialog`).  Сервер талбайн хяналтыг энэ id-гүйгээр
            // үүсгэхгүй; бусад төрөлд `null` (0362).
            safety_ack_id: entry.safety_ack_id ?? null,
            // Төрөл нь ХААЛГЫГ шийддэг тул POST-д ЗААВАЛ — дараагийн PATCH-д
            // найдвал сервер `site` гэж үзээд баталгаа нэхнэ.
            report_type: latest.current.report_type ?? entry.report_type ?? 'site',
          });
          id = res.entry.id;
          /*
           * ⚠️ Сервер үүсгэх агшинд ЗОХИОГЧИЙН ӨӨРИЙН багийг урьдчилан
           *    тэмдэглэдэг (`routes/authorSupervision.ts`).  Дараагийн PATCH
           *    нь маягтын жагсаалтаар ДАРЖ бичдэг тул хэрэглэгч нэг ч баг
           *    сонгоогүй үед тэр урьдчилгааг ЭНД авч үлдэхгүй бол шууд
           *    устана — «Илгээх» нь «дор хаяж нэг баг» гэж 400 иднэ.
           */
          if (latest.current.selected_team_ids.length === 0) {
            const seeded = (res.entry.teams ?? []).map((r) => r.team_id);
            if (seeded.length > 0) {
              latest.current = { ...latest.current, selected_team_ids: seeded };
              setForm(latest.current);
            }
          }
        }
        const res = await patch.mutateAsync({ id, ...patchBodyFrom(latest.current) });
        if (res?.entry) setDocEntry(res.entry);
        dirty.current = false;
        failures.current = 0;
        setSaveState('saved');
        clear();
        onChanged(id);
        // Хамгийн сүүлд: дуудагч энд засварлагчийг бодит id рүү сольж
        // дахин mount хийдэг тул түүнээс дээших мөрүүд гүйцэд ажиллах ёстой.
        if (!persisted && !opts?.silent) onCreated?.(id);
        return id;
      } catch (err) {
        // Сүлжээ унасан ч localStorage-ийн ноорог үлдэнэ.
        failures.current += 1;
        setSaveState('error');
        // ХАБ-ын баталгаа хүчингүй (24 цаг өнгөрсөн / өөр хүн / аль хэдийн
        // хэрэглэсэн) — «дахин оролдох» нэмэргүй, засварлагчийг хааж
        // «Шинэ тайлан»-аас дахин эхлэх л зам.  Ил хэлнэ.
        if (err instanceof ApiError && err.code === 'SAFETY_ACK_REQUIRED') {
          toast.error(t('asr.safety.ackRequired'));
        }
        return null;
      }
    },
    [
      editable,
      entry.id,
      entry.client_uuid,
      entry.report_type,
      persisted,
      projectId,
      create,
      patch,
      clear,
      onChanged,
      onCreated,
    ],
  );

  /**
   * Улаан дэвтэр (зураг / «байгаагүй») ХАДГАЛААГҮЙ тайланд — эхлээд тайланг
   * үүсгэнэ (`doSubmit`-ийн ижил silent зам).  `AsrRedBookSection` мутацийн
   * ДАРАА `onCreated`-ыг өөрөө дуудна (эзэн 2026-09-30).
   */
  const ensureSaved = useCallback(async (): Promise<number | null> => {
    if (persisted) return entry.id;
    failures.current = 0;
    return save({ silent: true });
  }, [persisted, entry.id, save]);

  const onChange: AsrChange = useCallback((delta) => {
    dirty.current = true;
    // Функц хэлбэрийг дэмжинэ: зэрэг дуусаж буй зургийн байршуулалтууд
    // бие биенийхээ үр дүнг дарахгүй.
    setForm((prev) => ({ ...prev, ...(typeof delta === 'function' ? delta(prev) : delta) }));
    setSaveState('saving');
  }, []);

  // `form` өөрчлөгдөх бүрт: localStorage руу бичиж, серверийн хадгалалтыг
  // хойшлуулна.  setState-ийг синхроноор дуудахгүй — `save()` нь timeout
  // дотор л ажиллана.
  useEffect(() => {
    latest.current = form;
    if (!dirty.current) return;
    persist(form);
    if (!editable) return;
    /*
     * ⚠️ ХАДГАЛААГҮЙ тайлан автоматаар ҮҮСЭХГҮЙ.  Autosave энд ажиллавал
     *    хэрэглэгч нэг үсэг бичихэд л 2.5 секундын дараа мөр үүсч,
     *    «зөвхөн Хадгалах дарахад хадгалагдана» гэсэн шаардлага утгагүй
     *    болно.  Локал ноорог (дээрх `persist`) хэвээр ажиллах тул хуудас
     *    санамсаргүй хаагдахад бичсэн зүйл алдагдахгүй.
     */
    if (!persisted) return;
    // Дараалан унасан бол автоматаар дахин оролдохоо болино (дээрх
    // тогтмолын тайлбарыг үз).  Гараар хадгалах зам нээлттэй хэвээр.
    if (failures.current >= AUTOSAVE_MAX_FAILURES) return;
    const id = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(id);
  }, [form, editable, persisted, persist, save]);

  /**
   * Батлах / буцаахын өмнө хүлээгдэж буй засварыг СЕРВЕРТ БИЧНЭ.
   *
   * Админ илгээгдсэн тайланг засах боломжтой болсноор энэ нь заавал
   * болов: `AUTOSAVE_MS` (2.5с) дуусаагүй байхад «Батлах» дарвал
   * (1) батлалт ХУУЧИН агуулгыг гэрчилнэ, (2) дараа нь autosave шинэ
   * агуулгыг бичнэ — гарын үсэг зөрсөн баримт үлдэнэ.  `doSubmit` /
   * `doPdf`-ийн яг тэр хэв маяг.
   */
  const flush = async (): Promise<boolean> => {
    if (!dirty.current) return true;
    failures.current = 0; // хэрэглэгчийн санаачилсан үйлдэл — дахин оролдоно
    if ((await save()) != null) return true;
    toast.error(t('asr.saveFailedBeforeSubmit'));
    return false;
  };

  const busy =
    patch.isPending || submit.isPending || approve.isPending || reject.isPending || del.isPending;

  /*
   * Илгээхийн өмнөх шалгалт — `POST /:id/submit`-ийн ГУРВАН нөхцөлийн
   * ТОЛИН ТУСГАЛ (`routes/authorSupervision.ts`).
   *
   * Өмнө нь клиент тал ЮУ Ч шалгадаггүй байсан: `asr.validationDate` /
   * `…Teams` / `…Body` гэсэн гурван мессеж i18n-д байсан ч ямар ч
   * компонент тэднийг дууддаггүй байв.  Тиймээс талбай дээрх инженер бүх
   * зураг, гарын үсгээ хийчихээд «Илгээх» дарж, батлах цонхыг өнгөрөөж,
   * сүлжээгээр явж байж л «Дор хаяж нэг багийг сонгоно уу» гэсэн 400
   * иддэг байсан — юуг нь дутуу орхисноо тэр болтол мэдэхгүй.
   *
   * ⚠️ Гурван нөхцөл нь серверийнхтэй ЯГ таарах ёстой.  Аль нэгийг нь
   *    өөрчилвөл нөгөө талыг нь ЗААВАЛ хамт өөрчил — эс бөгөөс UI нь
   *    «болно» гээд сервер 400 буцаана (эсвэл эсрэгээр, боломжтой
   *    илгээлтийг хааж эхэлнэ).
   */
  const missingOf = useCallback(
    (f: AsrFormState): string[] => {
      const out: string[] = [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.report_date)) out.push(t('asr.validationDate'));
      // 0336 — «Ажлын тайлан» дэд хэсгүүд ч биет тоологдоно (серверийн ихэр).
      // 0367 — оффис уулзалтад зөвхөн маягтад харагдах хоёр бичвэр.
      const meeting = usesMeetingForm(f.report_type ?? 'site');
      // Оффис уулзалтад баг сонгохгүй (эзэн 2026-10-08) — сервер хүмүүсээс бөглөнө.
      if (!meeting && f.selected_team_ids.length === 0) out.push(t('asr.validationTeams'));
      const hasBody = meeting
        ? !!f.work_report.trim() ||
          !!(f.meeting_purpose ?? '').trim() ||
          hasMeetingRequests(f.meeting_requests)
        : !!f.description.trim() ||
          !!f.work_report.trim() ||
          !!f.site_tasks.trim() ||
          !!f.defects.trim() ||
          f.selected_team_ids.some((id) => !!(f.work_notes[id] ?? '').trim());
      if (!hasBody) out.push(meeting ? t('asr.meeting.validationBody') : t('asr.validationBody'));
      // 0362 — цахим уулзалтад платформ заавал (`reportTypeProblem`-ийн ихэр).
      if (f.report_type === 'online' && !(f.meeting_platform ?? '').trim()) {
        out.push(t('asr.type.validationPlatform'));
      }
      return out;
    },
    [t],
  );
  /** Дэлгэц дээрх сануулга.  ⚠️ `doSubmit` нь `latest.current`-оор дахин
   *  тооцно — үүсгэх агшинд багууд серверээс нэмэгддэг тул энэ memo хараахан
   *  хуучирсан байж болно. */
  const missing = useMemo(() => missingOf(form), [missingOf, form]);
  /**
   * Улаан дэвтэр (0366) — талбайн хяналтыг зураг эсвэл «Талбай дээр улаан
   * дэвтэр байгаагүй»-гүйгээр илгээх / батлахгүй (серверийн `redBookProblem`-ийн
   * ихэр).  `missingOf`-оос ТУСДАА: маягтын `form`-оос биш, серверт шууд очдог
   * `entry`-ээс уншина (улаан дэвтэр autosave-аар явдаггүй).
   */
  const submitRedBookGap = redBookGap(entry, form.report_type ?? reportTypeOf(entry));
  const approveRedBookGap = redBookGap(entry, reportTypeOf(entry));
  const missingShown = useMemo(
    () => (submitRedBookGap ? [...missing, t('asr.validationRedBook')] : missing),
    [missing, submitRedBookGap, t],
  );
  /** «Улаан дэвтэр» хэсэг рүү — «Баримт» горимоос ч (засварлагч руу шилжээд). */
  const goToRedBook = () => {
    setMode('edit');
    window.setTimeout(() => {
      document
        .getElementById('asr-sec-redbook')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  };

  const doSubmit = async () => {
    let id = entry.id;
    /*
     * ⚠️ ХАДГАЛААГҮЙ тайланг ЭХЛЭЭД үүсгэнэ — шалгалтаас ӨМНӨ.  Сервер
     *    үүсгэх агшинд зохиогчийн ӨӨРИЙН багийг урьдчилан тэмдэглэдэг тул
     *    «дор хаяж нэг баг» шалгалтыг түүнээс өмнө ажиллуулбал багаа сонгож
     *    амжаагүй хүнийг шалтгаангүй хаана.
     */
    if (!persisted) {
      failures.current = 0;
      const created = await save({ silent: true });
      if (created == null) {
        toast.error(t('asr.saveFailedBeforeSubmit'));
        return;
      }
      id = created;
    }
    /** Тайлан аль хэдийн үүссэн бол дуудагчид хэлж, засварлагчийг бодит
     *  мөр рүү шилжүүлнэ — эс бөгөөс «хадгалаагүй» гэж харагдсаар байна. */
    const adopt = () => {
      if (!persisted) onCreated?.(id);
    };
    // Дутуу бол СҮЛЖЭЭНД ОГТ ХҮРЭХГҮЙ: юу дутууг нь шууд хэлнэ.
    const gaps = missingOf(latest.current);
    if (gaps.length > 0) {
      adopt();
      toast.error(gaps[0]!);
      return;
    }
    if (redBookGap(entry, latest.current.report_type ?? reportTypeOf(entry))) {
      adopt();
      toast.error(t('asr.validationRedBook'));
      return;
    }
    // Хүлээгдэж буй өөрчлөлтийг эхлээд бичнэ — эс бөгөөс сервер хуучин
    // агуулга дээр «дор хаяж нэг баг» шалгалтаа хийж 400 буцаана.
    if (dirty.current) {
      failures.current = 0; // хэрэглэгчийн санаачилсан үйлдэл — дахин оролдоно
      if ((await save()) == null) {
        adopt();
        toast.error(t('asr.saveFailedBeforeSubmit'));
        return;
      }
    }
    // Талбайн хяналт дээр дээрх шалгалт хаасан (0366); бусад төрөлд улаан
    // дэвтэргүй илгээхийг хаахгүй — «Гарын үсэг дутуу» үлдэхийг ил хэлнэ.
    // Оффис уулзалтад улаан дэвтэр огт хамаагүй (0367) — сануулгагүй.
    const submitMsg =
      !usesMeetingForm(latest.current.report_type ?? reportTypeOf(entry)) &&
      redBookStatusOf(entry) === 'missing'
        ? t('asr.submitConfirmNoRedBook')
        : t('asr.submitConfirm');
    if (!(await confirmDialog({ description: submitMsg }))) {
      adopt();
      return;
    }
    try {
      await submit.mutateAsync({ id });
      clear();
      toast.success(t('asr.submitted'));
      onChanged(id);
      onClose();
    } catch (err) {
      adopt();
      toast.error(err instanceof Error ? err.message : t('asr.saveFailed'));
    }
  };

  const doApprove = async () => {
    if (approveRedBookGap) {
      toast.error(t('asr.validationRedBookApprove'));
      return;
    }
    if (!(await flush())) return;
    try {
      await approve.mutateAsync({ id: entry.id });
      toast.success(t('asr.approved'));
      onChanged(entry.id);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('asr.saveFailed'));
    }
  };

  const doReject = async (note: string) => {
    if (!(await flush())) return;
    try {
      await reject.mutateAsync({ id: entry.id, review_note: note });
      toast.success(t('asr.rejected'));
      onChanged(entry.id);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('asr.saveFailed'));
    }
  };

  const doDelete = async () => {
    // Илгээгдсэн / батлагдсан тайлан устгах нь аудитын бичлэг арилгаж
    // байгаа хэрэг тул илүү хатуу сануулга харуулна.  Дугаар нь ч
    // буцаж ирэхгүй — `seq` дараалалд завсар үлдэнэ.
    const description =
      entry.status === 'draft'
        ? t('asr.deleteConfirm')
        : t('asr.deleteConfirmFinal', { docNo: entry.doc_no ?? '' });
    if (!(await confirmDialog({ description, variant: 'destructive' }))) return;
    try {
      await del.mutateAsync({ id: entry.id });
      clear();
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('asr.saveFailed'));
    }
  };

  const [pdfBusy, setPdfBusy] = useState(false);
  const doPdf = async () => {
    if (pdfBusy) return;
    // Хүлээгдэж буй засварыг эхлээд бичнэ — сервер PDF-ийг ХАДГАЛАГДСАН
    // өгөгдлөөс рендерлэдэг тул эс бөгөөс хуучин хувилбар татагдана.
    if (dirty.current) {
      failures.current = 0;
      if ((await save()) == null) {
        toast.error(t('asr.saveFailedBeforeSubmit'));
        return;
      }
    }
    setPdfBusy(true);
    try {
      await downloadAsrPdf(entry.id, `${entry.doc_no ?? 'DASR'}.pdf`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('asr.pdfFailed'));
    } finally {
      setPdfBusy(false);
    }
  };

  /**
   * Word — `doPdf`-ийн яг тэр урсгал (хадгалаагүй засварыг эхлээд бичнэ), гэхдээ
   * сервер рүү явахгүй: `buildAsrDocx` нь Word ЗАГВАРЫГ хөтөч дээр бөглөнө
   * (тайлбар нь тэр файлд).  Тиймээс Browser Rendering-ийн 10-20 секундийн
   * хүлээлт байхгүй.
   */
  const [docxBusy, setDocxBusy] = useState(false);
  const doDocx = async () => {
    if (docxBusy) return;
    if (dirty.current) {
      failures.current = 0;
      if ((await save()) == null) {
        toast.error(t('asr.saveFailedBeforeSubmit'));
        return;
      }
    }
    setDocxBusy(true);
    try {
      await downloadAsrDocx({ reportId: entry.id, projectId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('asr.docxFailed'));
    } finally {
      setDocxBusy(false);
    }
  };

  const savePill = useMemo(() => {
    if (!editable) return null;
    // ⚠️ ХАДГАЛААГҮЙ тайлан дээр autosave унтарсан тул `saving` нь хэзээ ч
    //    `saved` болохгүй — «Хадгалаагүй» гэж ИЛ хэлэхгүй бол хэрэглэгч
    //    хадгалагдсан гэж эндүүрч цонхоо хаана.
    if (!persisted) return saveState === 'error' ? t('asr.saveFailed') : t('asr.unsaved');
    if (saveState === 'saving') return t('asr.saving');
    if (saveState === 'saved') return t('asr.savedPill');
    if (saveState === 'error') return t('asr.saveFailed');
    return null;
  }, [editable, persisted, saveState, t]);

  // Админ ямар ч төлөвт устгана (буруу / давхардсан бүртгэл цэвэрлэх);
  // зохиогч зөвхөн өөрийн ноорогоо.  Энэ нь backend-ийн
  // `routes/authorSupervision.ts` DELETE gate-ийн яг толин тусгал —
  // өмнө нь UI нь бүгдийг `draft`-аар хязгаарлачихсан байсан тул админ
  // илгээгдсэн тайланг апп дотроос устгаж чаддаггүй байлаа.
  // ⚠️ `persisted` заавал: хадгалаагүй тайлан сервер дээр БАЙХГҮЙ тул
  //    устгах юм байхгүй — цонхоо хаах нь л түүнийг арилгана.
  const canDelete =
    persisted && (isAdmin || (entry.author_id === currentUserId && entry.status === 'draft'));

  /**
   * «Засварлах» → «Баримт».  Хүлээгдэж буй засварыг ЭХЛЭЭД бичнэ: баримт нь
   * серверийн хувилбараас зурагддаг тул эс бөгөөс хуучин агуулга харагдаж,
   * хэрэглэгч «засвар маань алга болжээ» гэж ойлгоно.  Хадгалж чадаагүй бол
   * засварлагч дээрээ үлдэнэ (локал ноорог хэвээр).
   */
  const [switching, setSwitching] = useState(false);
  const showDocument = async () => {
    if (mode === 'view' || switching) return;
    if (dirty.current) {
      failures.current = 0;
      setSwitching(true);
      const ok = (await save()) != null;
      setSwitching(false);
      if (!ok) {
        toast.error(t('asr.saveFailed'));
        return;
      }
    }
    setMode('view');
  };
  /** Засах эрхгүй хүнд засварлагч = уншихад зориулсан маягт (улаан дэвтэр,
   *  дуу бичлэг, хамт явсан хүмүүс) — «Засварлах» гэж нэрлэвэл төөрөгдүүлнэ. */
  const editLabel = editable || needsUnlock ? t('asr.modeEdit') : t('asr.modeDetails');
  const projectName = projectDetail.data?.project?.name ?? '';
  /** ЗХ-д засварласан нэр (0358) — `GET /projects/:id` нь `SELECT *` тул ирнэ. */
  const projectLabel =
    (projectDetail.data?.project as { asr_name?: string | null } | undefined)?.asr_name ?? null;
  /** Төслийн ЗХ-ийн гэрээний дугаар (0365) — мөн `SELECT *`-ээс ирнэ. */
  const projectContractNo =
    (projectDetail.data?.project as { asr_contract_no?: string | null } | undefined)
      ?.asr_contract_no ?? null;

  return (
    <>
      {/* Горим сэлгэгч — зөвхөн серверт байгаа тайланд (шинэ ноорогт харах
          баримт алга). */}
      {persisted && (
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2 sm:px-6">
          <div role="tablist" className="inline-flex rounded-lg bg-muted p-0.5">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'view'}
              disabled={switching}
              onClick={() => void showDocument()}
              className={
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ' +
                (mode === 'view'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              {switching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ScrollText className="h-4 w-4" />
              )}
              {t('asr.modeDocument')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'edit'}
              onClick={() => setMode('edit')}
              className={
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ' +
                (mode === 'edit'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              <NotebookPen className="h-4 w-4" />
              {editLabel}
            </button>
          </div>
        </div>
      )}

      {mode === 'view' ? (
        // Хэвлэх хуудастай ИЖИЛ A4 хуудсууд.  Өнгө нь hex (баримт цагаан
        // цаас) — харанхуй горимд ч саарал дэвсгэр дээр цагаан хуудас.
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-muted/60 px-2 py-4 sm:px-6">
          <style dangerouslySetInnerHTML={{ __html: ASR_DOC_SCREEN_STYLES }} />
          {projectDetail.isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <AsrPagedDocument
              entry={docEntry}
              projectName={projectName}
              projectLabel={projectLabel}
              shifr={docEntry.shifr}
              projectInfo={docEntry.project_info ?? liveProjectInfo}
            />
          )}
        </div>
      ) : (
        /* ⚠️ `overflow-x-hidden` заавал.  CSS-ийн дүрмээр нэг тэнхлэг `visible`
           биш бол НӨГӨӨ нь автоматаар `auto` болдог — өөрөөр хэлбэл дан
           `overflow-y-auto` нь хөндлөн гүйлгэлтийг ЧИМЭЭГҮЙ НЭЭДЭГ.  Урт
           нэртэй баг эсвэл таслагдахгүй урт үг ороход маягт хажуу тийшээ
           гүйдэг байсан.  Доорх засварууд агуулгыг мөр таслуулж багтаадаг
           тул энэ нь таслах биш, зөвхөн хамгаалалт. */
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6">
          {restorable && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
              <span className="flex-1">{t('asr.draftFound')}</span>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (localDraft) {
                    latest.current = localDraft;
                    // ⚠️ `dirty` ЗААВАЛ.  Үүнгүйгээр autosave-ийн effect эхний
                    //    мөрөндөө таарч буцдаг тул сэргээсэн агуулга серверт
                    //    ХЭЗЭЭ Ч бичигддэггүй байв: дэлгэц дүүрэн бөглөсөн
                    //    маягт харагдаж байхад сервер дээр хоосон ноорог
                    //    хэвээр үлдэж, «Илгээх» нь ойлгомжгүй 400 иддэг.
                    dirty.current = true;
                    setForm(localDraft);
                  }
                  setRestorable(false);
                }}
              >
                {t('asr.draftRestore')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  clear();
                  setRestorable(false);
                }}
              >
                {t('asr.draftDiscard')}
              </Button>
            </div>
          )}

          {/* ⚠️ Уншихад л зориулсан мэдэгдэл нь ЗӨВХӨН үнэхээр цоожтой хүнд.
            Админд «засах боломжгүй» гэж хэлээд дор нь «Засварлах» товч
            харуулах нь шууд зөрчил тул `needsUnlock` тохиолдлыг эндээс
            хасна — түүнийг доорх цоож тайлах хавтан хариуцна. */}
          {readOnly && !needsUnlock && (
            <div className="mb-4 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              {entry.status === 'approved' ? t('asr.readOnlyApproved') : t('asr.readOnlySubmitted')}
            </div>
          )}

          {/* Батлагдсан тайлангийн цоож — админ ЗОРИУДААР тайлна. */}
          {needsUnlock && !unlocked && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1">{t('asr.adminUnlockHint')}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setUnlocked(true)}
              >
                <Pencil className="h-3.5 w-3.5" /> {t('asr.adminUnlock')}
              </Button>
            </div>
          )}

          {/* Илгээгдсэн / батлагдсан тайланг засаж байна — дараагийн алхмыг нь хэлнэ. */}
          {editingLocked && (
            <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
              {adminEditing
                ? entry.status === 'approved'
                  ? t('asr.adminEditNoticeApproved')
                  : t('asr.adminEditNotice')
                : entry.status === 'approved'
                  ? t('asr.authorEditNoticeApproved')
                  : t('asr.authorEditNotice')}
            </div>
          )}

          <AsrEditor
            entry={entry}
            form={form}
            onChange={onChange}
            teamOptions={teamOptions}
            readOnly={readOnly}
            projectInfo={entry.project_info ?? liveProjectInfo}
            // Улаан дэвтэр: зохиогч/админ ДУРЫН төлөвт хавсаргана (серверийн
            // `PATCH /:id/red-book` gate-ийн тусгал) — `editable`-ийн
            // хөлдөлтөөс ГАДУУР.
            canAttachRedBook={isAdmin || entry.author_id === currentUserId}
            canReview={canReview}
            onServerChanged={onChanged}
            ensureSaved={ensureSaved}
            onCreated={onCreated}
            projectLabel={projectLabel}
            projectContractNo={projectContractNo}
            // «Талбайн хяналт» РУУ шилжих эрх — `PATCH /:id`-ийн серверийн
            // дүрмийн ихэр (0362): админ, эсвэл ХАБ-ын баталгаатай тайлан
            // (хадгалагдсан нь `has_safety_ack`, хадгалаагүй нь `safety_ack_id`),
            // эсвэл аль хэдийн талбайн хяналт.
            canPickSite={
              isAdmin ||
              reportTypeOf(entry) === 'site' ||
              !!entry.has_safety_ack ||
              entry.safety_ack_id != null
            }
          />
        </div>
      )}

      {/* Наалдмал үйлдлийн мөр.  Sheet portal нь z-50, MobileBottomNav нь
          z-40 тул давхцахгүй; safe-area padding нь iPhone-ийн доод
          заагаас дээш байлгана. */}
      <div className="shrink-0 space-y-2 border-t bg-background px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          {savePill && mode === 'edit' && (
            // `min-w-0` + `truncate`: «Хадгалахад алдаа гарлаа» гэх мэт урт
            // мессеж нь flex-ийн `min-width:auto` өгөгдмөлөөс болж мөрийг
            // тэлж, доод мөрийг хажуу тийш түлхдэг байсан.
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              {saveState === 'saving' && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
              <span className="truncate">{savePill}</span>
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {canDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 text-danger"
                disabled={busy}
                onClick={doDelete}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            {/* ⚠️ Хэвлэх ба PDF хоёулаа СЕРВЕР дээрх мөрөөс рендэрлэгддэг тул
                хадгалаагүй тайланд утгагүй (хэвлэх хуудас 404, PDF хоосон).
                Хэрэглэгч «Хадгалах» дарангуут хоёулаа гарч ирнэ. */}
            {persisted && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    window.open(`/app/projects/${projectId}/asr/${entry.id}/print`, '_blank')
                  }
                >
                  <Printer className="h-4 w-4" /> {t('asr.print')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={pdfBusy || busy}
                  onClick={doPdf}
                >
                  {pdfBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {t('asr.pdf')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={docxBusy || busy}
                  onClick={doDocx}
                >
                  {docxBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                  {t('asr.docx')}
                </Button>
                <SigningLinkButton
                  kind="asr"
                  entityId={entry.id}
                  buttonLabel="Гарын үсгийн link"
                  options={[
                    {
                      slot: 'arch',
                      // Оффис уулзалтад эхний мөр «Манай тал» (эзэн 2026-10-08).
                      label: usesMeetingForm(reportTypeOf(entry)) ? 'Манай тал' : 'Хяналт хийсэн / зохиогч',
                      roleLabel: usesMeetingForm(reportTypeOf(entry)) ? 'Манай тал' : 'Хяналт хийсэн / зохиогч',
                      signerNameHint: entry.sig_arch_name,
                      disabled: Boolean(entry.sig_arch_url),
                    },
                    {
                      slot: 'site',
                      label: usesMeetingForm(reportTypeOf(entry)) ? 'Захиалагч тал' : 'Талбайн инженер',
                      roleLabel: usesMeetingForm(reportTypeOf(entry)) ? 'Захиалагч тал' : 'Талбайн инженер',
                      signerNameHint: entry.sig_site_name,
                      disabled: Boolean(entry.sig_site_url),
                    },
                  ]}
                />
              </>
            )}
          </div>
        </div>

        {/* Дутуу талбарууд — БӨГЛӨЖ БАЙХ ҮЕД харагдана, илгээх гэж оролдсоны
            дараа биш.  Товчийг `disabled` болгохгүй: утсан дээр идэвхгүй
            товч ямар ч хариу өгдөггүй тул хэрэглэгч яагаад болохгүй байгааг
            ойлгохгүй — жагсаалт нь шалтгааныг нь ил хэлнэ. */}
        {editable && missingShown.length > 0 && (mode === 'edit' || canSubmit) && (
          <p className="text-xs text-muted-foreground">
            {missingShown.join(' · ')}
            {submitRedBookGap && (
              <Button
                type="button"
                variant="link"
                className="ml-2 h-auto p-0 text-xs font-medium pointer-coarse:h-auto has-[>svg]:px-0"
                onClick={goToRedBook}
              >
                {t('asr.redBook')} ↓
              </Button>
            )}
          </p>
        )}

        {/* «Баримт» горимд хадгалах юм байхгүй — зөвхөн «Илгээх» (баримтаа
            харчихаад шууд илгээх нь байгалийн урсгал). */}
        {mode === 'view' && canSubmit && (
          <Button type="button" className="w-full gap-2" disabled={busy} onClick={doSubmit}>
            <Send className="h-4 w-4" /> {t('asr.submit')}
          </Button>
        )}

        {editable && mode === 'edit' && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={() => {
                failures.current = 0; // гараар дарсан = дахин оролдох
                void save();
              }}
            >
              {/* Илгээгдсэн тайланг «Ноорог хадгалах» гэж нэрлэвэл админ
                  түүнийг ноорог болгож байна гэж ойлгоно — тэгэхгүй. */}
              {canSubmit ? t('asr.saveDraft') : t('common.save')}
            </Button>
            {/* «Илгээх» нь ЗӨВХӨН ноорог/буцаагдсан дээр.  Илгээгдсэнийг
                дахин илгээх нь 409, батлагдсаныг илгээх нь утгагүй. */}
            {canSubmit && (
              <Button type="button" className="flex-1 gap-2" disabled={busy} onClick={doSubmit}>
                <Send className="h-4 w-4" /> {t('asr.submit')}
              </Button>
            )}
          </div>
        )}

        {canReview && entry.status === 'submitted' && approveRedBookGap && (
          <p className="text-xs text-danger">{t('asr.validationRedBookApprove')}</p>
        )}
        {canReview && entry.status === 'submitted' && (
          <AsrReviewBar busy={busy} onApprove={doApprove} onReject={doReject} />
        )}
      </div>
    </>
  );
}
