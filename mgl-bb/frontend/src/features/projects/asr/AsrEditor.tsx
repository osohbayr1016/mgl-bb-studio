import { RotateCcw } from 'lucide-react';
import { mediaUrl } from '@/shared/api/client';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { AsrDocPhotos } from './AsrDocPhotos';
import {
  DocBand,
  DocBlock,
  DocCell,
  DocCheck,
  DocChecks,
  DocGrid,
  DocInput,
  DocLabel,
  DocLogo,
  DocPaper,
  DocText,
  DocValue,
} from './AsrDocKit';
import { AsrCompanionsSection } from './AsrCompanionsSection';
import { AsrMeetingParticipants, AsrMeetingSignerPicker } from './AsrMeetingParticipants';
import { useMeetingParticipantOptions } from './useMeetingParticipantOptions';
import { AsrMeetingRequests } from './AsrMeetingRequests';
import { AsrInlineImages } from './AsrInlineImages';
import { AsrRecorder } from './AsrRecorder';
import { AsrRedBookSection } from './AsrRedBookSection';
import { AsrSignatureBlock } from './AsrSignatureBlock';
import { AsrWorkReportSection } from './AsrWorkReportSection';
import { AsrRedBookBadge, AsrStatusBadge } from './AsrStatusBadge';
import { asrProjectName } from './asrProjectName';
import {
  ASR_DOC_TITLE_EN,
  asrHeaderDocNo,
  headerDate,
  templateTeamLabel,
} from './asrTemplate';
import { MEETING_LABEL, emptyMeetingDoc, ourPartyEntries } from './meetingDoc';
import { asrInfoRows, pairInfoRows } from './projectInfo';
import {
  ASR_DOC_KINDS,
  ASR_MEETING_PLATFORMS,
  ASR_REPORT_TYPES,
  DOC_KIND_KEY,
  REPORT_TYPE_KEY,
  isAsrPersisted,
  redBookStatusOf,
  reportTypeOf,
  usesMeetingForm,
  type AsrDocKind,
  type AsrProjectInfo,
  type AsrFormState,
  type AsrReport,
  type AsrTeamOption,
} from './types';

/**
 * Тайлангийн засварлагч — «БАРИМТ» горим (эзний хүсэлт 2026-09-25).
 *
 * Засварлагч нь хэвлэгдэх Word/PDF баримттай (`AsrDocument.tsx`) ИЖИЛ
 * хэлбэртэй хуудас: маягтын хүснэгт → Ажлын тайлан → Хяналт хийсэн (гарын
 * үсэг) → Улаан дэвтэр → Хавсралт зургийн хуудсууд.  Инженер нүдэн дээр
 * дарж шууд бөглөнө; зургийн хоосон нүд дээр дарахад зураг яг тэр нүдэнд
 * орно.  Урьдын «маягт» горим (талбар бүр тусдаа карт) бүрмөсөн СОЛИГДСОН —
 * эзэн утсан дээр ч зөвхөн баримт горимыг сонгосон, харин утсанд тохирсон:
 * 640px-ээс доош хүснэгтийн багана нэг багана болж эвхэгдэнэ (`AsrDocKit`).
 *
 * Хэсгүүдийн дараалал = хэвлэх баримтынх.  Хэвлэлтэд ОРДОГГҮЙ хэрэгслүүд
 * (төлөв, дуу бичлэг) цаасны ГАДНА, дээр нь.
 *
 * Энэ компонент нь контейнерээ мэдэхгүй: десктоп Dialog, утасны Sheet
 * хоёр ижил props объектыг дамжуулна (MailInboxPage-ийн хэв маяг).
 */

/**
 * Объект эсвэл updater хоёуланг хүлээж авна.  Updater хэлбэр нь зэрэг
 * дуусаж буй зургийн байршуулалтад зайлшгүй — тэдгээр нь бие биенийхээ
 * үр дүнг дарах ёсгүй.
 */
export type AsrChange = (
  patch: Partial<AsrFormState> | ((prev: AsrFormState) => Partial<AsrFormState>),
) => void;

