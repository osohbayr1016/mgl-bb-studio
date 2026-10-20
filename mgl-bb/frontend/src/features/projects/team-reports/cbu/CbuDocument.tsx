import type { CbuReportAnswers } from '@/features/projects/team-reports/cbu/types';
import { makeDocHelpers, type DocMode } from '@/features/projects/team-reports/docHelpers';
import { useDrawingRows } from '@/features/projects/team-reports/drawingList';
import { T } from '@/features/performance-reports/lib/reportText';

/* =============================================================
 * ЦБУ report printable document.  Same conditional-section
 * pattern as BB/HAS — sections only render when they have data.
 * Empty values render as "_____" in internal mode and vanish in
 * client mode (see ../docHelpers).
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
 * `.cbu-doc__grp`-ийн margin-top тайлбарыг доорх CSS-ээс үз.
 * ============================================================= */

const WATER_SOURCE_LABEL: Record<string, string> = {
  city: 'хотын төвлөрсөн усан хангамж',
  borehole: 'өөрийн худаг',
  mixed: 'холимог эх үүсвэр',
};

const HOT_WATER_LABEL: Record<string, string> = {
  central: 'төвлөрсөн',
  boiler: 'уурын зуухнаас',
  heat_exchanger: 'дулаан солилцуураар (ДЦС-аас)',
  instant: 'шуурхай халаагчаар',
  none: 'халуун ус төлөвлөгөөгүй',
};

const SEWAGE_LABEL: Record<string, string> = {
  gravity: 'хүндийн хүчээр',
  pumped: 'шахуургалттай',
  mixed: 'холимог',
};


const DRAWING_LIST_ROWS: Array<{ no: number; key: keyof CbuReportAnswers; label: string }> = [
  { no: 1, key: 'dl_cover', label: 'Нүүр хуудас' },
  { no: 2, key: 'dl_drawing_list', label: 'Зургийн жагсаалт' },
  { no: 3, key: 'dl_explanatory_note', label: 'Тайлбар бичиг' },
  { no: 4, key: 'dl_cold_water_plan', label: 'Цэвэр усны төлөвлөгөө' },
  { no: 5, key: 'dl_hot_water_plan', label: 'Халуун усны төлөвлөгөө' },
  { no: 6, key: 'dl_sewage_plan', label: 'Бохирын төлөвлөгөө' },
  { no: 7, key: 'dl_storm_plan', label: 'Борооны ус зайлуулах төлөвлөгөө' },
  { no: 8, key: 'dl_sprinkler_plan', label: 'Спринклер, галын төлөвлөгөө' },
  { no: 9, key: 'dl_riser_diagram', label: 'Босоо шугамын схем' },
  { no: 10, key: 'dl_techroom', label: 'Техникийн өрөө' },
  { no: 11, key: 'dl_equipment_schedule', label: 'Тоног төхөөрөмжийн жагсаалт' },
  { no: 12, key: 'dl_sections', label: 'Огтлолууд' },
  { no: 13, key: 'dl_details', label: 'Деталь, зангилаа' },
];

interface CbuReportDocumentProps {
  answers: CbuReportAnswers;
  mode?: DocMode;
}

