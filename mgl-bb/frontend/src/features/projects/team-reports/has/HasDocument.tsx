import type { HasReportAnswers } from '@/features/projects/team-reports/has/types';
import { makeDocHelpers, type DocMode } from '@/features/projects/team-reports/docHelpers';
import { useDrawingRows } from '@/features/projects/team-reports/drawingList';
import { T } from '@/features/performance-reports/lib/reportText';

/* =============================================================
 * HAS report printable document.
 * -------------------------------------------------------------
 * Same conditional-section pattern as BA/BB: render each section
 * only when at least one of its fields is filled. Empty values
 * render as "_____" in internal mode and vanish in client mode
 * (see ../docHelpers).
 *
 * -------------------------------------------------------------
 * A4 ХУУДАСЛАЛТ (`data-a4-item`) — BbDocument-тай ЯГ ИЖИЛ дүрэм:
 *   • ХЭСЭГ БҮР (гарчиг + жагсаалт/догол мөр) = НЭГ item.  Хэсгийн
 *     урт нь хариултын талбарын тоогоор хязгаарлагдсан (≤ 8 богино
 *     мөр) тул бүхэлд нь түлхэхэд зай дэмий үрэгдэхгүй, харин гарчиг
 *     хуудасны ёроолд ганцаараа үлдэхгүй.
 *   • ЗУРГИЙН ЖАГСААЛТ — `team_drawing_items`-ээр урт нь хязгааргүй
 *     тул `<li>` бүр ТУСДАА item.
 *   • Үүрлэсэн item байхгүй (гаднах нь л тооцогддог).
 * `.has-doc__grp`-ийн margin-top тайлбарыг доорх CSS-ээс үз.
 * ============================================================= */

const HEAT_SOURCE_LABEL: Record<string, string> = {
  district: 'ДЦС / Хотын дулаан хангамж',
  central_own: 'Барилгын төвлөрсөн',
  boiler: 'Уурын зуух',
  heat_pump: 'Дулааны насос',
  electric: 'Цахилгаан',
};

const HEAT_ROUTING_LABEL: Record<string, string> = {
  bottom_dead_end: 'доороос тарааж, мухар үзүүртэй',
  bottom_ring: 'доороос тарааж, дугуй холбоост',
  top_distribution: 'дээрээс тараасан',
};

const AC_KIND_LABEL: Record<string, string> = {
  vrv: 'VRV (хувьсах хөргөлт)',
  split: 'сплит систем',
  chilled_water: 'хүйтэн усны систем',
  mixed: 'холимог',
  none: 'төлөвлөгөөгүй',
};

const DRAWING_LIST_ROWS: Array<{ no: number; key: keyof HasReportAnswers; label: string }> = [
  { no: 1, key: 'dl_cover', label: 'Нүүр хуудас' },
  { no: 2, key: 'dl_drawing_list', label: 'Зургийн жагсаалт' },
  { no: 3, key: 'dl_explanatory_note', label: 'Тайлбар бичиг' },
  { no: 4, key: 'dl_heating_plan', label: 'Халаалтын төлөвлөгөө' },
  { no: 5, key: 'dl_vent_plan', label: 'Агаар сэлгэлтийн төлөвлөгөө' },
  { no: 6, key: 'dl_ac_plan', label: 'Хөргөлтийн (АС/VRV) төлөвлөгөө' },
  { no: 7, key: 'dl_smoke_plan', label: 'Утаа зайлуулах төлөвлөгөө' },
  { no: 8, key: 'dl_riser_diagram', label: 'Шугам холболтын схем' },
  { no: 9, key: 'dl_equipment_schedule', label: 'Тоног төхөөрөмжийн жагсаалт' },
  { no: 10, key: 'dl_sections', label: 'Огтлолууд' },
  { no: 11, key: 'dl_details', label: 'Деталь, зангилаа' },
];

interface HasReportDocumentProps {
  answers: HasReportAnswers;
  mode?: DocMode;
}