export interface AsrEditorProps {
  entry: AsrReport;
  form: AsrFormState;
  onChange: AsrChange;
  teamOptions: AsrTeamOption[];
  readOnly: boolean;
  /**
   * Төслийн товч танилцуулга.  Өгөөгүй бол `entry.project_info` (сервер тал
   * хөлдсөн эсвэл амьд утгыг нэгтгэсэн).  ⚠️ ХАДГАЛААГҮЙ ноорог дээр сервер
   * түүнийг мэдэхгүй тул `AsrEditorShell` нь `GET /projects/:id`-аас гаргаж
   * дамжуулна.
   */
  projectInfo?: AsrProjectInfo | null;
  /** `true` бол танилцуулга илгээх үед хөлдсөн — доор ил тэмдэглэнэ. */
  projectInfoFrozen?: boolean;
  /**
   * Улаан дэвтэр (0279).  `readOnly`-оос ТУСДАА эрх: зураг нь тайлангийн
   * хөлдөлтөөс гадуур, баталгаажуулалт нь `can_review`-ийн үйлдэл.
   * `onServerChanged` нь дэлгэрэнгүйг дахин татуулна (autosave-аар явдаггүй).
   */
  canAttachRedBook?: boolean;
  canReview?: boolean;
  onServerChanged?: (id: number) => void;
  /** Хадгалаагүй тайланг үүсгэнэ — улаан дэвтрийг анх үүсгэхдээ ч оруулна (2026-09-30). */
  ensureSaved?: () => Promise<number | null>;
  /** Улаан дэвтрээр шинээр үүссэн тайлан — засварлагчийг бодит мөр рүү шилжүүлнэ. */
  onCreated?: (id: number) => void;
  /** ЗХ-д засварласан төслийн нэр (`projects.asr_name`, 0358) — «Төслийн нэр» нүдэнд. */
  projectLabel?: string | null;
  /**
   * Төслийн ЗХ-ийн гэрээний дугаар (`projects.asr_contract_no`, 0365) —
   * «Гэрээний дугаар» нүдний «авто» утга.  `entry.project_contract_no` нь
   * зөвхөн ХАДГАЛАГДСАН тайлан дээр ирдэг тул «Шинэ тайлан» дарсан агшинд
   * `AsrEditorShell` төслийн дэлгэрэнгүйгээс гаргаж дамжуулна (шифрийн
   * `info.drawingNo`-той ижил шалтгаан).
   */
  projectContractNo?: string | null;
  /**
   * «Талбайн хяналт» төрөл РҮҮ шилжүүлж болох эсэх (0362) — ХАБ-ын баталгаа
   * холбогдсон, эсвэл админ.  `PATCH /:id`-ийн серверийн дүрмийн ихэр
   * (`AsrEditorShell` бодно).  Өгөөгүй бол зөвшөөрнө.
   */
  canPickSite?: boolean;
}

