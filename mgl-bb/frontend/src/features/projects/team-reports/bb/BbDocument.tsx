import type { BbReportAnswers } from '@/features/projects/team-reports/bb/types';
import { makeDocHelpers, type DocMode } from '@/features/projects/team-reports/docHelpers';
import { useDrawingRows } from '@/features/projects/team-reports/drawingList';
import { T } from '@/features/performance-reports/lib/reportText';

/* =============================================================
 * BB report printable document.
 * -------------------------------------------------------------
 * Mirrors BA's BaDocument: walks answers, formats as Mongolian
 * prose with bulleted lists.  Each section only prints when at
 * least one of its fields is filled, so partial drafts stay
 * clean.  Empty values render as "_____" in internal mode and
 * vanish entirely in client mode (see ../docHelpers).  Mounts
 * both as the in-app preview and as the standalone print page.
 *
 * -------------------------------------------------------------
 * A4 ХУУДАСЛАЛТ (`data-a4-item`)
 * -------------------------------------------------------------
 * Гүйцэтгэлийн тайлангийн `A4Paginator` нь `[data-a4-item]`-ийг
 * хэмжиж, хуудасны заагт унасныг нь дараагийн хуудас руу түлхдэг.
 * Энэ файлд тэмдэглэгээг ДАРААХ түвшинд тавив:
 *
 *   • ХЭСЭГ БҮР (гарчиг + өөрийн жагсаалт/догол мөр) = НЭГ item.
 *     Хэсгийн агуулга нь ХЯЗГААРЛАГДМАЛ (хариултын талбарын тоогоор
 *     дээд тал нь 7-8 богино мөр ≈ ¼ хуудас) тул бүхэлд нь түлхэхэд
 *     үлдэх цагаан зай бага, харин гарчиг хуудасны ёроолд ГАНЦААРАА
 *     үлдэх боломжгүй болно.
 *   • ЗУРГИЙН ЖАГСААЛТ бол ялгаатай: `team_drawing_items` (migration
 *     0121)-ээр admin дурын тооны мөр нэмж чаддаг тул урт нь ХЯЗГААРГҮЙ.
 *     Иймд гарчиг+удиртгал нэг item, `<li>` бүр ТУСДАА item — урт
 *     жагсаалт бүхэлдээ үсэрч өмнөх хуудсыг хоосон орхихгүй.
 *   • ҮҮРЛЭСЭН item хийхгүй: хэсгийн `<li>`-үүд тэмдэглэгээгүй
 *     (paginator гаднахыг нь л тооцох тул утгагүй байх байсан).
 *
 * ⚠️ `.bb-doc__grp` нь гарчгийн `margin-top`-ыг ӨӨР ДЭЭРЭЭ авдаг
 * (доорх CSS-ийг үз).  Учир нь эцэг элементийн эхний хүүхдийн margin
 * "collapse through" болдог бөгөөд paginator нь `getComputedStyle`-аас
 * уншсан margin дээр түлхэлтээ НЭМДЭГ — collapse үед тэр түлхэлт
 * бүтэн хүчинтэй болохгүй, хуудас бүрт хэдэн px-ээр гулсана.
 * ============================================================= */

const FOUNDATION_LABEL: Record<string, string> = {
  mat: 'нил хавтан суурь',
  strip: 'шугаман суурь',
  cup: 'аяган суурь',
  pile: 'шонгийн суурь',
  hybrid: 'холимог суурь',
};

const LATERAL_LABEL: Record<string, string> = {
  cast_in_place: 'бүрэн цутгамал төмөр бетон',
  rc_frame: 'рам-холбоост ТБ каркас',
  shear_wall: 'ТБ ханан даацт',
  steel_frame: 'металл каркас',
  hybrid: 'холимог систем',
};

const SLAB_LABEL: Record<string, string> = {
  flat: 'тэгш хавтан (flat slab)',
  beam_slab: 'дам нуруутай хавтан',
  metal_deck: 'металл тавцантай ТБ',
};