export function HasReportDocument({ answers, mode = 'internal' }: HasReportDocumentProps) {
  const { withSuffix } = makeDocHelpers(mode);
  const blank = mode === 'client' ? '' : '_____';
  const drawingRows = useDrawingRows('HAS', DRAWING_LIST_ROWS);
  const answerOf = answers as Record<string, unknown>;
  return (
    <article className="has-doc">
      <header data-a4-item>
        <h1 className="has-doc__title">
          <T k="has.h.title">ТАЙЛБАР БИЧИГ</T>
        </h1>
        <p className="has-doc__subtitle">
          <T k="has.h.subtitle">
            ХАЛААЛТ, АГААР СЭЛГЭЛТ, КОНДИЦИОНЕР, ГАЛ ТҮЙМРИЙН УТААНААС ХАМГААЛАХ СИСТЕМ
          </T>
        </p>
      </header>

      {(answers.heat_source_kind || answers.heat_supply_temp || answers.heat_load_total) && (
        <section className="has-doc__grp" data-a4-item>
          <Heading>
            <T k="has.h.source">ДУЛААН ХАНГАМЖИЙН ЭХ ҮҮСВЭР</T>
          </Heading>
          <ul className="has-doc__list">
            {answers.heat_source_kind && (
              <li>
                <T k="has.lbl.heat_source">Эх үүсвэр:</T>{' '}
                <strong>{HEAT_SOURCE_LABEL[answers.heat_source_kind] ?? blank}</strong>.
              </li>
            )}
            {(answers.heat_supply_temp || answers.heat_return_temp) && (
              <li>
                <T k="has.lbl.heat_temps">Дамжуулагчын температур:</T>{' '}
                <strong>{withSuffix(answers.heat_supply_temp, '°C')}</strong> /{' '}
                <strong>{withSuffix(answers.heat_return_temp, '°C')}</strong>{' '}
                <T k="has.txt.heat_temps_note">(нийлүүлэлт / буцаалт).</T>
              </li>
            )}
            {answers.heat_design_outdoor_temp && (
              <li>
                <T k="has.lbl.heat_outdoor_temp">Тооцооны гадна агаарын температур:</T>{' '}
                <strong>{withSuffix(answers.heat_design_outdoor_temp, '°C')}</strong>.
              </li>
            )}
            {answers.heat_load_total && (
              <li>
                <T k="has.lbl.heat_load_total">Нийт халаалтын ачаалал:</T>{' '}
                <strong>{withSuffix(answers.heat_load_total, 'кВт')}</strong>.
              </li>
            )}
            {answers.heat_pipe_routing && (
              <li>
                <T k="has.lbl.heat_routing">Дамжуулах хоолой:</T>{' '}
                <strong>{HEAT_ROUTING_LABEL[answers.heat_pipe_routing] ?? blank}</strong>{' '}
                <T k="has.txt.heat_routing_suffix">систем.</T>
              </li>
            )}
          </ul>
        </section>
      )}

      {(answers.heat_zoning_text ||
        answers.heat_devices_panel ||
        answers.heat_devices_cast ||
        answers.heat_devices_convector ||
        answers.heat_devices_fan_coil ||
        answers.heat_devices_floor ||
        answers.heat_system_pressure) && (
        <section className="has-doc__grp" data-a4-item>
          <Heading>
            <T k="has.h.heating">ХАЛААЛТЫН СИСТЕМ</T>
          </Heading>
          {answers.heat_zoning_text && <Para>{answers.heat_zoning_text}</Para>}
          <ul className="has-doc__list">
            {answers.heat_devices_panel && (
              <li>
                <T k="has.txt.dev_panel">Панел радиатор.</T>
              </li>
            )}
            {answers.heat_devices_cast && (
              <li>
                <T k="has.txt.dev_cast">Цутгамал радиатор.</T>
              </li>
            )}
            {answers.heat_devices_convector && (
              <li>
                <T k="has.txt.dev_convector">Конвектор.</T>
              </li>
            )}
            {answers.heat_devices_fan_coil && (
              <li>
                <T k="has.txt.dev_fan_coil">Fan coil.</T>
              </li>
            )}
            {answers.heat_devices_floor && (
              <li>
                <T k="has.txt.dev_floor">Шалны халаалт.</T>
              </li>
            )}
            {answers.heat_devices_other && <li>{answers.heat_devices_other}.</li>}
            {answers.heat_system_pressure && (
              <li>
                <T k="has.lbl.heat_pressure">Системийн ажлын даралт:</T>{' '}
                <strong>{withSuffix(answers.heat_system_pressure, 'бар')}</strong>.
              </li>
            )}
            {answers.heat_individual_metering && (
              <li>
                <T k="has.txt.heat_metering">Айл бүрд дулааны тоолуур төлөвлөсөн.</T>
              </li>
            )}
          </ul>
        </section>
      )}

      {(answers.vent_supply_mech ||
        answers.vent_exhaust_mech ||
        answers.vent_natural_exhaust ||
        answers.vent_heat_recovery ||
        answers.vent_wc_full_mechanical ||
        answers.vent_narrative) && (
        <section className="has-doc__grp" data-a4-item>
          <Heading>
            <T k="has.h.vent">АГААР СЭЛГЭЛТ</T>
          </Heading>
          <ul className="has-doc__list">
            {answers.vent_supply_mech && (
              <li>
                <T k="has.txt.vent_supply_mech">Механик нийлүүлэлт.</T>
              </li>
            )}
            {answers.vent_exhaust_mech && (
              <li>
                <T k="has.txt.vent_exhaust_mech">Механик сорогт.</T>
              </li>
            )}
            {answers.vent_natural_exhaust && (
              <li>
                <T k="has.txt.vent_natural">Орон сууцны хэсэгт байгалийн сорогт.</T>
              </li>
            )}
            {answers.vent_heat_recovery && (
              <li>
                <T k="has.txt.vent_recovery">Дулаан буцаах систем (heat recovery).</T>
              </li>
            )}
            {answers.vent_wc_full_mechanical && (
              <li>
                <T k="has.txt.vent_wc">Ариун цэврийн өрөөнд 100% механик сорогт төлөвлөсөн.</T>
              </li>
            )}
            {answers.vent_service_supply && (
              <li>
                <T k="has.txt.vent_service">Үйлчилгээний хэсэг механик нийлүүлэлттэй.</T>
              </li>
            )}
            {answers.vent_parking_pressurized && (
              <li>
                <T k="has.txt.vent_parking">Зогсоол даралттай агаартай.</T>
              </li>
            )}
            {answers.vent_ring_ducts && (
              <li>
                <T k="has.txt.vent_ducts">Агаар сэлгэлтийн салбар хоолой дугуй хийцтэй.</T>
              </li>
            )}
          </ul>
          {answers.vent_narrative && <Para>{answers.vent_narrative}</Para>}
        </section>
      )}

      {(answers.ac_system_kind ||
        answers.ac_outdoor_placement ||
        answers.ac_indoor_kinds ||
        answers.ac_narrative) && (
        <section className="has-doc__grp" data-a4-item>
          <Heading>
            <T k="has.h.ac">ХӨРГӨЛТИЙН СИСТЕМ</T>
          </Heading>
          <ul className="has-doc__list">
            {answers.ac_system_kind && (
              <li>
                <T k="has.lbl.ac_kind">Системийн төрөл:</T>{' '}
                <strong>{AC_KIND_LABEL[answers.ac_system_kind] ?? blank}</strong>.
              </li>
            )}
            {answers.ac_indoor_kinds && (
              <li>
                <T k="has.lbl.ac_indoor">Дотор хэсгийн төрлүүд:</T> {answers.ac_indoor_kinds}.
              </li>
            )}
            {answers.ac_outdoor_placement && (
              <li>
                <T k="has.lbl.ac_outdoor">Гадна тоног төхөөрөмжийн байрлал:</T>{' '}
                {answers.ac_outdoor_placement}.
              </li>
            )}
            {answers.ac_independent_per_floor && (
              <li>
                <T k="has.txt.ac_per_floor">
                  Үйлчилгээний хэсэгт давхар тус бүр бие даасан VRV систем.
                </T>
              </li>
            )}
            {answers.ac_service_dedicated_tech_room && (
              <li>
                <T k="has.txt.ac_tech_room">
                  Үйлчилгээний хэсгийн АС-д техникийн өрөө төлөвлөсөн.
                </T>
              </li>
            )}
          </ul>
          {answers.ac_narrative && <Para>{answers.ac_narrative}</Para>}
        </section>
      )}

      {/* Зургийн жагсаалт — мөрийн тоо хязгааргүй тул мөр тус бүр өөрийн item. */}
      {drawingRows.some((r) => answerOf[r.key] === true) && (
        <>
          <div className="has-doc__grp" data-a4-item>
            <Heading>
              <T k="has.h.drawings">ХАС-ЫН ЗУРГИЙН ЖАГСААЛТ</T>
            </Heading>
          </div>
          <ul className="has-doc__list">
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

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="has-doc__heading">{children}</h2>;
}

function Para({ children }: { children: React.ReactNode }) {
  return <p className="has-doc__para">{children}</p>;
}

export const HAS_REPORT_STYLES = `
.has-doc { font-family: "Arial", Helvetica, sans-serif; color: #111; line-height: 1.55; max-width: 760px; margin: 0 auto; padding: 0 16px; }
.has-doc__title { text-align: center; font-size: 18pt; font-weight: 700; margin: 0; letter-spacing: 0.06em; }
.has-doc__subtitle { text-align: center; font-size: 11pt; font-weight: 600; margin: 4px 0 18px; letter-spacing: 0.04em; color: #444; }
.has-doc__meta { margin-bottom: 18px; }
.has-doc__meta-row { font-size: 11pt; margin: 2px 0; }
.has-doc__meta-label { font-weight: 600; }
.has-doc__heading { font-size: 12pt; font-weight: 700; text-transform: uppercase; margin: 18px 0 6px; letter-spacing: 0.04em; border-bottom: 1px solid #999; padding-bottom: 3px; }
.has-doc__para { font-size: 11pt; margin: 6px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
.has-doc__list { font-size: 11pt; margin: 6px 0 6px 18px; padding: 0; }
/* Үргэлжилсэн бичвэр — хоёр талаар тэгшилнэ.  «text-align-last: left» нь
 * сүүлийн мөрийг сунгахгүй.  Монгол бичвэрт «hyphens» ТАВИХГҮЙ — үг
 * таслах дүрэм байхгүй тул буруу таслана. */
.has-doc__list li { margin: 2px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
/* ЗАЛГАА тодорхойлолтын мөрүүдийн хооронд харагдахуйц зай.  Дэлгэц ба
 * хэвлэл хоёуланд үйлчилнэ («+» тул эхний мөрөнд зай нэмэгдэхгүй). */
.has-doc__list li + li { margin-top: 0.5em; }
/* Хуудаслалтын бүлэг (data-a4-item).  Гарчгийн дээд зайг БҮЛЭГ өөртөө
 * авна — эс бөгөөс эхний хүүхдийн margin эцэг рүүгээ "collapse through"
 * болж, A4Paginator-ийн margin-top түлхэлт тэр хэмжээгээр дутна. */
.has-doc__grp { margin-top: 18px; }
.has-doc__grp > .has-doc__heading { margin-top: 0; }
.has-doc__signatures { margin-top: 32px; font-size: 11pt; }
.has-doc__sig-row { display: flex; gap: 24px; margin-top: 18px; flex-wrap: wrap; }
.has-doc__sig-cell { flex: 1; min-width: 200px; }
.has-doc__sig-role { font-weight: 600; margin-bottom: 24px; }
.has-doc__sig-line { border-bottom: 1px solid #444; padding-bottom: 2px; min-height: 22px; }
.has-doc__sig-meta { font-size: 10pt; color: #555; margin-top: 4px; }
@media print {
  .has-doc { max-width: none; padding: 0; }
  .has-doc__heading { break-after: avoid; }
  .has-doc__para, .has-doc__list { break-inside: avoid-page; }
}
`;