export function AsrEditor({
  entry,
  form,
  onChange,
  teamOptions,
  readOnly,
  projectInfo,
  projectInfoFrozen,
  canAttachRedBook = false,
  canReview = false,
  onServerChanged,
  ensureSaved,
  onCreated,
  projectLabel,
  projectContractNo: projectContractNoProp,
  canPickSite = true,
}: AsrEditorProps) {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const redBookStatus = redBookStatusOf(entry);

  const info = projectInfo ?? entry.project_info ?? null;
  /** Doc. No.-ийн PROJECT-ID-ийн эх — төслийн өөрийн нэр. */
  const codeName = asrProjectName(info?.shortName?.trim() || info?.title?.trim() || '');
  /** Маягтын «Төслийн нэр» ба зургийн тэмдгийн төслийн нэр — ЗХ-д засварласан нэр (0358) түрүүлнэ. */
  const projectName = projectLabel?.trim() || codeName;

  /*
   * Төслийн паспортын шифр — маягтын «авто» утга.
   *
   * ⚠️ ХОЁР эх сурвалж, гэхдээ хоёулаа ЯГ нэг багана (`project_passport.
   *    drawing_no`): серверийн `shapeRow`-ийн `passport_shifr`, ба төслийн
   *    танилцуулгын `drawingNo`.  Сүүлийнх ЗААВАЛ хэрэгтэй — сервер
   *    `passport_shifr`-ыг зөвхөн ХАДГАЛАГДСАН тайлан дээр буцаадаг тул
   *    «Шинэ тайлан» дарсан агшинд тэр талбар хоосон ирнэ.
   */
  const passportShifr = entry.passport_shifr?.trim() || info?.drawingNo?.trim() || null;
  /** Талбар хоосон + паспорт утгатай = одоо паспортыг дагаж байна. */
  const autoShifr = !form.shifr.trim() && !!passportShifr;

  /*
   * Гэрээний дугаар — шифртэй ИЖИЛ: төслийн дугаарыг ХАРАГДАХ утгаар дүүргэнэ,
   * харин `form.contract_no` ХООСОН хэвээр (хэрэглэгч бичсэн агшинд л
   * override болно).  Төслийн амьд утга (prop) хадгалагдсан хуулбараас ШИНЭ.
   */
  const projectContractNo =
    projectContractNoProp?.trim() || entry.project_contract_no?.trim() || null;
  const autoContractNo = !(form.contract_no ?? '').trim() && !!projectContractNo;

  /**
   * Зургийн автомат тэмдэг (огноо + төсөл) — маягтын АМЬД утгаас: огноо
   * засагдмагц тэмдэг дагаж өөрчлөгдөнө (`taken_at`-гүй хуучин зурагт).
   */
  const photoStampCtx = {
    reportDate: form.report_date,
    shifr: form.shifr.trim() || passportShifr,
    projectName,
    seq: entry.seq,
  };

  // Хоосон утгатай мөрийг `asrInfoRows` өөрөө хаядаг.  «Албан ёсны нэр» ба
  // «Байршил» тэнд БАЙХГҮЙ (эзэн 2026-09-28, хэвлэлтийн ижил дүрэм).
  const infoRows = asrInfoRows(info);
  const pairedInfo = pairInfoRows(infoRows);

  /** Тайлангийн төрөл (0362) — хуучин локал ноорогт байхгүй бол тайлангийнх. */
  const reportType = form.report_type ?? reportTypeOf(entry);
  /**
   * Оффис уулзалтын маягт (0367, эзэн 2026-09-30): Тайлбар / Бичиг баримтын
   * төрлийн оронд уулзалтын мэдээлэл, «Оролцсон» (бүх ажилтнаас), «Уулзалтын
   * агуулга», «Захиалагч тал», улаан дэвтэргүй, ганц том зураг.  Нуусан
   * талбаруудын өгөгдөл УСТАХГҮЙ — төрлөө буцаахад гарч ирнэ.
   */
  const meeting = usesMeetingForm(reportType);
  /**
   * «Оролцогч тал»-ын манай талын мөрүүд — «Оролцсон» (хадгалаагүй сонголт ч)
   * хүмүүсээс АМЬДААР (эзэн 2026-10-12).  Хадгалагдахгүй; хэвлэлт/Word ижил
   * дүрмээр (`meetingPartiesText`).  Нэр дэвшигчдийн query-г
   * `AsrMeetingParticipants`-тай хуваалцана (react-query давхар татахгүй).
   */
  const { participants: meetingPeople } = useMeetingParticipantOptions(
    entry,
    form,
    meeting && !readOnly,
  );
  const ourParties = meeting
    ? ourPartyEntries(meetingPeople, form.meeting_doc?.party_lines)
    : [];
  /**
   * Мөрийг гараар засна (эзэн 2026-10-12) — автомат мөртэй ижил/хоосон болговол
   * засвар арилж автомат руу буцна.  Хүнийг «Оролцсон»-оос хасахад засвар нь
   * хадгалагдсан ч харагдахгүй (оролцогч биш хүн мөр гаргахгүй).
   */
  const setPartyLine = (id: number, auto: string, text: string | null) =>
    onChange((prev) => {
      const doc = prev.meeting_doc ?? emptyMeetingDoc();
      const lines = { ...doc.party_lines };
      if (text == null || !text.trim() || text.trim() === auto) delete lines[String(id)];
      else lines[String(id)] = text;
      return { meeting_doc: { ...doc, party_lines: lines } };
    });
  const setMeetingDoc = (patch: Partial<ReturnType<typeof emptyMeetingDoc>>) =>
    onChange((prev) => ({ meeting_doc: { ...(prev.meeting_doc ?? emptyMeetingDoc()), ...patch } }));

  const toggleDocKind = (k: AsrDocKind) =>
    onChange((prev) => ({
      doc_types: prev.doc_types.includes(k)
        ? prev.doc_types.filter((x) => x !== k)
        : [...prev.doc_types, k],
    }));

  // Чагтыг салгахад «Ажлын тайлан» текстийг УСТГАХГҮЙ — мис-тап нь бичсэн
  // зүйлийг үрэгдүүлэх ёсгүй.  Зөвхөн сонголтын жагсаалтаас гарна; сервер
  // рүү ч зөвхөн сонгосон багуудын текст явна.
  const toggleTeam = (id: number) =>
    onChange((prev) => ({
      selected_team_ids: prev.selected_team_ids.includes(id)
        ? prev.selected_team_ids.filter((x) => x !== id)
        : [...prev.selected_team_ids, id],
    }));

  const selectedTeams = teamOptions.filter((o) => form.selected_team_ids.includes(o.id));
  const teamLabel = (o: AsrTeamOption) => (lang === 'en' ? o.name_en || o.name_mn : o.name_mn);

  /** Багийн чагтууд — маягт ба «Ажлын тайлан» хоёуланд ИЖИЛ сонголт. */
  const teamChecks = (
    <DocChecks>
      {teamOptions.map((o) => (
        <DocCheck
          key={o.id}
          on={form.selected_team_ids.includes(o.id)}
          disabled={readOnly}
          onToggle={() => toggleTeam(o.id)}
        >
          <span title={teamLabel(o)}>{templateTeamLabel(o.code)}</span>
        </DocCheck>
      ))}
    </DocChecks>
  );

  /**
   * Транскриптийг текст талбарт НЭМНЭ, дарж бичихгүй.  Инженер хэдэн ч
   * удаа ярьж бичүүлж болох ба өмнөх бичсэн зүйл нь алдагдах ёсгүй.
   */
  const appendDescription = (text: string) =>
    onChange((prev) =>
      // Оффис уулзалтад «Тайлбар» харагдахгүй — транскрипт «Уулзалтын агуулга»-д.
      meeting
        ? { work_report: prev.work_report ? `${prev.work_report}\n\n${text}` : text }
        : { description: prev.description ? `${prev.description}\n\n${text}` : text },
    );

  const frozen = projectInfoFrozen ?? entry.project_info_frozen;

  return (
    <div className="space-y-3">
      {/* ── Цаасны ГАДНА: төлөв, зохиогч, буцаасан шалтгаан (хэвлэгдэхгүй) ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <AsrStatusBadge status={entry.status} />
        {/* Улаан дэвтрийн төлөв тайлангийн төлөвөөс ТУСДАА.  Оффис уулзалтад
            улаан дэвтэр огт хамаагүй (0367). */}
        {!meeting && <AsrRedBookBadge status={redBookStatus} />}
        {entry.author_name && (
          <span className="min-w-0 break-words text-xs text-muted-foreground">
            {t('asr.author')}: {entry.author_name}
          </span>
        )}
        {infoRows.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('asr.projectInfo')}: {frozen ? t('asr.projectInfoFrozen') : t('asr.projectInfoLive')}
          </span>
        )}
      </div>
      {entry.status === 'rejected' && entry.review_note && (
        <div className="break-words rounded-md border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
          <span className="font-medium">{t('asr.rejectNote')}:</span> {entry.review_note}
        </div>
      )}

      {/* Дуу бичлэг — баримтад ХЭВЛЭГДЭХГҮЙ хэрэгсэл, цаасны гадна.
          ⚠️ ХАДГАЛААГҮЙ тайланд байхгүй: бичлэг нь `report_id`-аар серверт
          байршдаг тул id үүсэхээс өмнө байршуулах газар байхгүй. */}
      {isAsrPersisted(entry) && (
        <section id="asr-sec-audio" className="scroll-mt-4 rounded-lg border p-3">
          {/* Тайлбарыг `AsrRecorder` өөрөө харуулдаг — энд давхардуулахгүй. */}
          <h3 className="mb-2 text-sm font-semibold">{t('asr.recordings')}</h3>
          <AsrRecorder
            reportId={entry.id}
            initial={entry.recordings}
            readOnly={readOnly}
            onAppendDescription={appendDescription}
            appendLabel={meeting ? MEETING_LABEL.content : undefined}
          />
        </section>
      )}

      {/* ── ЦААС: хэвлэгдэх баримтын яг хэлбэр ── */}
      <div className="-mx-4 bg-muted/60 py-3 sm:-mx-6 sm:px-6 sm:py-6">
        <DocPaper>
          {/* Толгой — хэвлэлтийн running толгой (Word загварын header1.xml):
              гарчиг / Report Date / Doc. No. + лого.  Утга нь маягтын АМЬД
              утгаас (огноо, төслийн ID, эхний сонгосон баг) — хэвлэхэд ч ижил. */}
          <div className="mb-3 flex items-start justify-between gap-4 border-b border-foreground/70 pb-2">
            <div className="min-w-0 text-sm leading-snug">
              <div className="font-bold">{ASR_DOC_TITLE_EN}</div>
              <div className="tabular-nums">Report Date: {headerDate(form.report_date)}</div>
              <div className="truncate">
                Doc. No.:{' '}
                {asrHeaderDocNo(
                  {
                    seq: entry.seq,
                    doc_no: entry.doc_no,
                    // Сонгосон ДАРААЛЛААР — сервер `sort_order`-ийг үүгээр
                    // хадгалдаг тул хэвлэлтийн «эхний баг»-тай ижил.
                    // Оффис уулзалтад баг серверт тодорхойлогдоно — маягтад
                    // сонголт байхгүй тул хадгалагдсан тайлангийнхаар.
                    teams:
                      form.selected_team_ids.length > 0
                        ? form.selected_team_ids.flatMap((id) => {
                            const o = teamOptions.find((x) => x.id === id);
                            return o ? [{ team_code: o.code }] : [];
                          })
                        : (entry.teams ?? []),
                  },
                  codeName,
                )}
              </div>
            </div>
            <DocLogo />
          </div>

          {/* ── МАЯГТЫН ХҮСНЭГТ ── */}
          <DocGrid>
            {/* Мөрийн дараалал = хэвлэх баримтын маягт (Word загварын 12 баганат
                хүснэгт, 2026-09-28): Төслийн нэр | Он сар өдөр → төслийн
                мэдээлэл → Шифр | Гэрээний дугаар → Тайлбар | Бичиг баримтын
                төрөл → Хяналтаар явсан → Шалгасан | Баталсан.
                «Тайлангийн №» мөр байхгүй — дугаар толгойн Doc. No.-д.  Утсанд
                (640px-ээс доош) нэг багана болж эвхэгдэнэ. */}
            <DocLabel mn="Төслийн нэр" />
            <DocCell>
              <DocValue strong>{projectName || '—'}</DocValue>
            </DocCell>
            <DocLabel mn="Он сар өдөр" />
            <DocCell>
              <DocInput
                type="date"
                aria-label={t('asr.reportDate')}
                value={form.report_date}
                readOnly={readOnly}
                onChange={(e) => onChange({ report_date: e.target.value })}
              />
            </DocCell>

            {/* Хяналтын төрөл (0362) — нэг тайлан ЯГ НЭГ төрөл (radio шиг).
                «Талбайн хяналт» руу шилжих нь ХАБ-ын баталгаа шаардана —
                баталгаагүй тайланд тэр сонголт хаалттай (серверийн ихэр). */}
            <DocLabel mn="Хяналтын төрөл" />
            <DocCell span={3}>
              <DocChecks>
                {ASR_REPORT_TYPES.map((k) => (
                  <DocCheck
                    key={k}
                    on={reportType === k}
                    disabled={readOnly || (k === 'site' && reportType !== 'site' && !canPickSite)}
                    onToggle={() => {
                      if (k !== reportType) onChange({ report_type: k });
                    }}
                  >
                    {t(REPORT_TYPE_KEY[k])}
                  </DocCheck>
                ))}
              </DocChecks>
              {!readOnly && reportType !== 'site' && !canPickSite && (
                <p className="px-3 pb-2 text-micro text-muted-foreground">
                  {t('asr.type.siteLocked')}
                </p>
              )}
            </DocCell>
            {reportType === 'online' && (
              <>
                <DocLabel mn="Платформ" />
                <DocCell span={3}>
                  <DocInput
                    aria-label={t('asr.type.platform')}
                    placeholder={t('asr.type.platformPlaceholder')}
                    value={form.meeting_platform ?? ''}
                    readOnly={readOnly}
                    maxLength={100}
                    onChange={(e) => onChange({ meeting_platform: e.target.value })}
                  />
                  {!readOnly && (
                    <DocChecks>
                      {ASR_MEETING_PLATFORMS.map((p) => (
                        <DocCheck
                          key={p}
                          on={(form.meeting_platform ?? '').trim() === p}
                          onToggle={() => onChange({ meeting_platform: p })}
                        >
                          {p}
                        </DocCheck>
                      ))}
                    </DocChecks>
                  )}
                </DocCell>
              </>
            )}

            {/* Төслийн мэдээлэл — зөвхөн УНШИНА (эх сурвалж нь паспорт). */}
            {pairedInfo.map((row) => (
              <InfoRow key={row.left.label} row={row} />
            ))}

            <DocLabel mn="Шифр" />
            <DocCell>
              {/*
                «Шифр» — ХҮЧИНГҮЙЛЭГЧ талбар.  Хоосон бол тайлан төслийн паспортыг
                ШУУД дагана (илгээх мөчид `allocateAndSubmit` хөлдөөнө).

                ⚠️ Паспортын шифрийг placeholder БИШ, ХАРАГДАХ утгаар дүүргэнэ
                   (эзний шийдвэр 2026-09-08), харин `form.shifr` ХООСОН хэвээр —
                   хэрэглэгч бичсэн агшинд л override болно.
              */}
              <div className="flex items-center">
                <DocInput
                  aria-label={t('asr.shifr')}
                  value={form.shifr || (passportShifr ?? '')}
                  readOnly={readOnly}
                  placeholder={passportShifr ?? ''}
                  title={autoShifr ? t('asr.shifrAutoHint') : undefined}
                  onChange={(e) => onChange({ shifr: e.target.value })}
                />
                {autoShifr && (
                  <span
                    title={t('asr.shifrAutoHint')}
                    className="mr-2 shrink-0 rounded-full bg-muted px-2 py-0.5 text-label normal-case tracking-normal text-muted-foreground"
                  >
                    {t('asr.shifrAuto')}
                  </span>
                )}
              </div>
            </DocCell>
            {/* Гэрээний дугаар (0363/0365) — Шифрийн мөрөнд.  Хоосон бол тайлан
                төслийн ЗХ-ийн гэрээний дугаарыг дагана (ЗХ хуудсанд төсөл нэмэх /
                нэр засах цонхонд бичсэн); бичвэл зөвхөн ЭНЭ тайланд override.
                Хэвлэлтийн ихэр мөр `AsrDocument.tsx`. */}
            <DocLabel mn="Гэрээний дугаар" />
            <DocCell>
              <div className="flex items-center">
                <DocInput
                  aria-label={t('asr.contractNo')}
                  value={form.contract_no || (projectContractNo ?? '')}
                  readOnly={readOnly}
                  maxLength={200}
                  placeholder={projectContractNo ?? ''}
                  title={autoContractNo ? t('asr.contractNoAutoHint') : undefined}
                  onChange={(e) => onChange({ contract_no: e.target.value })}
                />
                {autoContractNo && (
                  <span
                    title={t('asr.contractNoAutoHint')}
                    className="mr-2 shrink-0 rounded-full bg-muted px-2 py-0.5 text-label normal-case tracking-normal text-muted-foreground"
                  >
                    {t('asr.contractNoAuto')}
                  </span>
                )}
              </div>
            </DocCell>
            {meeting ? (
              /* Оффис уулзалтын мэдээлэл (0367) — эзний Word уулзалтын
                 тэмдэглэлийн хүснэгт.  «Өдөр» нь дээрх «Он сар өдөр».
                 Хэвлэлтийн ихэр `AsrDocument.tsx`, Word `buildAsrDocx.ts`. */
              <>
                <DocLabel mn={MEETING_LABEL.place} />
                <DocCell>
                  <DocInput
                    aria-label={MEETING_LABEL.place}
                    placeholder={t('asr.meeting.placePlaceholder')}
                    value={form.meeting_place ?? ''}
                    readOnly={readOnly}
                    maxLength={300}
                    onChange={(e) => onChange({ meeting_place: e.target.value })}
                  />
                </DocCell>
                <DocLabel mn={MEETING_LABEL.time} />
                <DocCell>
                  <div className="flex items-center">
                    <DocInput
                      type="time"
                      aria-label={t('asr.meeting.timeStart')}
                      value={form.meeting_start ?? ''}
                      readOnly={readOnly}
                      onChange={(e) => onChange({ meeting_start: e.target.value })}
                    />
                    <span aria-hidden className="text-muted-foreground">
                      –
                    </span>
                    <DocInput
                      type="time"
                      aria-label={t('asr.meeting.timeEnd')}
                      value={form.meeting_end ?? ''}
                      readOnly={readOnly}
                      onChange={(e) => onChange({ meeting_end: e.target.value })}
                    />
                  </div>
                </DocCell>
                <DocLabel mn={MEETING_LABEL.parties} />
                <DocCell span={3}>
                  {ourParties.length > 0 && (
                    <ul
                      aria-label={t('asr.meeting.ourPartiesAuto')}
                      title={t('asr.meeting.ourPartiesAutoHint')}
                      className="pt-1"
                    >
                      {ourParties.map((p) => (
                        <li key={p.id} className="flex items-center">
                          <DocInput
                            aria-label={t('asr.meeting.ourPartyLine')}
                            value={
                              form.meeting_doc?.party_lines?.[String(p.id)] ?? p.text
                            }
                            readOnly={readOnly}
                            maxLength={500}
                            className="py-1"
                            onChange={(e) => setPartyLine(p.id, p.auto, e.target.value)}
                          />
                          {p.edited && !readOnly ? (
                            <button
                              type="button"
                              title={t('asr.meeting.ourPartyReset')}
                              aria-label={t('asr.meeting.ourPartyReset')}
                              onClick={() => setPartyLine(p.id, p.auto, null)}
                              className="mr-2 shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <RotateCcw className="size-3.5" />
                            </button>
                          ) : (
                            !p.edited && (
                              <span className="mr-2 shrink-0 rounded-full bg-muted px-2 py-0.5 text-label normal-case tracking-normal text-muted-foreground">
                                {t('asr.meeting.ourPartiesAuto')}
                              </span>
                            )
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <DocText
                    rows={ourParties.length > 0 ? 2 : 3}
                    aria-label={MEETING_LABEL.parties}
                    placeholder={t('asr.meeting.partiesPlaceholder')}
                    value={form.meeting_parties ?? ''}
                    readOnly={readOnly}
                    aiPolish={false}
                    onChange={(e) => onChange({ meeting_parties: e.target.value })}
                  />
                </DocCell>
                <DocLabel mn={MEETING_LABEL.purpose} />
                <DocCell span={3}>
                  <DocText
                    rows={2}
                    aria-label={MEETING_LABEL.purpose}
                    placeholder={t('asr.meeting.purposePlaceholder')}
                    value={form.meeting_purpose ?? ''}
                    readOnly={readOnly}
                    onChange={(e) => onChange({ meeting_purpose: e.target.value })}
                  />
                </DocCell>
              </>
            ) : (
              <>
                {/* Налуу тайлбар нь зөвхөн засварлагчид — хэвлэлт/Word-д ОРОХГҮЙ. */}
                <DocLabel mn="Тайлбар" hint="Тухайн үед угсралтын ямар ажил хийгдсэн" />
                <DocCell>
                  <DocText
                    rows={2}
                    aria-label={t('asr.description')}
                    placeholder={t('asr.descriptionPlaceholder')}
                    value={form.description}
                    readOnly={readOnly}
                    onChange={(e) => onChange({ description: e.target.value })}
                  />
                </DocCell>
                {/* Тайлбарын мөрөнд — хэвлэлтэд хоёулаа ижил өндөртэй. */}
                <DocLabel mn="Бичиг баримтын төрөл" />
                <DocCell>
                  <DocChecks>
                    {ASR_DOC_KINDS.map((k) => (
                      <DocCheck
                        key={k}
                        on={form.doc_types.includes(k)}
                        disabled={readOnly}
                        onToggle={() => toggleDocKind(k)}
                      >
                        {t(DOC_KIND_KEY[k])}
                      </DocCheck>
                    ))}
                  </DocChecks>
                  {form.doc_types.includes('other') && (
                    <DocInput
                      className="border-t border-foreground/15"
                      placeholder={t('asr.docKindOtherPlaceholder')}
                      value={form.doc_type_other}
                      readOnly={readOnly}
                      onChange={(e) => onChange({ doc_type_other: e.target.value })}
                    />
                  )}
                </DocCell>
              </>
            )}

            {meeting ? (
              /* «Хяналтаар явсан»-ы оронд — уулзалтад оролцсон ажилтнууд, БҮХ
                 ажилтнаас сонгоно (0367).  Багийн чагт «Уулзалтын агуулга»-ийн
                 толгойд хэвээр (дугаарлалт, батлалт багаар явдаг). */
              <>
                <DocLabel mn={MEETING_LABEL.participants} />
                <DocCell span={3}>
                  <AsrMeetingParticipants
                    entry={entry}
                    form={form}
                    onChange={onChange}
                    readOnly={readOnly}
                  />
                </DocCell>
              </>
            ) : (
              <>
                <DocLabel mn="Хяналтаар явсан" />
                <DocCell span={3}>{teamChecks}</DocCell>
              </>
            )}

            {/* «Шалгасан | Баталсан» — оффис уулзалтад БАЙХГҮЙ (эзэн 2026-10-08):
                уулзалтын тэмдэглэлийг хоёр тал гарын үсгээр баталгаажуулна.
                Өгөгдөл (`checked_by_*`) устахгүй — төрөл буцаахад гарч ирнэ. */}
            {!meeting && (
              <>
                <DocLabel mn="Шалгасан" />
                <DocCell>
                  <DocInput
                    aria-label={t('asr.checkedBy')}
                    placeholder={t('asr.sigName')}
                    value={form.checked_by_name}
                    readOnly={readOnly}
                    onChange={(e) => onChange({ checked_by_name: e.target.value })}
                  />
                  <DocInput
                    className="border-t border-foreground/15"
                    placeholder={t('asr.checkedTitle')}
                    value={form.checked_by_title}
                    readOnly={readOnly}
                    onChange={(e) => onChange({ checked_by_title: e.target.value })}
                  />
                  {entry.checked_by_signature_url && (
                    <img
                      src={mediaUrl(entry.checked_by_signature_url)}
                      alt=""
                      className="mx-3 mb-2 max-h-12 max-w-[60%] object-contain"
                    />
                  )}
                </DocCell>
                <DocLabel mn="Баталсан" />
                <DocCell>
                  <DocValue>
                    {entry.status === 'approved' && entry.reviewer_name ? (
                      entry.reviewer_name
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </DocValue>
                </DocCell>
              </>
            )}
          </DocGrid>

          {/* ── ХАМТ ЯВСАН — өөрийн багаас 3–4 хүн, хүн бүрийн улаан дэвтэр (0351).
              Оффис уулзалтад БАЙХГҮЙ — оролцогчид маягтын «Оролцсон» мөрөнд. ── */}
          {!meeting && (
            <DocBlock id="asr-sec-companions">
              <DocBand mn={t('asr.companions')} en="Team members on site" />
              <div className="space-y-2 p-3">
                <p className="text-xs text-muted-foreground">{t('asr.companionsHint')}</p>
                <AsrCompanionsSection
                  entry={entry}
                  form={form}
                  onChange={onChange}
                  readOnly={readOnly}
                  currentUserId={user?.id ?? null}
                  isAdmin={user?.role === 'admin'}
                  canReview={canReview}
                  onServerChanged={onServerChanged}
                />
              </div>
            </DocBlock>
          )}

          {/* ── АЖЛЫН ТАЙЛАН — оффис уулзалтад «Уулзалтын агуулга»: асуултгүй,
              ганц бичих талбай (`work_report`, эзэн 2026-09-30). ── */}
          {meeting ? (
            <DocBlock id="asr-sec-work">
              <DocBand mn={MEETING_LABEL.content} en={MEETING_LABEL.contentEn} />
              {/* Багийн чагт оффис уулзалтад БАЙХГҮЙ (эзэн 2026-10-08) — баг нь зохиогч +
                  «Оролцсон» хүмүүсээс серверт автоматаар (`fillMeetingTeams`).
                  0396 — эхэнд «0.1 Захиалагч / 0.2 Гүйцэтгэгч» хүснэгтүүд, доор нь
                  чөлөөт тэмдэглэл (`work_report`). */}
              <AsrMeetingRequests form={form} onChange={onChange} readOnly={readOnly} />
              <div className="border-t border-foreground/15 px-3 pt-2 text-xs font-semibold text-muted-foreground">
                {t('asr.meeting.notesHead')}
              </div>
              <DocText
                rows={8}
                aria-label={MEETING_LABEL.content}
                placeholder={t('asr.meeting.contentPlaceholder')}
                value={form.work_report}
                readOnly={readOnly}
                className="min-h-48"
                onChange={(e) => onChange({ work_report: e.target.value })}
              />
              {/* «Тайлбар»-ын ард зураг (эзэн 2026-10-12) — `meeting_doc.note_images`. */}
              <AsrInlineImages
                images={form.meeting_doc?.note_images ?? []}
                readOnly={readOnly}
                label={t('asr.meeting.notesHead')}
                onChange={(fn) =>
                  onChange((prev) => {
                    const doc = prev.meeting_doc ?? emptyMeetingDoc();
                    return { meeting_doc: { ...doc, note_images: fn(doc.note_images ?? []) } };
                  })
                }
              />
            </DocBlock>
          ) : (
            <AsrWorkReportSection
              entry={entry}
              form={form}
              onChange={onChange}
              readOnly={readOnly}
              selectedTeams={selectedTeams}
              teamLabel={teamLabel}
              teamStrip={teamChecks}
            />
          )}

          {/* ── ХЯНАЛТ ХИЙСЭН (гарын үсэг) ── */}
          <AsrSignatureBlock
            readOnly={readOnly}
            savedUrl={user?.signature_url ?? null}
            arch={{
              name: form.sig_arch_name,
              url: form.sig_arch_url,
              date: form.sig_arch_date || form.report_date,
            }}
            site={{
              name: form.sig_site_name,
              url: form.sig_site_url,
              date: form.sig_site_date || form.report_date,
            }}
            onArchChange={(v) =>
              onChange({ sig_arch_name: v.name, sig_arch_url: v.url, sig_arch_date: v.date })
            }
            onSiteChange={(v) =>
              onChange({ sig_site_name: v.name, sig_site_url: v.url, sig_site_date: v.date })
            }
            siteRole={meeting ? MEETING_LABEL.clientSide : undefined}
            band={meeting ? MEETING_LABEL.signBand : undefined}
            archRole={meeting ? MEETING_LABEL.ourSide : undefined}
            archNameTitle={meeting ? MEETING_LABEL.signHeadName : undefined}
            archNameSlot={
              meeting ? (
                <AsrMeetingSignerPicker
                  entry={entry}
                  form={form}
                  onChange={onChange}
                  readOnly={readOnly}
                />
              ) : undefined
            }
          />
          {/* Захиалагч талын төлөөлөгчийн байгууллага, албан тушаал (0398) — хэвлэлтийн
              хөлийн «… Талаас төлөөлж гарын үсэг зурсан» хэсэгт; нэр нь дээрх
              «Захиалагч тал»-ын нэр (`sig_site_name`). */}
          {meeting && (
            <DocGrid className="mt-2">
              <DocLabel mn={t('asr.meeting.clientOrg')} />
              <DocCell>
                <DocInput
                  aria-label={t('asr.meeting.clientOrg')}
                  placeholder={t('asr.meeting.clientOrgPlaceholder')}
                  value={form.meeting_doc?.client_org ?? ''}
                  readOnly={readOnly}
                  maxLength={500}
                  onChange={(e) => setMeetingDoc({ client_org: e.target.value })}
                />
              </DocCell>
              <DocLabel mn={t('asr.meeting.clientPosition')} />
              <DocCell>
                <DocInput
                  aria-label={t('asr.meeting.clientPosition')}
                  placeholder={t('asr.meeting.clientPositionPlaceholder')}
                  value={form.meeting_doc?.client_position ?? ''}
                  readOnly={readOnly}
                  maxLength={500}
                  onChange={(e) => setMeetingDoc({ client_position: e.target.value })}
                />
              </DocCell>
            </DocGrid>
          )}

          {/* ── УЛААН ДЭВТЭР ──  ⚠️ `readOnly` дамжуулахгүй — өөрийн эрхийн
              дүрэмтэй (тайлангийн хөлдөлтөөс гадуур), компонентын тайлбарыг үз.
              Оффис уулзалтад огт БАЙХГҮЙ (эзэн 2026-09-30, 0367). */}
          {!meeting && (
            <DocBlock id="asr-sec-redbook">
              <DocBand mn={t('asr.redBook')} en="Red book" />
              <div className="space-y-2 p-3">
                <p className="text-xs text-muted-foreground">{t('asr.redBookHint')}</p>
                <AsrRedBookSection
                  entry={entry}
                  reportType={reportType}
                  canAttach={canAttachRedBook}
                  canReview={canReview}
                  onChanged={(id) => onServerChanged?.(id)}
                  ensureSaved={ensureSaved}
                  onCreated={onCreated}
                />
              </div>
            </DocBlock>
          )}

          {/* ── ХАВСРАЛТ ЗУРАГ: хуудас бүрт 2×2, хоосон нүд дээр дарж оруулна ── */}
          <AsrDocPhotos
            photos={form.photos}
            readOnly={readOnly}
            stamp={photoStampCtx}
            projectName={projectName}
            single={meeting}
            onChange={(updater) => onChange((prev) => ({ photos: updater(prev.photos) }))}
          />
        </DocPaper>
      </div>
    </div>
  );
}

/** Төслийн мэдээллийн нэг мөр — богино утга хосоороо, урт нь бүтэн өргөнөөр. */
function InfoRow({ row }: { row: ReturnType<typeof pairInfoRows>[number] }) {
  if (row.full || !row.right) {
    return (
      <>
        <DocLabel mn={row.left.label} />
        <DocCell span={3}>
          <DocValue>{row.left.value}</DocValue>
        </DocCell>
      </>
    );
  }
  return (
    <>
      <DocLabel mn={row.left.label} />
      <DocCell>
        <DocValue>{row.left.value}</DocValue>
      </DocCell>
      <DocLabel mn={row.right.label} />
      <DocCell>
        <DocValue>{row.right.value}</DocValue>
      </DocCell>
    </>
  );
}