export function CbuReportDocument({ answers, mode = 'internal' }: CbuReportDocumentProps) {
  const { withSuffix } = makeDocHelpers(mode);
  const blank = mode === 'client' ? '' : '_____';
  const drawingRows = useDrawingRows('TSBU', DRAWING_LIST_ROWS);
  const answerOf = answers as Record<string, unknown>;
  return (
    <article className="cbu-doc">
      <header data-a4-item>
        <h1 className="cbu-doc__title">
          <T k="cbu.h.title">ТАЙЛБАР БИЧИГ</T>
        </h1>
        <p className="cbu-doc__subtitle">
          <T k="cbu.h.subtitle">ЦЭВЭР, БОХИР УСНЫ ШУГАМ СҮЛЖЭЭ</T>
        </p>
      </header>

      {(answers.water_source_kind || answers.water_inlet_count || answers.water_source_text) && (
        <section className="cbu-doc__grp" data-a4-item>
          <Heading>
            <T k="cbu.h.source">УСАН ХАНГАМЖИЙН ЭХ ҮҮСВЭР</T>
          </Heading>
          <ul className="cbu-doc__list">
            {answers.water_source_kind && (
              <li>
                <T k="cbu.lbl.water_source">Эх үүсвэр:</T>{' '}
                <strong>{WATER_SOURCE_LABEL[answers.water_source_kind] ?? blank}</strong>.
              </li>
            )}
            {answers.water_inlet_count && (
              <li>
                <T k="cbu.lbl.water_inlet_count">Усны оролтын тоо:</T>{' '}
                <strong>{withSuffix(answers.water_inlet_count, 'ширхэг')}</strong>.
              </li>
            )}
            {answers.water_inlet_pressure && (
              <li>
                <T k="cbu.lbl.water_inlet_pressure">Оролтын даралт:</T>{' '}
                <strong>{withSuffix(answers.water_inlet_pressure, 'бар')}</strong>.
              </li>
            )}
          </ul>
          {answers.water_source_text && <Para>{answers.water_source_text}</Para>}
        </section>
      )}

      {(answers.water_demand_total ||
        answers.water_pressure_required ||
        answers.hot_water_source ||
        answers.water_narrative) && (
        <section className="cbu-doc__grp" data-a4-item>
          <Heading>
            <T k="cbu.h.demand">ХЭРЭГЛЭЭНИЙ ЦЭВЭР, ХАЛУУН УС</T>
          </Heading>
          <ul className="cbu-doc__list">
            {answers.water_demand_total && (
              <li>
                <T k="cbu.lbl.water_demand_total">Нийт хоногийн усны хэрэглээ:</T>{' '}
                <strong>{withSuffix(answers.water_demand_total, 'м³/хоног')}</strong>.
              </li>
            )}
            {answers.water_demand_per_person && (
              <li>
                <T k="cbu.lbl.water_demand_per_person">Хүнд ноогдох хэрэглээ:</T>{' '}
                <strong>{withSuffix(answers.water_demand_per_person, 'л/хүн/хоног')}</strong>.
              </li>
            )}
            {answers.water_pressure_required && (
              <li>
                <T k="cbu.lbl.water_pressure_required">Шаардлагатай ажлын даралт:</T>{' '}
                <strong>{withSuffix(answers.water_pressure_required, 'бар')}</strong>.
              </li>
            )}
            {answers.water_pressure_zoning && (
              <li>
                <T k="cbu.txt.water_pressure_zoning">Даралтыг давхар бүсчилсэн төлөвлөв.</T>
              </li>
            )}
            {answers.hot_water_source && (
              <li>
                <T k="cbu.lbl.hot_water_source">Халуун усны эх үүсвэр:</T>{' '}
                <strong>{HOT_WATER_LABEL[answers.hot_water_source] ?? blank}</strong>.
              </li>
            )}
            {answers.hot_water_supply_temp && (
              <li>
                <T k="cbu.lbl.hot_water_temp">Халуун усны нийлүүлэх температур:</T>{' '}
                <strong>{withSuffix(answers.hot_water_supply_temp, '°C')}</strong>.
              </li>
            )}
            {answers.water_saving_fixtures && (
              <li>
                <T k="cbu.txt.water_saving">Ус хэмнэх төхөөрөмжтэй сантехник.</T>
              </li>
            )}
            {answers.water_sound_dampening && (
              <li>
                <T k="cbu.txt.water_sound">
                  Шугам, хоолойд дуу намсгагч, чичиргээ зөөлрүүлэгч холболттой.
                </T>
              </li>
            )}
          </ul>
          {answers.water_narrative && <Para>{answers.water_narrative}</Para>}
        </section>
      )}

      {(answers.sewage_system ||
        answers.sewage_separated ||
        answers.storm_roof_drains ||
        answers.sewage_narrative) && (
        <section className="cbu-doc__grp" data-a4-item>
          <Heading>
            <T k="cbu.h.sewage">АРИУТГАХ ТАТУУРГА, БОРООНЫ УС</T>
          </Heading>
          <ul className="cbu-doc__list">
            {answers.sewage_system && (
              <li>
                <T k="cbu.lbl.sewage_system">Бохирын систем:</T>{' '}
                <strong>{SEWAGE_LABEL[answers.sewage_system] ?? blank}</strong>.
              </li>
            )}
            {answers.sewage_separated && (
              <li>
                <T k="cbu.txt.sewage_separated">
                  Ахуйн ба үйлдвэрлэлийн бохирыг салгаж төлөвлөв.
                </T>
              </li>
            )}
            {answers.sewage_treatment_local && (
              <li>
                <T k="cbu.txt.sewage_treatment">Дотоод цэвэршүүлэх төхөөрөмжтэй.</T>
              </li>
            )}
            {answers.sewage_pumping_required && (
              <li>
                <T k="cbu.txt.sewage_pumping">Зоорийн давхарт шахуурга шаардлагатай.</T>
              </li>
            )}
            {answers.storm_roof_drains && (
              <li>
                <T k="cbu.txt.storm_roof">Дээврийн дотуур ус зайлуулах систем.</T>
              </li>
            )}
            {answers.storm_parking_drains && (
              <li>
                <T k="cbu.txt.storm_parking">Зогсоолын шалын ус зайлуулах систем.</T>
              </li>
            )}
            {answers.storm_surface_drainage && (
              <li>
                <T k="cbu.txt.storm_surface">Гадаргын усны зайлуулалт.</T>
              </li>
            )}
          </ul>
          {answers.sewage_narrative && <Para>{answers.sewage_narrative}</Para>}
        </section>
      )}

      {(answers.riser_shaft_count || answers.riser_shaft_locations) && (
        <section className="cbu-doc__grp" data-a4-item>
          <Heading>
            <T k="cbu.h.riser">БОСОО ШУГАМ</T>
          </Heading>
          <ul className="cbu-doc__list">
            {answers.riser_shaft_count && (
              <li>
                <T k="cbu.lbl.riser_count">Босоо шугамын тоо:</T>{' '}
                <strong>{withSuffix(answers.riser_shaft_count, 'ширхэг')}</strong>.
              </li>
            )}
          </ul>
          {answers.riser_shaft_locations && <Para>{answers.riser_shaft_locations}</Para>}
        </section>
      )}

      {/* Зургийн жагсаалт — мөрийн тоо хязгааргүй тул мөр тус бүр өөрийн item. */}
      {drawingRows.some((r) => answerOf[r.key] === true) && (
        <>
          <div className="cbu-doc__grp" data-a4-item>
            <Heading>
              <T k="cbu.h.drawings">ЦБУ-ИЙН ЗУРГИЙН ЖАГСААЛТ</T>
            </Heading>
          </div>
          <ul className="cbu-doc__list">
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
  return <h2 className="cbu-doc__heading">{children}</h2>;
}

function Para({ children }: { children: React.ReactNode }) {
  return <p className="cbu-doc__para">{children}</p>;
}

export const CBU_REPORT_STYLES = `
.cbu-doc { font-family: "Arial", Helvetica, sans-serif; color: #111; line-height: 1.55; max-width: 760px; margin: 0 auto; padding: 0 16px; }
.cbu-doc__title { text-align: center; font-size: 18pt; font-weight: 700; margin: 0; letter-spacing: 0.06em; }
.cbu-doc__subtitle { text-align: center; font-size: 12pt; font-weight: 600; margin: 4px 0 18px; letter-spacing: 0.06em; color: #444; }
.cbu-doc__meta { margin-bottom: 18px; }
.cbu-doc__meta-row { font-size: 11pt; margin: 2px 0; }
.cbu-doc__meta-label { font-weight: 600; }
.cbu-doc__heading { font-size: 12pt; font-weight: 700; text-transform: uppercase; margin: 18px 0 6px; letter-spacing: 0.04em; border-bottom: 1px solid #999; padding-bottom: 3px; }
.cbu-doc__para { font-size: 11pt; margin: 6px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
.cbu-doc__list { font-size: 11pt; margin: 6px 0 6px 18px; padding: 0; }
/* Үргэлжилсэн бичвэр — хоёр талаар тэгшилнэ.  «text-align-last: left» нь
 * сүүлийн мөрийг сунгахгүй.  Монгол бичвэрт «hyphens» ТАВИХГҮЙ — үг
 * таслах дүрэм байхгүй тул буруу таслана. */
.cbu-doc__list li { margin: 2px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
/* ЗАЛГАА тодорхойлолтын мөрүүдийн хооронд харагдахуйц зай.  Дэлгэц ба
 * хэвлэл хоёуланд үйлчилнэ («+» тул эхний мөрөнд зай нэмэгдэхгүй). */
.cbu-doc__list li + li { margin-top: 0.5em; }
/* Хуудаслалтын бүлэг (data-a4-item).  Гарчгийн дээд зайг БҮЛЭГ өөртөө
 * авна — эс бөгөөс эхний хүүхдийн margin эцэг рүүгээ "collapse through"
 * болж, A4Paginator-ийн margin-top түлхэлт тэр хэмжээгээр дутна. */
.cbu-doc__grp { margin-top: 18px; }
.cbu-doc__grp > .cbu-doc__heading { margin-top: 0; }
.cbu-doc__signatures { margin-top: 32px; font-size: 11pt; }
.cbu-doc__sig-row { display: flex; gap: 24px; margin-top: 18px; flex-wrap: wrap; }
.cbu-doc__sig-cell { flex: 1; min-width: 200px; }
.cbu-doc__sig-role { font-weight: 600; margin-bottom: 24px; }
.cbu-doc__sig-line { border-bottom: 1px solid #444; padding-bottom: 2px; min-height: 22px; }
.cbu-doc__sig-meta { font-size: 10pt; color: #555; margin-top: 4px; }
@media print {
  .cbu-doc { max-width: none; padding: 0; }
  .cbu-doc__heading { break-after: avoid; }
  .cbu-doc__para, .cbu-doc__list { break-inside: avoid-page; }
}
`;
