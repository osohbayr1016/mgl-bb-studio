import type { AuReportAnswers } from '@/features/projects/team-reports/au/types';
import { type DocMode } from '@/features/projects/team-reports/docHelpers';
import { useDrawingRows } from '@/features/projects/team-reports/drawingList';
import { T } from '@/features/performance-reports/lib/reportText';

/* =============================================================
 * АУ report printable document. Empty values render as "_____"
 * in internal mode and vanish in client mode (see ../docHelpers).
 * -------------------------------------------------------------
 * A4 ХУУДАСЛАЛТ (`data-a4-item`)
 * -------------------------------------------------------------
 * Гүйцэтгэлийн тайлангийн `A4Paginator` нь `[data-a4-item]`-ээр
 * тэмдэглэсэн элементийг хуудасны заагт унавал дараагийн хуудас руу
 * түлхдэг.  Тэмдэглэгээгүй агуулга цаасны ирмэгийг давж хуудас
 * хоорондын цоорхойд бичигдэнэ — тиймээс энд:
 *   • гарчиг + түүнийг дагасан ХЯЗГААРЛАГДМАЛ жагсаалт = НЭГ нэгж
 *     (гарчиг ганцаараа хуудасны ёроолд үлдэхээс сэргийлнэ),
 *   • чөлөөт текст (answers-ийн narrative) бүр ТУСДАА нэгж,
 *   • зургийн жагсаалт админы нэмсэн мөрөөр УРТСАХ боломжтой
 *     (`team_drawing_items`) тул мөр бүр ТУСДАА нэгж — бүхэлд нь нэг
 *     нэгж болговол нэг A4-ээс урт үед түлхэлт огт ажиллахгүй.
 * ⚠️ ҮҮРЛЭСЭН `data-a4-item` хийхгүй: paginator зөвхөн гаднахыг тооцно.
 *
 * СТАТИК ТЕКСТ (`<T>`)
 * -------------------------------------------------------------
 * Хатуу бичигдсэн шошго/гарчгийг `<T k="au.…">`-ээр боов —
 * гүйцэтгэлийн тайлангийн засварлах горимд хэрэглэгч өөрчилнө.
 * Provider байхгүй үед (Багийн тайлангийн таб) энгийн текст рүү
 * уначих тул тэнд харагдац ЯГ ХЭВЭЭР.
 * ============================================================= */

const BMS_PROTOCOL_LABEL: Record<string, string> = {
  bacnet: 'BACnet',
  modbus: 'Modbus',
  knx: 'KNX',
  mixed: 'холимог протокол',
};


const DRAWING_LIST_ROWS: Array<{ no: number; key: keyof AuReportAnswers; label: string }> = [
  { no: 1, key: 'dl_cover', label: 'Нүүр хуудас' },
  { no: 2, key: 'dl_drawing_list', label: 'Зургийн жагсаалт' },
  { no: 3, key: 'dl_explanatory_note', label: 'Тайлбар бичиг' },
  { no: 4, key: 'dl_bms_architecture', label: 'BMS системийн архитектур' },
  { no: 5, key: 'dl_bms_io_list', label: 'Мэдрэгч, удирдлагын I/O жагсаалт' },
  { no: 6, key: 'dl_home_auto', label: 'Home автоматжуулалтын зураг' },
  { no: 7, key: 'dl_integration_diagram', label: 'Системүүдийн уялдааны схем' },
  { no: 8, key: 'dl_monitoring_room', label: 'Хяналтын өрөөний зураг' },
  { no: 9, key: 'dl_equipment_schedule', label: 'Тоног төхөөрөмжийн жагсаалт' },
  { no: 10, key: 'dl_details', label: 'Деталь, зангилаа' },
];

interface AuReportDocumentProps {
  answers: AuReportAnswers;
  mode?: DocMode;
}

