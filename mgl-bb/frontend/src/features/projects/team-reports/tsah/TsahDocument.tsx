import type { TsahReportAnswers } from '@/features/projects/team-reports/tsah/types';
import { makeDocHelpers, type DocMode } from '@/features/projects/team-reports/docHelpers';
import { useDrawingRows } from '@/features/projects/team-reports/drawingList';
import { T } from '@/features/performance-reports/lib/reportText';

/* =============================================================
 * ЦАХ report printable document.  Same conditional-section
 * pattern as the other disciplines. Empty values render as
 * "_____" in internal mode and vanish in client mode (see
 * ../docHelpers).
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
 * Хатуу бичигдсэн шошго/гарчгийг `<T k="tsah.…">`-ээр боов —
 * гүйцэтгэлийн тайлангийн засварлах горимд хэрэглэгч өөрчилнө.
 * Provider байхгүй үед (Багийн тайлангийн таб) энгийн текст рүү
 * уначих тул тэнд харагдац ЯГ ХЭВЭЭР.
 * ============================================================= */

const LIGHTNING_CLASS_LABEL: Record<string, string> = {
  I: 'I (онцгой эрсдэлтэй)',
  II: 'II (өндөр эрсдэл)',
  III: 'III (хэвийн)',
  IV: 'IV (бууруулсан)',
};


const DRAWING_LIST_ROWS: Array<{ no: number; key: keyof TsahReportAnswers; label: string }> = [
  { no: 1, key: 'dl_cover', label: 'Нүүр хуудас' },
  { no: 2, key: 'dl_drawing_list', label: 'Зургийн жагсаалт' },
  { no: 3, key: 'dl_explanatory_note', label: 'Тайлбар бичиг' },
  { no: 4, key: 'dl_single_line', label: 'Нэг шугамын схем' },
  { no: 5, key: 'dl_power_plan', label: 'Цахилгаан хангамжийн төлөвлөгөө' },
  { no: 6, key: 'dl_lighting_plan', label: 'Гэрэлтүүлгийн төлөвлөгөө' },
  { no: 7, key: 'dl_outlet_plan', label: 'Розеткын төлөвлөгөө' },
  { no: 8, key: 'dl_emergency_lighting', label: 'Авагдаах гэрэлтүүлэг' },
  { no: 9, key: 'dl_grounding_plan', label: 'Газардуулгын төлөвлөгөө' },
  { no: 10, key: 'dl_lightning_plan', label: 'Аянгаас хамгаалах' },
  { no: 11, key: 'dl_ev_charging', label: 'EV цэнэглэгчийн төлөвлөгөө' },
  { no: 12, key: 'dl_equipment_schedule', label: 'Тоног төхөөрөмжийн жагсаалт' },
  { no: 13, key: 'dl_cable_schedule', label: 'Кабелийн жагсаалт' },
  { no: 14, key: 'dl_details', label: 'Деталь, зангилаа' },
];

interface TsahReportDocumentProps {
  answers: TsahReportAnswers;
  mode?: DocMode;
}