const SOIL_SEISMIC_LABEL: Record<string, string> = {
  I: 'I (хатуу чулуулаг)',
  II: 'II (хатуу хөрс)',
  III: 'III (зөөлөн хөрс)',
};

const SEISMIC_METHOD_LABEL: Record<string, string> = {
  response_spectrum: 'хариу спектр (response spectrum)',
  time_history: 'цаг хугацааны (time history)',
  pushover: 'пушовер (pushover)',
};


const DRAWING_LIST_ROWS: Array<{ no: number; key: keyof BbReportAnswers; label: string }> = [
  { no: 1, key: 'dl_cover', label: 'Нүүр хуудас' },
  { no: 2, key: 'dl_drawing_list', label: 'Зургийн жагсаалт' },
  { no: 3, key: 'dl_explanatory_note', label: 'Тайлбар бичиг' },
  { no: 4, key: 'dl_foundation_plan', label: 'Суурийн байгуулалт' },
  { no: 5, key: 'dl_column_plan', label: 'Багана / даацын ханын байгуулалт' },
  { no: 6, key: 'dl_slab_plan', label: 'Хучилтын байгуулалт' },
  { no: 7, key: 'dl_beam_layout', label: 'Дам нурууны байгуулалт' },
  { no: 8, key: 'dl_rebar_details', label: 'Арматурын зураг' },
  { no: 9, key: 'dl_sections', label: 'Огтлолууд' },
  { no: 10, key: 'dl_details', label: 'Деталь, зангилаа' },
];

interface BbReportDocumentProps {
  answers: BbReportAnswers;
  mode?: DocMode;
}