export function AuReportDocument({ answers, mode = 'internal' }: AuReportDocumentProps) {
  const blank = mode === 'client' ? '' : '_____';
  const drawingRows = useDrawingRows('AU', DRAWING_LIST_ROWS);
  const answerOf = answers as Record<string, unknown>;
  return (
    <article className="au-doc">
      <div data-a4-item>
        <h1 className="au-doc__title">
          <T k="au.h.title">ТАЙЛБАР БИЧИГ</T>
        </h1>
        <p className="au-doc__subtitle">
          <T k="au.h.subtitle">БАРИЛГЫН ИНЖЕНЕРИЙН СИСТЕМИЙН АВТОМАТЖУУЛАЛТ</T>
        </p>
      </div>

      {(answers.input_from_has ||
        answers.input_from_cbu ||
        answers.input_from_tsah ||
        answers.input_from_hd ||
        answers.input_from_client) && (
        <div className="au-doc__grp" data-a4-item>
          <Heading>
            <T k="au.h.inputs">БУСАД БАГУУДААС ЗУРАГ ТӨСӨЛ ЗОХИОГЧИЙН ДААЛГАВАР</T>
          </Heading>
          <Para>
            <T k="au.txt.inputs_lead" as="strong">
              Дараах багуудаас зураг төсөл зохиогчийн даалгавар хүлээн авсан:
            </T>
          </Para>
          <ul className="au-doc__list">
            {answers.input_from_has && (
              <li>
                <T k="au.txt.input_has">HAS (Халаалт, агаар сэлгэлт).</T>
              </li>
            )}
            {answers.input_from_cbu && (
              <li>
                <T k="au.txt.input_cbu">ЦБУ (Цэвэр бохир ус).</T>
              </li>
            )}
            {answers.input_from_tsah && (
              <li>
                <T k="au.txt.input_tsah">ЦАХ (Цахилгаан).</T>
              </li>
            )}
            {answers.input_from_hd && (
              <li>
                <T k="au.txt.input_hd">ХД (Холбоо дохиолол).</T>
              </li>
            )}
            {answers.input_from_client && (
              <li>
                <T k="au.txt.input_client">Захиалагчийн тусгай даалгавар.</T>
              </li>
            )}
          </ul>
        </div>
      )}
      {answers.input_pending_text && (
        <Para item>
          <T k="au.lbl.pending" as="strong">
            Хүлээгдэж буй:
          </T>{' '}
          {answers.input_pending_text}
        </Para>
      )}

      {(answers.bms_present ||
        answers.bms_monitors_hvac ||
        answers.bms_monitors_lighting ||
        answers.bms_narrative) && (
        <>
          <div className="au-doc__grp" data-a4-item>
            <Heading>
              <T k="au.h.bms">БАРИЛГЫН УДИРДЛАГЫН СИСТЕМ (BMS)</T>
            </Heading>
            <ul className="au-doc__list">
              {answers.bms_present && answers.bms_protocol && (
                <li>
                  <T k="au.lbl.bms_protocol_prefix">BMS систем</T>{' '}
                  <strong>{BMS_PROTOCOL_LABEL[answers.bms_protocol] ?? blank}</strong>
                  <T k="au.lbl.bms_protocol_suffix">-оор хийгдсэн.</T>
                </li>
              )}
              {answers.bms_monitors_hvac && (
                <li>
                  <T k="au.txt.bms_hvac">Халаалт, агаар сэлгэлтийг хянадаг.</T>
                </li>
              )}
              {answers.bms_monitors_lighting && (
                <li>
                  <T k="au.txt.bms_lighting">Гэрэлтүүлгийг хянадаг.</T>
                </li>
              )}
              {answers.bms_monitors_water && (
                <li>
                  <T k="au.txt.bms_water">Усан хангамж, насосыг хянадаг.</T>
                </li>
              )}
              {answers.bms_monitors_power && (
                <li>
                  <T k="au.txt.bms_power">Цахилгаан хангамжийг хянадаг.</T>
                </li>
              )}
              {answers.bms_monitors_smoke && (
                <li>
                  <T k="au.txt.bms_smoke">Утаа сорогт системийг хянадаг.</T>
                </li>
              )}
              {answers.bms_monitors_access && (
                <li>
                  <T k="au.txt.bms_access">Нэвтрэх хяналтыг хянадаг.</T>
                </li>
              )}
              {answers.bms_scheduling && (
                <li>
                  <T k="au.txt.bms_scheduling">Цаг хуваарийн систем.</T>
                </li>
              )}
              {answers.bms_alarms && (
                <li>
                  <T k="au.txt.bms_alarms">Алармын систем (имэйл / SMS мэдээ).</T>
                </li>
              )}
            </ul>
          </div>
          {answers.bms_narrative && <Para item>{answers.bms_narrative}</Para>}
        </>
      )}

      {answers.home_auto_present && (
        <>
          <div className="au-doc__grp" data-a4-item>
            <Heading>
              <T k="au.h.home_auto">HOME АВТОМАТЖУУЛАЛТ (АЙЛ БҮРД)</T>
            </Heading>
            <Para>
              <T k="au.txt.home_auto_lead">
                Орон сууцны айл бүрд home автоматжуулалтын систем төлөвлөв.
              </T>
            </Para>
            <ul className="au-doc__list">
              {answers.home_auto_lighting && (
                <li>
                  <T k="au.txt.home_lighting">Гэрэлтүүлгийн удирдлага.</T>
                </li>
              )}
              {answers.home_auto_climate && (
                <li>
                  <T k="au.txt.home_climate">Халаалт, хөргөлтийн удирдлага.</T>
                </li>
              )}
              {answers.home_auto_security && (
                <li>
                  <T k="au.txt.home_security">Аюулгүй байдлын удирдлага.</T>
                </li>
              )}
              {answers.home_auto_window_blinds && (
                <li>
                  <T k="au.txt.home_blinds">Цонхны хөшгийн (хатгуурт) удирдлага.</T>
                </li>
              )}
              {answers.home_auto_app_control && (
                <li>
                  <T k="au.txt.home_app">Утасны аппликейшнаар удирдах боломжтой.</T>
                </li>
              )}
              {answers.home_auto_voice_control && (
                <li>
                  <T k="au.txt.home_voice">Дуун удирдлага (Alexa / Google).</T>
                </li>
              )}
            </ul>
          </div>
          {answers.home_auto_narrative && <Para item>{answers.home_auto_narrative}</Para>}
        </>
      )}

      {(answers.integ_security_cctv ||
        answers.integ_lighting_motion ||
        answers.integ_narrative) && (
        <>
          <div className="au-doc__grp" data-a4-item>
            <Heading>
              <T k="au.h.integration">СИСТЕМҮҮДИЙН УЯЛДАА ХОЛБОО</T>
            </Heading>
            <ul className="au-doc__list">
              {answers.integ_security_cctv && (
                <li>
                  <T k="au.txt.integ_cctv">Нэвтрэх ⇒ CCTV-д үйл явдал бичигдэнэ.</T>
                </li>
              )}
              {answers.integ_lighting_motion && (
                <li>
                  <T k="au.txt.integ_motion">Хөдөлгөөн мэдрэгч ⇒ гэрэлтүүлэг асах.</T>
                </li>
              )}
            </ul>
          </div>
          {answers.integ_narrative && <Para item>{answers.integ_narrative}</Para>}
        </>
      )}

      {drawingRows.some((r) => answerOf[r.key] === true) && (
        <>
          <Heading item>
            <T k="au.h.drawing_list">АУ-ИЙН ЗУРГИЙН ЖАГСААЛТ</T>
          </Heading>
          <ul className="au-doc__list">
            {drawingRows.filter((r) => answerOf[r.key] === true).map((r) => (
              <li key={r.key} data-a4-item>
                {r.no}. {r.label}
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

/** `item` — A4 хуудаслалтын бие даасан нэгж болгоно (бүлэг ДОТОР хэрэггүй,
 *  учир нь үүрлэсэн `data-a4-item`-ийг paginator хаядаг). */
function Heading({ children, item }: { children: React.ReactNode; item?: boolean }) {
  if (item) {
    return (
      <h2 className="au-doc__heading" data-a4-item>
        {children}
      </h2>
    );
  }
  return <h2 className="au-doc__heading">{children}</h2>;
}

function Para({ children, item }: { children: React.ReactNode; item?: boolean }) {
  if (item) {
    return (
      <p className="au-doc__para" data-a4-item>
        {children}
      </p>
    );
  }
  return <p className="au-doc__para">{children}</p>;
}

export const AU_REPORT_STYLES = `
.au-doc { font-family: "Arial", Helvetica, sans-serif; color: #111; line-height: 1.55; max-width: 760px; margin: 0 auto; padding: 0 16px; }
.au-doc__title { text-align: center; font-size: 18pt; font-weight: 700; margin: 0; letter-spacing: 0.06em; }
.au-doc__subtitle { text-align: center; font-size: 11pt; font-weight: 600; margin: 4px 0 18px; letter-spacing: 0.04em; color: #444; }
.au-doc__meta { margin-bottom: 18px; }
.au-doc__meta-row { font-size: 11pt; margin: 2px 0; }
.au-doc__meta-label { font-weight: 600; }
.au-doc__heading { font-size: 12pt; font-weight: 700; text-transform: uppercase; margin: 18px 0 6px; letter-spacing: 0.04em; border-bottom: 1px solid #999; padding-bottom: 3px; }
/* A4 хуудаслалтын БҮЛЭГ (.au-doc__grp[data-a4-item]) — гарчгийн дээд
 * зайг БҮЛЭГ нь ӨӨРТӨӨ авна.  Эс бөгөөс эцэг↔хүүхдийн margin
 * collapsing үүсэж A4Paginator-ийн getComputedStyle(el).marginTop
 * 0 уншигдана; тэгвэл түлхэлт 18px-ээр ДУТАЖ хэрэгжиж, бүлэг цаасны
 * дээд захын маск дор орж таслагдана.  Дэлгэц дээрх зай хуучинтай
 * ЯГ ИЖИЛ (18px) тул Багийн тайлангийн таб хөндөгдөхгүй. */
.au-doc__grp { margin-top: 18px; }
.au-doc__grp > .au-doc__heading { margin-top: 0; }
.au-doc__para { font-size: 11pt; margin: 6px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
.au-doc__list { font-size: 11pt; margin: 6px 0 6px 18px; padding: 0; }
/* Үргэлжилсэн бичвэр — хоёр талаар тэгшилнэ.  «text-align-last: left» нь
 * сүүлийн мөрийг сунгахгүй.  Монгол бичвэрт «hyphens» ТАВИХГҮЙ — үг
 * таслах дүрэм байхгүй тул буруу таслана. */
.au-doc__list li { margin: 2px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
/* ЗАЛГАА тодорхойлолтын мөрүүдийн хооронд харагдахуйц зай.  Дэлгэц ба
 * хэвлэл хоёуланд үйлчилнэ («+» тул эхний мөрөнд зай нэмэгдэхгүй). */
.au-doc__list li + li { margin-top: 0.5em; }
.au-doc__signatures { margin-top: 32px; font-size: 11pt; }
.au-doc__sig-row { display: flex; gap: 24px; margin-top: 18px; flex-wrap: wrap; }
.au-doc__sig-cell { flex: 1; min-width: 200px; }
.au-doc__sig-role { font-weight: 600; margin-bottom: 24px; }
.au-doc__sig-line { border-bottom: 1px solid #444; padding-bottom: 2px; min-height: 22px; }
.au-doc__sig-meta { font-size: 10pt; color: #555; margin-top: 4px; }
@media print {
  .au-doc { max-width: none; padding: 0; }
  .au-doc__heading { break-after: avoid; }
  .au-doc__para, .au-doc__list { break-inside: avoid-page; }
}
`;