export function TsahReportDocument({ answers, mode = 'internal' }: TsahReportDocumentProps) {
  const { v, withSuffix } = makeDocHelpers(mode);
  const blank = mode === 'client' ? '' : '_____';
  const drawingRows = useDrawingRows('TSAH', DRAWING_LIST_ROWS);
  const answerOf = answers as Record<string, unknown>;
  return (
    <article className="tsah-doc">
      <div data-a4-item>
        <h1 className="tsah-doc__title">
          <T k="tsah.h.title">ТАЙЛБАР БИЧИГ</T>
        </h1>
        <p className="tsah-doc__subtitle">
          <T k="tsah.h.subtitle">ЦАХИЛГААН ХАНГАМЖ, ДОТООД ЦАХИЛГААН</T>
        </p>
      </div>

      {(answers.source_substation ||
        answers.source_voltage_primary ||
        answers.source_load_total ||
        answers.source_narrative) && (
        <>
          <div className="tsah-doc__grp" data-a4-item>
            <Heading>
              <T k="tsah.h.source">ЦАХИЛГААН ХАНГАМЖИЙН ЭХ ҮҮСВЭР</T>
            </Heading>
            {answers.source_substation && <Para>{answers.source_substation}</Para>}
            <ul className="tsah-doc__list">
              {(answers.source_voltage_primary || answers.source_voltage_secondary) && (
                <li>
                  <T k="tsah.lbl.voltage">Хүчдэл:</T>{' '}
                  <strong>{withSuffix(answers.source_voltage_primary, 'кВ')}</strong>
                  {answers.source_voltage_secondary && (
                    <>
                      {' '}
                      / <strong>{withSuffix(answers.source_voltage_secondary, 'кВ')}</strong>
                    </>
                  )}
                  .
                </li>
              )}
              {answers.source_feed_count && (
                <li>
                  <T k="tsah.lbl.feed_count">Гадна тэжээлийн шугам:</T>{' '}
                  <strong>{withSuffix(answers.source_feed_count, 'ширхэг')}</strong>.
                </li>
              )}
              {answers.source_load_total && (
                <li>
                  <T k="tsah.lbl.load_total">Нийт суурилагдсан ачаалал:</T>{' '}
                  <strong>{withSuffix(answers.source_load_total, 'кВт')}</strong>
                  {answers.source_load_calculated && (
                    <>
                      <T k="tsah.lbl.load_calculated">, тооцооны ачаалал</T>{' '}
                      <strong>{withSuffix(answers.source_load_calculated, 'кВт')}</strong>
                    </>
                  )}
                  .
                </li>
              )}
              {answers.source_power_factor && (
                <li>
                  <T k="tsah.lbl.power_factor">Чадлын коэффициент cosφ =</T>{' '}
                  <strong>{answers.source_power_factor}</strong>.
                </li>
              )}
            </ul>
          </div>
          {answers.source_narrative && <Para item>{answers.source_narrative}</Para>}
        </>
      )}

      {(answers.reliability_class_1_present ||
        answers.reliability_class_2_present ||
        answers.reliability_class_3_present) && (
        <div className="tsah-doc__grp" data-a4-item>
          <Heading>
            <T k="tsah.h.reliability">ЦАХИЛГААН ХЭРЭГЛЭГЧИЙН НАЙДВАРЛАГЫН АНГИ</T>
          </Heading>
          {answers.reliability_class_1_present && (
            <Para>
              <T k="tsah.lbl.class1" as="strong">
                I анги (онцгой) хэрэглэгчид:
              </T>{' '}
              {v(answers.reliability_class_1_items)}
            </Para>
          )}
          {answers.reliability_class_2_present && (
            <Para>
              <T k="tsah.lbl.class2" as="strong">
                II анги (хэвийн) хэрэглэгчид:
              </T>{' '}
              {v(answers.reliability_class_2_items)}
            </Para>
          )}
          {answers.reliability_class_3_present && (
            <Para>
              <T k="tsah.txt.class3">III анги (бууруулсан) хэрэглэгчтэй.</T>
            </Para>
          )}
        </div>
      )}

      {(answers.distrib_main_panel_location ||
        answers.distrib_separate_residential ||
        answers.distrib_metering_per_apt) && (
        <div className="tsah-doc__grp" data-a4-item>
          <Heading>
            <T k="tsah.h.distrib">ЦАХИЛГААН ХУВААРИЛАЛТ, ТООЛУУР</T>
          </Heading>
          <ul className="tsah-doc__list">
            {answers.distrib_main_panel_location && (
              <li>
                <T k="tsah.lbl.main_panel">Гол хуваарилах самбарын байрлал:</T>{' '}
                <strong>{answers.distrib_main_panel_location}</strong>.
              </li>
            )}
            {answers.distrib_separate_residential && (
              <li>
                <T k="tsah.txt.sep_residential">
                  Орон сууцанд тусдаа ОХС (өөрчлөн хуваарилах самбар).
                </T>
              </li>
            )}
            {answers.distrib_separate_service && (
              <li>
                <T k="tsah.txt.sep_service">Үйлчилгээний хэсэгт тусдаа ОХС.</T>
              </li>
            )}
            {answers.distrib_separate_parking && (
              <li>
                <T k="tsah.txt.sep_parking">Зогсоолд тусдаа ОХС.</T>
              </li>
            )}
            {answers.distrib_metering_per_zone && (
              <li>
                <T k="tsah.txt.meter_zone">Бүсчилсэн тоолуур.</T>
              </li>
            )}
            {answers.distrib_metering_per_apt && (
              <li>
                <T k="tsah.txt.meter_apt">Айл бүрд цахилгааны тоолуур.</T>
              </li>
            )}
            {answers.distrib_high_rise_riser && (
              <li>
                <T k="tsah.txt.riser">Өндөр давхарт тусдаа босоо шугам төлөвлөв.</T>
              </li>
            )}
          </ul>
        </div>
      )}

      {(answers.lighting_interior_led ||
        answers.lighting_emergency_3h ||
        answers.lighting_exterior ||
        answers.lighting_lux_levels_text) && (
        <>
          <div className="tsah-doc__grp" data-a4-item>
            <Heading>
              <T k="tsah.h.lighting">ГЭРЭЛТҮҮЛЭГ</T>
            </Heading>
            <ul className="tsah-doc__list">
              {answers.lighting_interior_led && (
                <li>
                  <T k="tsah.txt.led">Дотор LED гэрэлтүүлэг.</T>
                </li>
              )}
              {answers.lighting_emergency_3h && (
                <li>
                  <T k="tsah.txt.emergency">3 цагийн нөөцтэй авагдаах гэрэлтүүлэг.</T>
                </li>
              )}
              {answers.lighting_exterior && (
                <li>
                  <T k="tsah.txt.exterior">Гадна гэрэлтүүлэг.</T>
                </li>
              )}
              {answers.lighting_facade && (
                <li>
                  <T k="tsah.txt.facade">Фасадны архитектур гэрэлтүүлэг.</T>
                </li>
              )}
              {answers.lighting_motion_sensor && (
                <li>
                  <T k="tsah.txt.motion">Зогсоол, хонгилд хөдөлгөөн мэдрэгчтэй.</T>
                </li>
              )}
              {answers.lighting_dali_control && (
                <li>
                  <T k="tsah.txt.dali">DALI хяналтын систем.</T>
                </li>
              )}
            </ul>
          </div>
          {answers.lighting_lux_levels_text && <Para item>{answers.lighting_lux_levels_text}</Para>}
        </>
      )}

      {(answers.grounding_tn_s_system ||
        answers.grounding_main_loop ||
        answers.lightning_terminal_present ||
        answers.grounding_narrative) && (
        <>
          <div className="tsah-doc__grp" data-a4-item>
            <Heading>
              <T k="tsah.h.grounding">ГАЗАРДУУЛГА, АЯНГАНААС ХАМГААЛАХ</T>
            </Heading>
            <ul className="tsah-doc__list">
              {answers.grounding_tn_s_system && (
                <li>
                  <T k="tsah.txt.tns">TN-S газардуулгын систем.</T>
                </li>
              )}
              {answers.grounding_main_loop && (
                <li>
                  <T k="tsah.txt.main_loop">Үндсэн газардуулгын контур.</T>
                </li>
              )}
              {answers.lightning_terminal_present && (
                <li>
                  <T k="tsah.txt.lightning_terminal">Аянганы шонт төлөвлөв</T>
                  {answers.lightning_class && (
                    <>
                      <T k="tsah.lbl.lightning_std">, IEC 62305-ын</T>{' '}
                      <strong>{LIGHTNING_CLASS_LABEL[answers.lightning_class] ?? blank}</strong>{' '}
                      <T k="tsah.lbl.lightning_class_suffix">ангид</T>
                    </>
                  )}
                  .
                </li>
              )}
            </ul>
          </div>
          {answers.grounding_narrative && <Para item>{answers.grounding_narrative}</Para>}
        </>
      )}

      {(answers.ev_chargers_count ||
        answers.smart_metering_present ||
        answers.special_narrative) && (
        <>
          <div className="tsah-doc__grp" data-a4-item>
            <Heading>
              <T k="tsah.h.special">ЦАХИЛГААН МАШИНЫ ЦЭНЭГЛЭГЧ, ТУСГАЙ АЧААЛАЛ</T>
            </Heading>
            <ul className="tsah-doc__list">
              {answers.ev_chargers_count && (
                <li>
                  <T k="tsah.lbl.ev_count">EV цэнэглэгч:</T>{' '}
                  <strong>{withSuffix(answers.ev_chargers_count, 'ширхэг')}</strong>
                  {answers.ev_chargers_kw && (
                    <>
                      <T k="tsah.lbl.ev_each">, тус бүр</T>{' '}
                      <strong>{withSuffix(answers.ev_chargers_kw, 'кВт')}</strong>
                    </>
                  )}
                  {answers.ev_chargers_location && (
                    <>
                      <T k="tsah.lbl.ev_location">, байрлал:</T> {answers.ev_chargers_location}
                    </>
                  )}
                  .
                </li>
              )}
              {answers.smart_metering_present && (
                <li>
                  <T k="tsah.txt.smart_metering">Ухаалаг тоолуур.</T>
                </li>
              )}
            </ul>
          </div>
          {answers.special_narrative && <Para item>{answers.special_narrative}</Para>}
        </>
      )}

      {drawingRows.some((r) => answerOf[r.key] === true) && (
        <>
          <Heading item>
            <T k="tsah.h.drawing_list">ЦАХИЛГААНЫ ЗУРГИЙН ЖАГСААЛТ</T>
          </Heading>
          <ul className="tsah-doc__list">
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
      <h2 className="tsah-doc__heading" data-a4-item>
        {children}
      </h2>
    );
  }
  return <h2 className="tsah-doc__heading">{children}</h2>;
}

function Para({ children, item }: { children: React.ReactNode; item?: boolean }) {
  if (item) {
    return (
      <p className="tsah-doc__para" data-a4-item>
        {children}
      </p>
    );
  }
  return <p className="tsah-doc__para">{children}</p>;
}

export const TSAH_REPORT_STYLES = `
.tsah-doc { font-family: "Arial", Helvetica, sans-serif; color: #111; line-height: 1.55; max-width: 760px; margin: 0 auto; padding: 0 16px; }
.tsah-doc__title { text-align: center; font-size: 18pt; font-weight: 700; margin: 0; letter-spacing: 0.06em; }
.tsah-doc__subtitle { text-align: center; font-size: 12pt; font-weight: 600; margin: 4px 0 18px; letter-spacing: 0.06em; color: #444; }
.tsah-doc__meta { margin-bottom: 18px; }
.tsah-doc__meta-row { font-size: 11pt; margin: 2px 0; }
.tsah-doc__meta-label { font-weight: 600; }
.tsah-doc__heading { font-size: 12pt; font-weight: 700; text-transform: uppercase; margin: 18px 0 6px; letter-spacing: 0.04em; border-bottom: 1px solid #999; padding-bottom: 3px; }
/* A4 хуудаслалтын БҮЛЭГ (.tsah-doc__grp[data-a4-item]) — гарчгийн дээд
 * зайг БҮЛЭГ нь ӨӨРТӨӨ авна.  Эс бөгөөс эцэг↔хүүхдийн margin
 * collapsing үүсэж A4Paginator-ийн getComputedStyle(el).marginTop
 * 0 уншигдана; тэгвэл түлхэлт 18px-ээр ДУТАЖ хэрэгжиж, бүлэг цаасны
 * дээд захын маск дор орж таслагдана.  Дэлгэц дээрх зай хуучинтай
 * ЯГ ИЖИЛ (18px) тул Багийн тайлангийн таб хөндөгдөхгүй. */
.tsah-doc__grp { margin-top: 18px; }
.tsah-doc__grp > .tsah-doc__heading { margin-top: 0; }
.tsah-doc__para { font-size: 11pt; margin: 6px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
.tsah-doc__list { font-size: 11pt; margin: 6px 0 6px 18px; padding: 0; }
/* Үргэлжилсэн бичвэр — хоёр талаар тэгшилнэ.  «text-align-last: left» нь
 * сүүлийн мөрийг сунгахгүй.  Монгол бичвэрт «hyphens» ТАВИХГҮЙ — үг
 * таслах дүрэм байхгүй тул буруу таслана. */
.tsah-doc__list li { margin: 2px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
/* ЗАЛГАА тодорхойлолтын мөрүүдийн хооронд харагдахуйц зай.  Дэлгэц ба
 * хэвлэл хоёуланд үйлчилнэ («+» тул эхний мөрөнд зай нэмэгдэхгүй). */
.tsah-doc__list li + li { margin-top: 0.5em; }
.tsah-doc__signatures { margin-top: 32px; font-size: 11pt; }
.tsah-doc__sig-row { display: flex; gap: 24px; margin-top: 18px; flex-wrap: wrap; }
.tsah-doc__sig-cell { flex: 1; min-width: 200px; }
.tsah-doc__sig-role { font-weight: 600; margin-bottom: 24px; }
.tsah-doc__sig-line { border-bottom: 1px solid #444; padding-bottom: 2px; min-height: 22px; }
.tsah-doc__sig-meta { font-size: 10pt; color: #555; margin-top: 4px; }
@media print {
  .tsah-doc { max-width: none; padding: 0; }
  .tsah-doc__heading { break-after: avoid; }
  .tsah-doc__para, .tsah-doc__list { break-inside: avoid-page; }
}
`;