export function BbReportDocument({ answers, mode = 'internal' }: BbReportDocumentProps) {
  const { v, withSuffix } = makeDocHelpers(mode);
  const blank = mode === 'client' ? '' : '_____';
  const drawingRows = useDrawingRows('BB', DRAWING_LIST_ROWS);
  const answerOf = answers as Record<string, unknown>;
  return (
    <article className="bb-doc">
      <header data-a4-item>
        <h1 className="bb-doc__title">
          <T k="bb.h.title">ТАЙЛБАР БИЧИГ</T>
        </h1>
        <p className="bb-doc__subtitle">
          <T k="bb.h.subtitle">БАРИЛГЫН БҮТЭЭЦ</T>
        </p>
      </header>

      {/* Soil */}
      {(answers.soil_narrative ||
        answers.soil_groundwater_depth ||
        answers.soil_freezing_depth ||
        answers.soil_seismic_category ||
        answers.soil_special_conditions) && (
        <section className="bb-doc__grp" data-a4-item>
          <Heading>
            <T k="bb.h.soil">ГЕОТЕХНИКИЙН НӨХЦӨЛ</T>
          </Heading>
          {answers.soil_narrative && <Para>{answers.soil_narrative}</Para>}
          <ul className="bb-doc__list">
            {answers.soil_groundwater_depth && (
              <li>
                <T k="bb.lbl.soil_groundwater">Газрын доорх усны түвшин:</T>{' '}
                <strong>{withSuffix(answers.soil_groundwater_depth, 'м')}</strong>.
              </li>
            )}
            {answers.soil_freezing_depth && (
              <li>
                <T k="bb.lbl.soil_freezing">Хөрс хөлдөлтийн гүн:</T>{' '}
                <strong>{withSuffix(answers.soil_freezing_depth, 'м')}</strong>.
              </li>
            )}
            {answers.soil_seismic_category && (
              <li>
                <T k="bb.lbl.soil_seismic">Газар хөдлөлтийн хөрсний анги:</T>{' '}
                <strong>{SOIL_SEISMIC_LABEL[answers.soil_seismic_category] ?? blank}</strong>.
              </li>
            )}
            {answers.soil_rqd_min && (
              <li>
                <T k="bb.lbl.soil_rqd">Хамгийн бага RQD:</T>{' '}
                <strong>{withSuffix(answers.soil_rqd_min, '%')}</strong>.
              </li>
            )}
            {answers.soil_design_resistance && (
              <li>
                <T k="bb.lbl.soil_r0">Тооцооны эсэргүүцэл R0:</T>{' '}
                <strong>{withSuffix(answers.soil_design_resistance, 'тонн/м²')}</strong>.
              </li>
            )}
          </ul>
          {answers.soil_special_conditions && (
            <Para>
              <T k="bb.lbl.soil_special" as="strong">
                Онцгой нөхцөл:
              </T>{' '}
              {answers.soil_special_conditions}
            </Para>
          )}
        </section>
      )}

      {/* Foundation */}
      {(answers.foundation_type ||
        answers.foundation_concrete_grade ||
        answers.foundation_thickness) && (
        <section className="bb-doc__grp" data-a4-item>
          <Heading>
            <T k="bb.h.foundation">СУУРЬ</T>
          </Heading>
          <ul className="bb-doc__list">
            {answers.foundation_type && (
              <li>
                <T k="bb.lbl.foundation_type">Суурийн төрөл:</T>{' '}
                <strong>{FOUNDATION_LABEL[answers.foundation_type] ?? blank}</strong>.
              </li>
            )}
            {answers.foundation_depth && (
              <li>
                <T k="bb.lbl.foundation_depth">Суурийн гүн:</T>{' '}
                {withSuffix(answers.foundation_depth, 'м')}.
              </li>
            )}
            {answers.foundation_thickness && (
              <li>
                <T k="bb.lbl.foundation_thickness">Суурийн зузаан:</T>{' '}
                {withSuffix(answers.foundation_thickness, 'мм')}.
              </li>
            )}
            {answers.foundation_concrete_grade && (
              <li>
                <T k="bb.lbl.foundation_concrete">Бетоны марк:</T>{' '}
                <strong>{answers.foundation_concrete_grade}</strong>
                <T k="bb.txt.foundation_density">, нягт ρ = 2500 кг/м³.</T>
              </li>
            )}
            {answers.foundation_water_class && (
              <li>
                <T k="bb.lbl.foundation_water_class">Усны эсэргүүцлийн анги:</T>{' '}
                <strong>{answers.foundation_water_class}</strong>.
              </li>
            )}
            {answers.foundation_rebar_main && (
              <li>
                <T k="bb.lbl.foundation_rebar_main">Үндсэн арматур:</T>{' '}
                <strong>{answers.foundation_rebar_main}</strong>
                {answers.foundation_rebar_aux && (
                  <>
                    <T k="bb.lbl.foundation_rebar_aux">, туслах арматур:</T>{' '}
                    <strong>{answers.foundation_rebar_aux}</strong>
                  </>
                )}
                .
              </li>
            )}
            {answers.foundation_settlement_max && (
              <li>
                <T k="bb.lbl.foundation_settlement">Зөвшөөрөгдөх хамгийн их суулт:</T>{' '}
                {withSuffix(answers.foundation_settlement_max, 'см')}.
              </li>
            )}
          </ul>
        </section>
      )}

      {/* Framing */}
      {(answers.lateral_system ||
        answers.wall_thickness ||
        answers.column_grid ||
        answers.slab_system) && (
        <section className="bb-doc__grp" data-a4-item>
          <Heading>
            <T k="bb.h.frame">ҮНДСЭН КАРКАС</T>
          </Heading>
          <ul className="bb-doc__list">
            {answers.lateral_system && (
              <li>
                <T k="bb.lbl.lateral_system">Үндсэн системийн төрөл:</T>{' '}
                <strong>{LATERAL_LABEL[answers.lateral_system] ?? blank}</strong>.
              </li>
            )}
            {answers.wall_thickness && (
              <li>
                <T k="bb.lbl.wall_thickness">Хана / цөмийн зузаан:</T>{' '}
                {withSuffix(answers.wall_thickness, 'мм')}.
              </li>
            )}
            {answers.column_grid && (
              <li>
                <T k="bb.lbl.column_grid">Баганын алслал:</T>{' '}
                <strong>{answers.column_grid}</strong>.
              </li>
            )}
            {answers.column_size && (
              <li>
                <T k="bb.lbl.column_size">Баганын хэмжээ:</T>{' '}
                <strong>{answers.column_size}</strong>.
              </li>
            )}
            {answers.slab_system && (
              <li>
                <T k="bb.lbl.slab_system">Хучилтын систем:</T>{' '}
                <strong>{SLAB_LABEL[answers.slab_system] ?? blank}</strong>.
              </li>
            )}
            {answers.slab_thickness && (
              <li>
                <T k="bb.lbl.slab_thickness">Хучилтын зузаан:</T>{' '}
                {withSuffix(answers.slab_thickness, 'мм')}.
              </li>
            )}
          </ul>
        </section>
      )}

      {/* Materials */}
      {(answers.concrete_grade_main || answers.rebar_grade_main || answers.rebar_secondary) && (
        <section className="bb-doc__grp" data-a4-item>
          <Heading>
            <T k="bb.h.materials">БЕТОН, АРМАТУР</T>
          </Heading>
          <ul className="bb-doc__list">
            {answers.concrete_grade_main && (
              <li>
                <T k="bb.lbl.concrete_main">Үндсэн бетоны марк:</T>{' '}
                <strong>{answers.concrete_grade_main}</strong>
                {answers.concrete_grade_secondary && (
                  <>
                    <T k="bb.lbl.concrete_secondary">, хоёрдогч марк:</T>{' '}
                    <strong>{answers.concrete_grade_secondary}</strong>
                  </>
                )}
                .
              </li>
            )}
            {answers.rebar_grade_main && (
              <li>
                <T k="bb.lbl.rebar_main">Үндсэн арматурын марк:</T>{' '}
                <strong>{answers.rebar_grade_main}</strong>{' '}
                <T k="bb.txt.rebar_standard">(MNS GOST 34028:2024 шаардлагад нийцсэн)</T>
                {answers.rebar_secondary && (
                  <>
                    <T k="bb.lbl.rebar_secondary">, хоёрдогч:</T>{' '}
                    <strong>{answers.rebar_secondary}</strong>
                  </>
                )}
                {answers.rebar_grade_aux && (
                  <>
                    <T k="bb.lbl.rebar_aux">, туслах:</T>{' '}
                    <strong>{answers.rebar_grade_aux}</strong>
                  </>
                )}
                .
              </li>
            )}
          </ul>
        </section>
      )}

      {/* Seismic */}
      {(answers.seismic_k0 ||
        answers.seismic_k1 ||
        answers.seismic_k_psi ||
        answers.seismic_joint_count ||
        answers.seismic_calc_method) && (
        <section className="bb-doc__grp" data-a4-item>
          <Heading>
            <T k="bb.h.seismic">ГАЗАР ХӨДЛӨЛТИЙН ТООЦОО</T>
          </Heading>
          <Para>
            <T k="bb.txt.seismic_intro">БНОД 22-01-21 дагуу тооцоонд авах нэмэлт өгөгдлүүд:</T>{' '}
            <strong>
              <T k="bb.lbl.seismic_k0">K0 =</T> {v(answers.seismic_k0)}
              <T k="bb.lbl.seismic_k1">, K1 =</T> {v(answers.seismic_k1)}
              <T k="bb.lbl.seismic_kpsi">, Kψ =</T> {v(answers.seismic_k_psi)}
            </strong>
            .
          </Para>
          {answers.seismic_calc_method && (
            <Para>
              <T k="bb.lbl.seismic_method">Тооцооны арга:</T>{' '}
              <strong>{SEISMIC_METHOD_LABEL[answers.seismic_calc_method] ?? blank}</strong>.
            </Para>
          )}
          {answers.seismic_joint_count && (
            <Para>
              <T k="bb.txt.seismic_joint_pre">Барилга нь</T>{' '}
              <strong>{withSuffix(answers.seismic_joint_count, 'заадас')}</strong>{' '}
              <T k="bb.txt.seismic_joint_post">бүхий бие даасан блокуудаас тогтоно.</T>
            </Para>
          )}
          {answers.seismic_joint_locations && <Para>{answers.seismic_joint_locations}</Para>}
        </section>
      )}

      {/* Loads */}
      {(answers.wind_5yr_pressure ||
        answers.wind_resonance_check ||
        answers.vehicle_load_3t ||
        answers.vehicle_load_5t ||
        answers.vehicle_load_26t ||
        answers.helipad_static_load ||
        answers.aerodynamic_method) && (
        <section className="bb-doc__grp" data-a4-item>
          <Heading>
            <T k="bb.h.loads">САЛХИНЫ АЧААЛАЛ, ОНЦГОЙ АЧААЛАЛ</T>
          </Heading>
          <ul className="bb-doc__list">
            {answers.wind_5yr_pressure && (
              <li>
                <T k="bb.lbl.wind_5yr">5 жилд нэг удаа тохиох салхины даралт:</T>{' '}
                <strong>{withSuffix(answers.wind_5yr_pressure, 'кг/м²')}</strong>.
              </li>
            )}
            {answers.wind_resonance_check && (
              <li>
                <T k="bb.txt.wind_resonance">Салхины резонансыг шалгасан.</T>
              </li>
            )}
            {answers.vehicle_load_3t && (
              <li>
                <T k="bb.txt.vehicle_3t">Авто ачаалал 3 тонн.</T>
              </li>
            )}
            {answers.vehicle_load_5t && (
              <li>
                <T k="bb.txt.vehicle_5t">Хүргэлтийн машины ачаалал 5 тонн.</T>
              </li>
            )}
            {answers.vehicle_load_26t && (
              <li>
                <T k="bb.txt.vehicle_26t">Гал унтраах машины ачаалал 26 тонн.</T>
              </li>
            )}
            {(answers.helipad_static_load || answers.helipad_dynamic_load) && (
              <li>
                <T k="bb.lbl.helipad_static">Нисдэг тэрэгний ачаалал: статик</T>{' '}
                {withSuffix(answers.helipad_static_load, 'кг')}
                {answers.helipad_dynamic_load && (
                  <>
                    <T k="bb.lbl.helipad_dynamic">, динамик</T>{' '}
                    {withSuffix(answers.helipad_dynamic_load, 'кг')}
                  </>
                )}
                .
              </li>
            )}
          </ul>
          {answers.aerodynamic_method && <Para>{answers.aerodynamic_method}</Para>}
        </section>
      )}

      {/* Calc methods */}
      {(answers.limit_state_first_group ||
        answers.limit_state_second_group ||
        answers.progressive_collapse_calc ||
        answers.permanent_monitoring) && (
        <section className="bb-doc__grp" data-a4-item>
          <Heading>
            <T k="bb.h.calc">ТООЦООНЫ АРГА, ХЯЗГААРЫН ТӨЛВҮҮД</T>
          </Heading>
          <ul className="bb-doc__list">
            {answers.limit_state_first_group && (
              <li>
                <T k="bb.txt.limit_state_first">
                  Барилгын бүтээцийг 1-р бүлгийн хязгаарын төлвүүдэд тооцсон.
                </T>
              </li>
            )}
            {answers.limit_state_second_group && (
              <li>
                <T k="bb.txt.limit_state_second">
                  2-р бүлгийн хязгаарын төлвүүдэд (хэвтээ шилжилт, ан цав) шалгасан.
                </T>
              </li>
            )}
            {answers.progressive_collapse_calc && (
              <li>
                <T k="bb.txt.progressive_collapse">Өргөжин нурах эвдрэлийг тооцох тооцоо хийсэн.</T>
              </li>
            )}
            {answers.permanent_monitoring && (
              <li>
                <T k="bb.txt.permanent_monitoring">
                  Даацын үндсэн бүтээцийн байнгын хяналт шинжилгээ хийгдэнэ.
                </T>
              </li>
            )}
          </ul>
        </section>
      )}

      {/* Drawing list — мөрийн тоо ХЯЗГААРГҮЙ тул мөр тус бүр өөрийн item. */}
      {drawingRows.some((r) => answerOf[r.key] === true) && (
        <>
          <div className="bb-doc__grp" data-a4-item>
            <Heading>
              <T k="bb.h.drawings">БАРИЛГЫН БҮТЭЭЦИЙН ЗУРГИЙН ЖАГСААЛТ</T>
            </Heading>
            <Para>
              <T k="bb.txt.drawings_intro">Тайлбар бичигт хавсаргасан зургийн төрлүүд:</T>
            </Para>
          </div>
          <ul className="bb-doc__list">
            {drawingRows.filter((r) => answerOf[r.key] === true).map((r) => (
              <li key={r.key} data-a4-item>
                {r.no}. {r.label}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Signatures */}
    </article>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="bb-doc__heading">{children}</h2>;
}

function Para({ children }: { children: React.ReactNode }) {
  return <p className="bb-doc__para">{children}</p>;
}

/* Inline CSS — same look as BA but a different class prefix so the
 * two docs can render side-by-side without colliding. */
export const BB_REPORT_STYLES = `
.bb-doc { font-family: "Arial", Helvetica, sans-serif; color: #111; line-height: 1.55; max-width: 760px; margin: 0 auto; padding: 0 16px; }
.bb-doc__title { text-align: center; font-size: 18pt; font-weight: 700; margin: 0; letter-spacing: 0.06em; }
.bb-doc__subtitle { text-align: center; font-size: 12pt; font-weight: 600; margin: 4px 0 18px; letter-spacing: 0.08em; color: #444; }
.bb-doc__meta { margin-bottom: 18px; }
.bb-doc__meta-row { font-size: 11pt; margin: 2px 0; }
.bb-doc__meta-label { font-weight: 600; }
.bb-doc__heading { font-size: 12pt; font-weight: 700; text-transform: uppercase; margin: 18px 0 6px; letter-spacing: 0.04em; border-bottom: 1px solid #999; padding-bottom: 3px; }
.bb-doc__para { font-size: 11pt; margin: 6px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
.bb-doc__list { font-size: 11pt; margin: 6px 0 6px 18px; padding: 0; }
/* Үргэлжилсэн бичвэр — хоёр талаар тэгшилнэ.  «text-align-last: left» нь
 * сүүлийн мөрийг сунгахгүй.  Монгол бичвэрт «hyphens» ТАВИХГҮЙ — үг
 * таслах дүрэм байхгүй тул буруу таслана. */
.bb-doc__list li { margin: 2px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
/* ЗАЛГАА тодорхойлолтын мөрүүдийн хооронд харагдахуйц зай.  Дэлгэц ба
 * хэвлэл хоёуланд үйлчилнэ («+» тул эхний мөрөнд зай нэмэгдэхгүй). */
.bb-doc__list li + li { margin-top: 0.5em; }
/* Хуудаслалтын бүлэг (data-a4-item).  Гарчгийн дээд зайг БҮЛЭГ өөртөө
 * авна — эс бөгөөс эхний хүүхдийн margin эцэг рүүгээ "collapse through"
 * болж, A4Paginator-ийн margin-top түлхэлт тэр хэмжээгээр дутна. */
.bb-doc__grp { margin-top: 18px; }
.bb-doc__grp > .bb-doc__heading { margin-top: 0; }
.bb-doc__signatures { margin-top: 32px; font-size: 11pt; }
.bb-doc__sig-row { display: flex; gap: 24px; margin-top: 18px; flex-wrap: wrap; }
.bb-doc__sig-cell { flex: 1; min-width: 200px; }
.bb-doc__sig-role { font-weight: 600; margin-bottom: 24px; }
.bb-doc__sig-line { border-bottom: 1px solid #444; padding-bottom: 2px; min-height: 22px; }
.bb-doc__sig-meta { font-size: 10pt; color: #555; margin-top: 4px; }
@media print {
  .bb-doc { max-width: none; padding: 0; }
  .bb-doc__heading { break-after: avoid; }
  .bb-doc__para, .bb-doc__list { break-inside: avoid-page; }
}
`;
