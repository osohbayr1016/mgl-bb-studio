import { T } from '@/features/performance-reports/lib/reportText';
import type { BaReportAnswers } from '@/features/projects/team-reports/ba/types';
import { makeDocHelpers, type DocMode } from '@/features/projects/team-reports/docHelpers';
import { useDrawingRows } from '@/features/projects/team-reports/drawingList';

/* =============================================================
 * BA report printable document.
 * -------------------------------------------------------------
 * Walks the answers and produces the formatted Тайлбар бичиг text.
 *
 * Two rendering modes (see ../docHelpers):
 *   • internal (default) — empty fields render as "_____" so the
 *     unfilled gaps match the original paper template; seniors see
 *     what's still missing in the in-app preview / internal print.
 *   • client — the deliverable PDF sent to the client. Empty values
 *     and the rows/sections they belong to are hidden entirely, so
 *     uncertain-and-skipped fields never show as "_____" or dangling
 *     labels. Static narrative (the standard descriptive paragraphs)
 *     is kept regardless.
 *
 * ---------------------------------------------------------------
 * A4 ХУУДАСЛАЛТ (`data-a4-item`)
 * ---------------------------------------------------------------
 * Гүйцэтгэлийн тайлангийн WYSIWYG урьдчилан харах (`A4Paginator`) нь
 * `[data-a4-item]` элементүүдийг хэмжиж, хуудасны заагт унасныг нь
 * `margin-top`-оор дараагийн хуудас руу түлхдэг.  Энэ файлд түүнийг
 * дараах ТҮВШИНД тавьсан:
 *
 *   • гарчиг ГАНЦААРАА хэзээ ч item болохгүй — үргэлж дараагийн догол
 *     мөр / богино жагсаалт / хүснэгттэйгээ `.ba-doc__group` дотор
 *     нэгдэнэ (эс бөгөөс гарчиг хуудасны ёроолд ганцаараа үлдэнэ);
 *   • урт, тоо нь тодорхойгүй жагсаалтын `<li>` бүр ТУС ТУСДАА item —
 *     бүтэн `<ul>`-ыг нэг item болговол хагас хуудас хоосон үлдэнэ;
 *   • хүснэгт БҮХЭЛДЭЭ нэг item.  `<tr>`-д `margin-top` НЭВТЭРДЭГГҮЙ
 *     тул мөр бүрд item тавих нь түлхэлтгүй атлаа пагинаторын дотоод
 *     `shift`-ийг гажуудуулна — ЗӨВХӨН хүснэгтийн түвшинд тавина.
 *
 * ⚠️ ҮҮРЛЭСЭН item байж БОЛОХГҮЙ: `.ba-doc__group` дотор орсон `<li>` /
 * `<p>`-д `data-a4-item` тавихгүй (пагинатор гаднахыг нь л тооцно).
 *
 * ---------------------------------------------------------------
 * ЗАСВАРЛАГДАХ СТАТИК ТЕКСТ (`<T>`)
 * ---------------------------------------------------------------
 * Харагдах статик литерал бүрийг `<T k="ba.…">…</T>`-ээр ороосон тул
 * Гүйцэтгэлийн тайлангийн засварлагчид дарж засах боломжтой.  Багийн
 * тайлангийн таб дээр `ReportTextContext` provider БАЙХГҮЙ учир `T` нь
 * энгийн текст рүү уначих бөгөөд харагдац ЯГ ХЭВЭЭР үлдэнэ.
 *
 * ⚠️ Түлхүүрийг бүү сольж нэрлэ — хадгалагдсан override түлхүүрээрээ
 * холбогддог тул нэр солих нь хэрэглэгчийн засварыг чимээгүй хаяна.
 * ============================================================= */

const FOUNDATION_LABEL: Record<string, string> = {
  mat: 'нил хавтан суурь',
  cup: 'аяган суурь',
  strip: 'шугаман суурь',
};

const EXT_FINISH_LABEL: Record<string, string> = {
  metal_cladding: 'хөнгөн цагаан металл хавтан систем',
  glass_facade: '3 давхар шилэн фасад',
  stone_cladding: 'байгалийн чулуун хавтан',
};

const GLAZED_LABEL: Record<string, string> = {
  metal_3layer_vacuum: 'металл рамтай 3 давхар вакуум',
  unitized_2layer: 'юнитайз, 2 давхар',
};

const WINDOW_LABEL: Record<string, string> = {
  metal_3layer_vacuum: 'металл рамтай 3 давхар вакуум',
  pvc_vacuum: 'хуванцар рамтай вакуум',
};

/** Ordered table-of-contents for the architectural drawing set. The
 *  document only renders the rows whose `key` is ticked, but always
 *  keeps the original 1..21 numbering so the printed list reads as
 *  "5. Давхрын байгуулалт" not "1. Давхрын байгуулалт" when earlier
 *  items are unticked.  Mirrors DRAWING_LIST_SECTION in template.ts. */
const DRAWING_LIST_ROWS: Array<{ no: number; key: keyof BaReportAnswers; label: string }> = [
  { no: 1, key: 'dl_cover', label: 'Нүүр хуудас' },
  { no: 2, key: 'dl_general_plan', label: 'Ерөнхий төлөвлөгөө, зай хэмжээ, тохижилт, картограмм' },
  { no: 3, key: 'dl_drawing_list', label: 'Зургийн жагсаалт' },
  { no: 4, key: 'dl_explanatory_note', label: 'Тайлбар бичиг' },
  { no: 5, key: 'dl_floor_plans', label: 'Давхрын байгуулалтууд' },
  { no: 6, key: 'dl_roof_plan', label: 'Дээврийн байгуулалт' },
  { no: 7, key: 'dl_sections', label: 'Огтлолууд' },
  { no: 8, key: 'dl_facades', label: 'Нүүр талууд' },
  { no: 9, key: 'dl_bathroom', label: 'Ариун цэврийн өрөөний хэсэглэл, дэлгээс' },
  { no: 10, key: 'dl_door_window', label: 'Цонх, хаалганы схем, бүтэц, түүвэр' },
  { no: 11, key: 'dl_glass_wall', label: 'Шилэн ханын нэгдсэн түүвэр' },
  { no: 12, key: 'dl_system_detail', label: 'Систем деталь' },
  { no: 13, key: 'dl_wall_section', label: 'Ханын хэсэглэл' },
  { no: 14, key: 'dl_floor_assembly', label: 'Шалны байгуулалтууд' },
  { no: 15, key: 'dl_floor_ceiling_detail', label: 'Шал, таазны хийц, бүтэц, түүвэр' },
  { no: 16, key: 'dl_ceiling_assembly', label: 'Таазны байгуулалтууд' },
  { no: 17, key: 'dl_elevator', label: 'Цахилгаан шат, шатны хэсэглэл' },
  { no: 18, key: 'dl_outdoor_porch', label: 'Гадна довжоо, шатны хэсэглэл' },
  { no: 19, key: 'dl_fire_stair', label: 'Галын шатны хэсэглэл' },
  { no: 20, key: 'dl_technology', label: 'Технологийн байгуулалтууд' },
  { no: 21, key: 'dl_other', label: 'Бусад нарийн хэсэглэл' },
];

interface BaReportDocumentProps {
  answers: BaReportAnswers;
  buildingType: 'rc' | 'steel';
  mode?: DocMode;
}

export function BaReportDocument({
  answers,
  buildingType,
  mode = 'internal',
}: BaReportDocumentProps) {
  const { v, withSuffix, has, show } = makeDocHelpers(mode);
  const drawingRows = useDrawingRows('BA', DRAWING_LIST_ROWS);
  const answerOf = answers as Record<string, unknown>;
  /** Label fallback for an enum value: shows the prompt blank in internal,
   *  nothing in client (the row is gated separately). */
  const blank = mode === 'client' ? '' : '_____';

  return (
    <article className="ba-doc">
      <h1 className="ba-doc__title" data-a4-item>
        <T k="ba.title">ТАЙЛБАР БИЧИГ</T>
      </h1>

      {/* Climate — only render if at least one value is filled.  All values
          are stored as strings to preserve the "-0.5" / "+33.8" formatting
          coming out of the preset button. */}
      {(answers.climate_temp_avg_annual ||
        answers.climate_temp_max ||
        answers.climate_temp_min ||
        answers.climate_snow_load ||
        answers.climate_zone) && (
        <>
          <Group>
            <Heading>
              <T k="ba.h.climate">УУР АМЬСГАЛЫН ҮЗҮҮЛЭЛТ</T>
            </Heading>
            <Para item={false}>
              <T k="ba.climate.txt.lead">
                Барилгад хэрэглэх цаг уур амьсгал ба геофизикийн үзүүлэлт
              </T>{' '}
              <strong>
                <T k="ba.climate.txt.code">БНбД 23-01-09</T>
              </strong>{' '}
              {answers.climate_station ? <>{answers.climate_station}-ын</> : ''}{' '}
              <T k="ba.climate.txt.tail">үзүүлэлтээр дараах байдалтай:</T>
            </Para>
          </Group>
          <ul className="ba-doc__list">
            {answers.climate_temp_avg_annual && (
              <li data-a4-item>
                <T k="ba.climate.lbl.temp_avg_annual">Гадна агаарын жилийн дундаж температур:</T>{' '}
                <strong>
                  {answers.climate_temp_avg_annual}
                  <T k="ba.climate.unit.temp_avg_annual">°C</T>
                </strong>
              </li>
            )}
            {answers.climate_temp_max && (
              <li data-a4-item>
                <T k="ba.climate.lbl.temp_max">Үнэмлэхүй хамгийн их температур:</T>{' '}
                <strong>
                  {answers.climate_temp_max}
                  <T k="ba.climate.unit.temp_max">°C</T>
                </strong>
              </li>
            )}
            {answers.climate_temp_july_max_avg && (
              <li data-a4-item>
                <T k="ba.climate.lbl.temp_july_max_avg">YII сарын үнэмлэхүй их дундаж:</T>{' '}
                <strong>
                  {answers.climate_temp_july_max_avg}
                  <T k="ba.climate.unit.temp_july_max_avg">°C</T>
                </strong>
              </li>
            )}
            {answers.climate_temp_min && (
              <li data-a4-item>
                <T k="ba.climate.lbl.temp_min">Үнэмлэхүй хамгийн бага температур:</T>{' '}
                <strong>
                  {answers.climate_temp_min}
                  <T k="ba.climate.unit.temp_min">°C</T>
                </strong>
              </li>
            )}
            {answers.climate_temp_jan_min_avg && (
              <li data-a4-item>
                <T k="ba.climate.lbl.temp_jan_min_avg">I сарын үнэмлэхүй бага дундаж:</T>{' '}
                <strong>
                  {answers.climate_temp_jan_min_avg}
                  <T k="ba.climate.unit.temp_jan_min_avg">°C</T>
                </strong>
              </li>
            )}
            {answers.climate_temp_heating_avg && (
              <li data-a4-item>
                <T k="ba.climate.lbl.temp_heating_avg">Халаалтын улирлын дундаж:</T>{' '}
                <strong>
                  {answers.climate_temp_heating_avg}
                  <T k="ba.climate.unit.temp_heating_avg">°C</T>
                </strong>
              </li>
            )}
            {answers.climate_heating_grad && (
              <li data-a4-item>
                <T k="ba.climate.lbl.heating_grad">Халаалтын улирлын эрчим:</T>{' '}
                <strong>
                  {answers.climate_heating_grad}{' '}
                  <T k="ba.climate.unit.heating_grad">°C·өдөр</T>
                </strong>
              </li>
            )}
            {answers.climate_precip_annual && (
              <li data-a4-item>
                <T k="ba.climate.lbl.precip_annual">Хур тунадасны жилийн дундаж хэмжээ:</T>{' '}
                <strong>
                  {answers.climate_precip_annual} <T k="ba.climate.unit.precip_annual">мм</T>
                </strong>
              </li>
            )}
            {answers.climate_wind_avg && (
              <li data-a4-item>
                <T k="ba.climate.lbl.wind_avg">Салхины жилийн дундаж хурд:</T>{' '}
                <strong>
                  {answers.climate_wind_avg} <T k="ba.climate.unit.wind_avg">м/с</T>
                </strong>
              </li>
            )}
            {answers.climate_temp_soil_avg && (
              <li data-a4-item>
                <T k="ba.climate.lbl.temp_soil_avg">Хөрсний гадаргын жилийн дундаж:</T>{' '}
                <strong>
                  {answers.climate_temp_soil_avg}
                  <T k="ba.climate.unit.temp_soil_avg">°C</T>
                </strong>
              </li>
            )}
            {answers.climate_wind_cold_3mo && (
              <li data-a4-item>
                <T k="ba.climate.lbl.wind_cold_3mo">Хамгийн хүйтэн 3 сарын салхины дундаж:</T>{' '}
                <strong>
                  {answers.climate_wind_cold_3mo} <T k="ba.climate.unit.wind_cold_3mo">м/с</T>
                </strong>
              </li>
            )}
            {answers.climate_snow_load && (
              <li data-a4-item>
                <T k="ba.climate.lbl.snow_load">Хэвтээ гадарга дээрх цасны ачаалал:</T>{' '}
                <strong>
                  {answers.climate_snow_load} <T k="ba.climate.unit.snow_load">кг/м²</T>
                </strong>
              </li>
            )}
            {answers.climate_zone && (
              <li data-a4-item>
                <T k="ba.climate.lbl.zone">Уур амьсгалын бүс:</T>{' '}
                <strong>{answers.climate_zone}</strong>
              </li>
            )}
            {answers.climate_wind_5yr_pressure && (
              <li data-a4-item>
                <T k="ba.climate.lbl.wind_5yr_pressure">5 жилд нэг удаа тохиох салхины даралт:</T>{' '}
                <strong>
                  {answers.climate_wind_5yr_pressure}{' '}
                  <T k="ba.climate.unit.wind_5yr_pressure">кг/м²</T>
                </strong>
              </li>
            )}
          </ul>
        </>
      )}

      <Group>
        <Heading>
          <T k="ba.h.gp">ЕРӨНХИЙ ТӨЛӨВЛӨГӨӨ</T>
        </Heading>
        <Para item={false}>
          <T k="ba.gp.txt.lead">
            Барилгын ерөнхий төлөвлөгөөг газар олголт, техникийн нөхцөлийг харгалзан
          </T>
          {has(answers.gp_alignment_with) ? (
            <>
              , {v(answers.gp_alignment_with)}
              <T k="ba.gp.txt.align_suffix">-тэй уялдуулан</T>
            </>
          ) : (
            ''
          )}{' '}
          <T k="ba.gp.txt.tail">эдэлбэр газарт нормын дагуу боловсруулсан.</T>
        </Para>
      </Group>
      {(show(answers.gp_main_entrance_count, answers.gp_main_entrance_side) ||
        show(answers.gp_service_entrance_count) ||
        show(answers.gp_parking_entrance_count) ||
        show(answers.gp_ramp_count)) && (
        <ul className="ba-doc__list">
          {show(answers.gp_main_entrance_count, answers.gp_main_entrance_side) && (
            <li data-a4-item>
              <T k="ba.gp.lbl.main_entrance">Үндсэн орц:</T>{' '}
              {withSuffix(answers.gp_main_entrance_count, 'ширхэг')}
              {has(answers.gp_main_entrance_side) && (
                <>
                  {' '}
                  ({v(answers.gp_main_entrance_side)} <T k="ba.gp.lbl.side">талаас</T>)
                </>
              )}
            </li>
          )}
          {show(answers.gp_service_entrance_count) && (
            <li data-a4-item>
              <T k="ba.gp.lbl.service_entrance">Туслах орц:</T>{' '}
              {withSuffix(answers.gp_service_entrance_count, 'ширхэг')}
            </li>
          )}
          {show(answers.gp_parking_entrance_count) && (
            <li data-a4-item>
              <T k="ba.gp.lbl.parking_entrance">Авто зогсоолын орц гарц:</T>{' '}
              {withSuffix(answers.gp_parking_entrance_count, 'ширхэг')}
            </li>
          )}
          {show(answers.gp_ramp_count) && (
            <li data-a4-item>
              <T k="ba.gp.lbl.ramp">ХБИ-д зориулсан налуу пандус:</T>{' '}
              {withSuffix(answers.gp_ramp_count, 'ширхэг')}
            </li>
          )}
        </ul>
      )}

      <Group>
        <Heading>
          <T k="ba.h.plan">ТӨЛӨВЛӨЛТ / АРХИТЕКТУР ТӨЛӨВЛӨЛТ</T>
        </Heading>
        <Para item={false}>
          <T k="ba.plan.txt.intro">
            Барилгын үндсэн төлөвлөлтийг Монгол улсад мөрдөж буй холбогдох норм дүрэм, стандартын
            шаардлагыг баримтлан захиалагчийн саналыг тусгаж тухайн орон зайд зохицсон байхаар
            шийдсэн.
          </T>
        </Para>
      </Group>

      {answers.plan_layout_kind === 'multi' ? (
        /* Удиртгал өгүүлбэр + блокийн хүснэгт = НЭГ A4 нэгж.  Хүснэгтийн
         * `<tr>`-д margin ажилладаггүй тул мөр бүрд item тавьж болохгүй. */
        <div className="ba-doc__keep" data-a4-item>
          <Para item={false}>
            <T k="ba.plan.txt.blocks_pre">Төлөвлөж буй барилга нь</T>{' '}
            {(answers.plan_blocks ?? []).length}{' '}
            <T k="ba.plan.txt.blocks_post">блокоос бүрдэнэ:</T>
          </Para>
          <table className="ba-doc__table">
            <thead>
              <tr>
                <th>
                  <T k="ba.plan.col.block">Блок</T>
                </th>
                <th>
                  <T k="ba.plan.col.dimensions">Тэнхлэгийн хэмжээ</T>
                </th>
                <th>
                  <T k="ba.plan.col.height">Өндөр</T>
                </th>
                <th>
                  <T k="ba.plan.col.floors">Давхрын тоо</T>
                </th>
                <th>
                  <T k="ba.plan.col.purpose">Зориулалт</T>
                </th>
              </tr>
            </thead>
            <tbody>
              {(answers.plan_blocks ?? []).map((b, i) => (
                <tr key={i}>
                  <td>{v(b.name)}</td>
                  <td>{v(b.dimensions)}</td>
                  <td>{v(b.height)}</td>
                  <td>{v(b.floors)}</td>
                  <td>{v(b.purpose)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="ba-doc__list">
          <li data-a4-item>
            <T k="ba.plan.lbl.structure">Барилгын хийц:</T>{' '}
            {buildingType === 'rc' ? (
              <T k="ba.plan.val.rc_frame">төмөр бетон цутгамал каркас</T>
            ) : (
              <T k="ba.plan.val.steel_frame">металл каркас</T>
            )}
          </li>
          {show(answers.plan_dimensions) && (
            <li data-a4-item>
              <T k="ba.plan.lbl.dimensions">Хэмжээ (тэнхлэгээр):</T> {v(answers.plan_dimensions)}
            </li>
          )}
          {show(answers.plan_basement_floors) && (
            <li data-a4-item>
              <T k="ba.plan.lbl.basement_floors">Зоорийн давхар:</T>{' '}
              {withSuffix(answers.plan_basement_floors, 'давхар')}
            </li>
          )}
          {show(answers.plan_above_ground_floors) && (
            <li data-a4-item>
              <T k="ba.plan.lbl.above_ground_floors">Газраас дээш давхар:</T>{' '}
              {withSuffix(answers.plan_above_ground_floors, 'давхар')}
            </li>
          )}
        </ul>
      )}

      {answers.plan_main_structure_notes && (
        <Para>
          <strong>
            <T k="ba.plan.lbl.main_structure">Үндсэн бүтээц:</T>
          </strong>{' '}
          {answers.plan_main_structure_notes}
        </Para>
      )}

      {(answers.plan_floor_purposes ?? []).length > 0 && (
        <>
          {/* Давхрын тоо тодорхойгүй (30 давхар ч байж болно) тул удиртгал
              мөр ба жагсаалтыг НЭГ item болгосонгүй — мөр бүр тусдаа. */}
          <Para>
            <strong>
              <T k="ba.plan.lbl.floor_purposes">Давхар бүрийн зориулалт:</T>
            </strong>
          </Para>
          <ul className="ba-doc__list">
            {(answers.plan_floor_purposes ?? []).map((f, i) => (
              <li key={i} data-a4-item>
                {v(f.floor)}: {v(f.purpose)}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Гарчиг + 3-4 мөрийн ТОГТМОЛ жагсаалт = нэг item (гарчиг ганцаараа
          хуудасны ёроолд үлдэхгүй; жагсаалт хэзээ ч A4-ээс урт болохгүй). */}
      <Group>
        <Heading>
          <T k="ba.h.struct">БАРИЛГЫН БҮТЭЭЦ</T>
        </Heading>
        {buildingType === 'rc' ? (
          <ul className="ba-doc__list">
            <li>
              <T k="ba.struct.lbl.main">Үндсэн хийц:</T>{' '}
              {withSuffix(answers.rc_wall_thickness, 'мм')}{' '}
              <T k="ba.struct.txt.rc_main_tail">
                төмөр бетон ханатай төмөр бетон каркас хийцтэй, ρ = 2500 кг/м³.
              </T>
            </li>
            <li>
              <T k="ba.struct.lbl.foundation">Суурь:</T>{' '}
              {answers.rc_foundation_type
                ? (FOUNDATION_LABEL[answers.rc_foundation_type] ?? blank)
                : blank}
              , <T k="ba.struct.txt.rc_foundation_tail">ρ = 2500 кг/м³.</T>
            </li>
            <li>
              <T k="ba.struct.lbl.slab">Хучилт:</T>{' '}
              {withSuffix(answers.rc_slab_thickness, 'мм')}{' '}
              <T k="ba.struct.txt.rc_slab_tail">цутгамал төмөр бетон, ρ = 2500 кг/м³.</T>
            </li>
          </ul>
        ) : (
          <ul className="ba-doc__list">
            <li>
              <T k="ba.struct.txt.steel_main">Үндсэн хийц: металл каркас хийцтэй.</T>
            </li>
            <li>
              <T k="ba.struct.lbl.steel_basement">Зоорийн давхар:</T>{' '}
              {v(answers.steel_basement_floor)}{' '}
              <T k="ba.struct.txt.steel_basement_tail">давхарт төмөр бетон.</T>
            </li>
            <li>
              <T k="ba.struct.txt.steel_foundation">Суурь: төмөр бетон шугаман суурь.</T>
            </li>
            <li>
              <T k="ba.struct.lbl.slab">Хучилт:</T>{' '}
              {withSuffix(answers.steel_slab_thickness, 'мм')}{' '}
              <T k="ba.struct.txt.steel_slab_tail">металл тавцантай төмөр бетон.</T>
            </li>
          </ul>
        )}
      </Group>

      <Group>
        <Heading>
          <T k="ba.h.roof">ДЭЭВЭР</T>
        </Heading>
        <Para item={false}>
          <T k="ba.roof.txt.intro">
            Дотуур ус зайлуулах систем бүхий хавтгай дээвэртэй байна. Дээврийн налуулга, усны хаялгыг
            ЕТ-маркын зургаас, ашиглалттай дээврийн зургийг тохижилтын ажлын зургаас үзнэ үү.
          </T>
        </Para>
      </Group>
      {buildingType === 'rc' ? (
        <ul className="ba-doc__list">
          <li data-a4-item>
            {withSuffix(answers.roof_xps_thickness, 'мм')}{' '}
            <T k="ba.roof.txt.rc_xps">XPS пеноплекс дулаалга.</T>
          </li>
          <li data-a4-item>
            {withSuffix(answers.roof_screed_thickness, 'мм')}
            <T k="ba.roof.txt.rc_screed">-ээс багагүй тортой бетон тэгшилгээ.</T>
          </li>
          <li data-a4-item>
            <T k="ba.roof.txt.rc_membrane">Полимер мембран.</T>
          </li>
        </ul>
      ) : (
        <ul className="ba-doc__list">
          <li data-a4-item>
            <T k="ba.roof.txt.steel_base">Металл тавцантай төмөр бетон суурь.</T>
          </li>
          <li data-a4-item>
            <T k="ba.roof.txt.steel_membrane">
              Уур, ус тусгаарлах полимер мембран (үйлдвэрлэгчийн технологийн дагуу).
            </T>
          </li>
          <li data-a4-item>
            {v(answers.roof_xps_range_from)} – {v(answers.roof_xps_range_to)}{' '}
            <T k="ba.roof.txt.steel_xps_range">мм XPS хөөсөнцөр дулаалга.</T>
          </li>
          <li data-a4-item>
            {v(answers.roof_eps_range_from)} – {v(answers.roof_eps_range_to)}{' '}
            <T k="ba.roof.txt.steel_eps_range">мм EPS хөөсөнцөр (ус зайлуулах налуулгад).</T>
          </li>
          <li data-a4-item>
            {withSuffix(answers.roof_concrete_screed_thickness, 'мм')}{' '}
            <T k="ba.roof.txt.steel_screed">зузаан бетон тэгшилгээ.</T>
          </li>
          <li data-a4-item>
            <T k="ba.roof.txt.steel_paint">Дээврийн зориулалттай уур, ус тусгаарлах будаг.</T>
          </li>
        </ul>
      )}
      {answers.roof_usable && (
        <ul className="ba-doc__list">
          <li data-a4-item>
            <T k="ba.roof.txt.usable_keramzit">Керамзит бетон дүүргэгч.</T>
          </li>
          <li data-a4-item>
            {withSuffix(answers.roof_usable_sand_thickness, 'мм')}{' '}
            <T k="ba.roof.txt.usable_sand">элс.</T>
          </li>
          <li data-a4-item>
            <T k="ba.roof.txt.usable_stone">Чулуун хавтан өнгөлгөө.</T>
          </li>
        </ul>
      )}

      <Group>
        <Heading>
          <T k="ba.h.ext">ГАДНА ХАНА</T>
        </Heading>
        <Para item={false}>
          <strong>
            <T k="ba.ext.lbl.basement">Зоорийн давхрын гадна хана (хөрстэй уулзах хэсэг):</T>
          </strong>
        </Para>
      </Group>
      <ul className="ba-doc__list">
        <li data-a4-item>
          {withSuffix(answers.basement_rc_wall_thickness, 'мм')}{' '}
          <T k="ba.ext.txt.basement_rc">цутгамал төмөр бетон.</T>
        </li>
        <li data-a4-item>
          <T k="ba.ext.txt.basement_vapor">Уур, чийг тусгаарлах түрхлэг.</T>
        </li>
        <li data-a4-item>
          {withSuffix(answers.basement_xps_thickness, 'мм')}{' '}
          <T k="ba.ext.txt.basement_xps">XPS пеноплекс хавтан дулаалга (нягт ≈ 40 кг/м³).</T>
        </li>
        {answers.basement_konkrevol_thickness && (
          <li data-a4-item>
            <T k="ba.ext.txt.konkrevol">Суурийн конкреволл хавтан</T>{' '}
            {withSuffix(answers.basement_konkrevol_thickness, 'мм')}.
          </li>
        )}
        <li data-a4-item>
          <T k="ba.ext.txt.geoplanter">Хөрсний ус тусгаарлах геоплантер мембран.</T>
        </li>
      </ul>

      {/* Удиртгал мөр + 4 мөрийн тогтмол жагсаалт = нэг item, эс бөгөөс
          «Газрын түвшнээс дээш гадна хана:» гэсэн мөр ганцаараа хуудасны
          ёроолд үлдэж, жагсаалт нь дараагийн хуудаснаас эхэлнэ. */}
      <div className="ba-doc__group ba-doc__group--para" data-a4-item>
        <Para item={false}>
          <strong>
            <T k="ba.ext.lbl.above_ground">Газрын түвшнээс дээш гадна хана:</T>
          </strong>
        </Para>
        {buildingType === 'rc' ? (
          <ul className="ba-doc__list">
            <li>
              {withSuffix(answers.ext_rc_thickness, 'мм')}{' '}
              <T k="ba.ext.txt.rc_concrete">цутгамал төмөр бетон</T> /{' '}
              {withSuffix(answers.ext_masonry_thickness, 'мм')}{' '}
              <T k="ba.ext.txt.rc_masonry">хүчитгэлтэй өрлөгөн хана.</T>
            </li>
            <li>
              <T k="ba.ext.txt.rc_vapor">Уур, чийг тусгаарлагч.</T>
            </li>
            <li>
              {withSuffix(answers.ext_stone_wool_thickness, 'мм')}{' '}
              <T k="ba.ext.txt.rc_stone_wool">эрдэс чулуун хөвөн дулаалга (нягт ≈ 100 кг/м³).</T>
            </li>
            <li>
              <T k="ba.ext.lbl.finish">Өнгөлгөө:</T>{' '}
              {answers.ext_finish_kind
                ? (EXT_FINISH_LABEL[answers.ext_finish_kind] ?? blank)
                : blank}
              {answers.ext_finish_kind === 'stone_cladding' && (
                <>
                  {' '}
                  ({withSuffix(answers.ext_stone_thickness, 'мм')}{' '}
                  <T k="ba.ext.txt.stone_thick">зузаан</T>)
                </>
              )}
              .
            </li>
          </ul>
        ) : (
          <ul className="ba-doc__list">
            <li>
              <T k="ba.ext.txt.sandwich_pre">1 давхраас дээш нийт</T>{' '}
              {withSuffix(answers.sandwich_total_thickness, 'мм')}{' '}
              <T k="ba.ext.txt.sandwich_post">зузаантай сэндвич хавтан.</T>
            </li>
            <li>
              <T k="ba.ext.txt.sandwich_std">
                Сэндвич хавтан нь MNS 6227:2010, GB/T 23932-2009 шаардлага хангасан байна.
              </T>
            </li>
            <li>
              <T k="ba.ext.lbl.outer_metal">Гадна металл лист:</T>{' '}
              {withSuffix(answers.sandwich_outer_metal, 'мм')}{' '}
              <T k="ba.ext.txt.outer_metal_tail">зузаан.</T>
            </li>
            <li>
              <T k="ba.ext.lbl.inner_metal">Дотор металл лист:</T>{' '}
              {withSuffix(answers.sandwich_inner_metal, 'мм')}{' '}
              <T k="ba.ext.txt.inner_metal_tail">зузаан, өнгө цагаан.</T>
            </li>
          </ul>
        )}
      </div>
      {show(answers.ext_heat_resistance_target, answers.facade_heat_resistance_target) && (
        <Para>
          <T k="ba.ext.txt.heat_pre">Гадна ханын дулаан дамжуулалтын эсэргүүцэл ≤</T>{' '}
          {v(answers.ext_heat_resistance_target)}{' '}
          <T k="ba.ext.txt.heat_mid">
            итгэлцүүр, шилэн фасадны дулаан дамжуулалтын эсэргүүцэл ≥
          </T>{' '}
          {v(answers.facade_heat_resistance_target)}{' '}
          <T k="ba.ext.txt.heat_tail">байхаар ХАС-ын тооцоонд тусгасан.</T>
        </Para>
      )}

      {/* Гарчиг + 4 мөрийн тогтмол жагсаалт = нэг item. */}
      <Group>
        <Heading>
          <T k="ba.h.int">ДОТОР ХАНА / ХАМАР ХАНА</T>
        </Heading>
        {buildingType === 'rc' ? (
          <ul className="ba-doc__list">
            <li>
              <T k="ba.int.lbl.basement">Зоорийн давхрын дотор хана:</T>{' '}
              {v(answers.int_basement_min)} – {v(answers.int_basement_max)}{' '}
              <T k="ba.int.txt.basement_tail">мм өрөг бүтэцтэй.</T>
            </li>
            <li>
              <T k="ba.int.lbl.apartment">Айл хооронд тусгаарлах хана: 2 талдаа засалттай</T>{' '}
              {withSuffix(answers.int_apartment_thickness, 'мм')}{' '}
              <T k="ba.int.txt.apartment_tail">блокон өрөг.</T>
            </li>
            <li>
              <T k="ba.int.lbl.bedroom">Унтлагын / зочны өрөө хооронд:</T>{' '}
              {withSuffix(answers.int_bedroom_thickness, 'мм')}{' '}
              <T k="ba.int.txt.bedroom_tail">тоосгон өрөг.</T>
            </li>
            <li>
              <T k="ba.int.lbl.bathroom">Ариун цэврийн өрөө: керамик хавтан өнгөлгөөтэй</T>{' '}
              {withSuffix(answers.int_bathroom_thickness, 'мм')}{' '}
              <T k="ba.int.txt.bathroom_tail">тоосгон өрлөг хана.</T>
            </li>
          </ul>
        ) : (
          <ul className="ba-doc__list">
            <li>
              <T k="ba.int.lbl.steel_main">Үндсэн дотор хамар хана:</T>{' '}
              {withSuffix(answers.int_sandwich_thickness, 'мм')}{' '}
              <T k="ba.int.txt.steel_main_tail">зузаантай металл хүчитгэлтэй сэндвич хавтан.</T>
            </li>
            <li>
              <T k="ba.int.lbl.cold_room">Хөргүүртэй агуулах / хөлдөөх кабины хана:</T>{' '}
              {withSuffix(answers.int_cold_room_thickness, 'мм')}{' '}
              <T k="ba.int.txt.cold_room_tail">зузаантай тусгай сэндвич хавтан.</T>
            </li>
            <li>
              <T k="ba.int.lbl.fire_sandwich">Шарах шүүгээний хана:</T>{' '}
              {withSuffix(answers.int_fire_sandwich_thickness, 'мм')}{' '}
              <T k="ba.int.txt.fire_sandwich_tail">
                чулуун хөвөн тусгаарлагчтай галд тэсвэртэй сэндвич хавтан.
              </T>
            </li>
            <li>
              <T k="ba.int.txt.wet_room">
                Ариун цэврийн өрөө / устай харьцах хэсэг: КНАУФ С112 системийн гипсэн хана, замаскан
                тэгшилгээ + будаг.
              </T>
            </li>
          </ul>
        )}
      </Group>

      <Group>
        <Heading>
          <T k="ba.h.glass">ШИЛЭН ФАСАД, ЦОНХ</T>
        </Heading>
        <Para item={false}>
          <T k="ba.glass.txt.pre">Шилэн фасад нь</T>{' '}
          {answers.glazed_facade_kind ? (GLAZED_LABEL[answers.glazed_facade_kind] ?? blank) : blank}{' '}
          <T k="ba.glass.txt.post">
            хийцтэй. Дулаан дамжуулалтын утга нь БНбД 25-01-20-д заасан утгаас ихгүй байхаар захиалж
            хийнэ.
          </T>
        </Para>
      </Group>
      <ul className="ba-doc__list">
        {show(answers.glass_frame_u) && (
          <li data-a4-item>
            <T k="ba.glass.lbl.frame_u">Шилэн ханын рам U:</T> {v(answers.glass_frame_u)}{' '}
            <T k="ba.glass.unit.frame_u">Вт/м²°C</T>
          </li>
        )}
        {show(answers.glass_transom_u) && (
          <li data-a4-item>
            <T k="ba.glass.lbl.transom_u">Шилэн ханын трансом U:</T> {v(answers.glass_transom_u)}{' '}
            <T k="ba.glass.unit.transom_u">Вт/м²°C</T>
          </li>
        )}
        {show(answers.glass_unit_u) && (
          <li data-a4-item>
            <T k="ba.glass.lbl.unit_u">Шиллэгээ U:</T> {v(answers.glass_unit_u)}{' '}
            <T k="ba.glass.unit.unit_u">Вт/м²°C</T>
          </li>
        )}
        {answers.glazed_facade_kind === 'unitized_2layer' && (
          <>
            <li data-a4-item>
              <T k="ba.glass.lbl.outer_glass">Гадна шилний зузаан:</T>{' '}
              {withSuffix(answers.unitized_outer_glass_thickness, 'мм')}.
            </li>
            <li data-a4-item>
              <T k="ba.glass.lbl.inner_glass">Дотор шилний зузаан:</T>{' '}
              {withSuffix(answers.unitized_inner_glass_thickness, 'мм')}.
            </li>
            <li data-a4-item>
              <T k="ba.glass.lbl.light_transmission">Гэрэл нэвтрүүлэлт:</T>{' '}
              {v(answers.unitized_light_transmission)}
              <T k="ba.glass.unit.light_transmission">%.</T>
            </li>
          </>
        )}
      </ul>
      <Para>
        <T k="ba.glass.lbl.window">Цонх:</T>{' '}
        {answers.window_kind ? (WINDOW_LABEL[answers.window_kind] ?? blank) : blank}{' '}
        <T k="ba.glass.txt.window_tail">хийц.</T>
        {has(answers.window_fire_rating_hours) && (
          <>
            {' '}
            <T k="ba.glass.lbl.fire_rating">Гал тэсвэрлэлтийн хязгаар:</T>{' '}
            {v(answers.window_fire_rating_hours)} <T k="ba.glass.unit.hours">цаг.</T>
          </>
        )}
      </Para>

      <Group>
        <Heading>
          <T k="ba.h.floor">ШАЛ</T>
        </Heading>
        {buildingType === 'rc' ? (
          <Para item={false}>
            <T k="ba.floor.txt.rc">
              Бүх давхрын шалыг зурагт заасан төрөл, загвараар гүйцэтгэнэ. Серверийн болон цахилгааны
              өрөөний шал нь үндсэн хучилтаас дээш 250 мм түвшинд хөндий шалтай байна.
            </T>
          </Para>
        ) : (
          <ul className="ba-doc__list">
            <li>
              <T k="ba.floor.lbl.deck">Хучилт:</T>{' '}
              {withSuffix(answers.floor_metal_deck_thickness, 'мм')}{' '}
              <T k="ba.floor.txt.deck_tail">зузаантай металл тавцантай ТБ шал.</T>
            </li>
            <li>
              <T k="ba.floor.lbl.screed">Бетон тэгшилгээ:</T>{' '}
              {v(answers.floor_screed_thickness_min)} – {v(answers.floor_screed_thickness_max)}{' '}
              <T k="ba.floor.unit.screed">мм.</T>
            </li>
            <li>
              <T k="ba.floor.lbl.hollow">Хөндий шал:</T>{' '}
              {withSuffix(answers.floor_hollow_thickness, 'мм')}.
            </li>
          </ul>
        )}
      </Group>
      <Para>
        <T k="ba.floor.txt.bathroom">
          Ариун цэврийн өрөөний шал нь бусдын түвшингээс 30 мм-ийн доор, ус зайлуулах траптай.
          Тэгшилгээ хийгдсэний дараа уур, ус тусгаарлах битум түрхлэг 2 үе будаж ус нэвчилтийн тест
          хийнэ.
        </T>
      </Para>

      {/* Техник эдийн засгийн үзүүлэлт — client mode prints only the rows
          that have a value (an empty bordered cell looks like a blank form);
          the whole table + heading is dropped if none are filled.
          Гарчиг + хүснэгт = НЭГ item: хамгийн ихдээ 8 мөр тул A4-д багтана,
          мөн толгой мөр агуулгаасаа салж дараагийн хуудсанд үлдэхгүй. */}
      {(mode === 'internal' ||
        has(
          answers.tez_floor_count,
          answers.tez_capacity,
          answers.tez_volume_m3,
          answers.tez_built_area_m2,
          answers.tez_useful_area_m2,
          answers.tez_working_area_m2,
          answers.tez_k1,
          answers.tez_k2,
        )) && (
        <Group>
          <Heading>
            <T k="ba.h.tez">ТЕХНИК ЭДИЙН ЗАСГИЙН ҮЗҮҮЛЭЛТ</T>
          </Heading>
          <table className="ba-doc__table">
            <thead>
              <tr>
                <th>
                  <T k="ba.tez.col.no">Д/д</T>
                </th>
                <th>
                  <T k="ba.tez.col.name">Үзүүлэлт</T>
                </th>
                <th>
                  <T k="ba.tez.col.unit">Хэмжих нэгж</T>
                </th>
                <th>
                  <T k="ba.tez.col.value">Үзүүлэлт</T>
                </th>
              </tr>
            </thead>
            <tbody>
              {show(answers.tez_floor_count) && (
                <tr>
                  <td>1</td>
                  <td>
                    <T k="ba.tez.row.floor_count">Давхрын тоо</T>
                  </td>
                  <td>
                    <T k="ba.tez.unit.floor_count">тоо</T>
                  </td>
                  <td>{v(answers.tez_floor_count)}</td>
                </tr>
              )}
              {show(answers.tez_capacity) && (
                <tr>
                  <td>2</td>
                  <td>
                    <T k="ba.tez.row.capacity">Хүчин чадал</T>
                  </td>
                  <td>
                    <T k="ba.tez.unit.capacity">айл / хүн</T>
                  </td>
                  <td>{v(answers.tez_capacity)}</td>
                </tr>
              )}
              {show(answers.tez_volume_m3) && (
                <tr>
                  <td>3</td>
                  <td>
                    <T k="ba.tez.row.volume">Барилгын эзэлхүүн</T>
                  </td>
                  <td>
                    <T k="ba.tez.unit.volume">м³</T>
                  </td>
                  <td>{v(answers.tez_volume_m3)}</td>
                </tr>
              )}
              {show(answers.tez_built_area_m2) && (
                <tr>
                  <td>4</td>
                  <td>
                    <T k="ba.tez.row.built_area">Барилгажилтын талбай</T>
                  </td>
                  <td>
                    <T k="ba.tez.unit.built_area">м²</T>
                  </td>
                  <td>{v(answers.tez_built_area_m2)}</td>
                </tr>
              )}
              {show(answers.tez_useful_area_m2) && (
                <tr>
                  <td>5</td>
                  <td>
                    <T k="ba.tez.row.useful_area">Ашигтай талбай</T>
                  </td>
                  <td>
                    <T k="ba.tez.unit.useful_area">м²</T>
                  </td>
                  <td>{v(answers.tez_useful_area_m2)}</td>
                </tr>
              )}
              {show(answers.tez_working_area_m2) && (
                <tr>
                  <td>6</td>
                  <td>
                    <T k="ba.tez.row.working_area">Ажлын талбай</T>
                  </td>
                  <td>
                    <T k="ba.tez.unit.working_area">м²</T>
                  </td>
                  <td>{v(answers.tez_working_area_m2)}</td>
                </tr>
              )}
              {show(answers.tez_k1) && (
                <tr>
                  <td>7</td>
                  <td>
                    <T k="ba.tez.row.k1">Коэффициент К1 (Sаж/Sаш)</T>
                  </td>
                  <td>—</td>
                  <td>{v(answers.tez_k1)}</td>
                </tr>
              )}
              {show(answers.tez_k2) && (
                <tr>
                  <td>8</td>
                  <td>
                    <T k="ba.tez.row.k2">Коэффициент К2</T>
                  </td>
                  <td>—</td>
                  <td>{v(answers.tez_k2)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </Group>
      )}

      {/* Architectural drawing list — keeps the original 1..21 numbering
          even when intermediate items are unticked, so the printed list
          matches the canonical TOR order rather than re-counting. */}
      {drawingRows.some((r) => answerOf[r.key] === true) && (
        <>
          <Group>
            <Heading>
              <T k="ba.h.drawings">АРХИТЕКТУРЫН ЗУРГИЙН ЖАГСААЛТ</T>
            </Heading>
            <Para item={false}>
              <T k="ba.drawings.txt.lead">Тайлбар бичигт хавсаргасан зургийн төрлүүд:</T>
            </Para>
          </Group>
          <ul className="ba-doc__list">
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

/* ─── Small layout helpers — kept inline so the document file is self-contained. ─── */

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="ba-doc__heading">{children}</h2>;
}

/** Догол мөр.  Анхдагчаар БИЕ ДААСАН A4 нэгж (`data-a4-item`); `Group`
 *  эсвэл `.ba-doc__keep` дотор орох үед `item={false}` — үүрлэсэн item
 *  байвал пагинатор гаднахыг нь л тооцдог тул дотоод нь дэмий. */
function Para({ children, item = true }: { children: React.ReactNode; item?: boolean }) {
  return (
    <p className="ba-doc__para" data-a4-item={item ? '' : undefined}>
      {children}
    </p>
  );
}

/** Гарчиг + түүнийг ДАГАСАН агуулгыг (догол мөр / богино тогтмол
 *  жагсаалт / хүснэгт) НЭГ хуваагдашгүй A4 нэгж болгоно — эс бөгөөс
 *  гарчиг хуудасны ёроолд ганцаараа үлдэнэ.
 *
 *  ⚠️ `.ba-doc__group`-ийн margin нь CSS-д ЗОРИУДААР `18px 0 0` бөгөөд
 *  эхний хүүхдийн `margin-top`-ыг тэглэдэг: ингэснээр эцэг↔хүүхдийн
 *  margin collapsing үүсэхгүй тул пагинаторын `getComputedStyle(el)
 *  .marginTop` уншилт бодит зайтай таарч, түлхэлт яг хэрэгтэй хэмжээгээр
 *  ажиллана (мөн харагдац хуучнаас 1px ч зөрөхгүй). */
function Group({ children }: { children: React.ReactNode }) {
  return (
    <div className="ba-doc__group" data-a4-item>
      {children}
    </div>
  );
}

/* Inline CSS so the document is portable: the form preview can mount it
 * inside the tab and the print page can mount it as the entire body
 * without pulling in app-wide stylesheets. */
export const BA_REPORT_STYLES = `
.ba-doc { font-family: "Arial", Helvetica, sans-serif; color: #111; line-height: 1.55; max-width: 760px; margin: 0 auto; padding: 0 16px; }
.ba-doc__title { text-align: center; font-size: 18pt; font-weight: 700; margin: 0 0 18px; letter-spacing: 0.06em; }
.ba-doc__meta { margin-bottom: 18px; }
.ba-doc__meta-row { font-size: 11pt; margin: 2px 0; }
.ba-doc__meta-label { font-weight: 600; }
.ba-doc__heading { font-size: 12pt; font-weight: 700; text-transform: uppercase; margin: 18px 0 6px; letter-spacing: 0.04em; border-bottom: 1px solid #999; padding-bottom: 3px; }
.ba-doc__para { font-size: 11pt; margin: 6px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
.ba-doc__list { font-size: 11pt; margin: 6px 0 6px 18px; padding: 0; }
/* Үргэлжилсэн бичвэр — хоёр талаар тэгшилнэ.  «text-align-last: left» нь
 * сүүлийн мөрийг сунгахгүй.  Монгол бичвэрт «hyphens» ТАВИХГҮЙ — үг
 * таслах дүрэм байхгүй тул буруу таслана. */
.ba-doc__list li { margin: 2px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
/* ЗАЛГАА тодорхойлолтын мөрүүдийн хооронд харагдахуйц зай.  Дэлгэц ба
 * хэвлэл хоёуланд үйлчилнэ («+» тул эхний мөрөнд зай нэмэгдэхгүй). */
.ba-doc__list li + li { margin-top: 0.5em; }
.ba-doc__table { width: 100%; border-collapse: collapse; font-size: 10.5pt; margin: 8px 0 12px; }
.ba-doc__table th, .ba-doc__table td { border: 1px solid #555; padding: 4px 6px; text-align: left; vertical-align: top; }
.ba-doc__table th { background: #f3f3f3; font-weight: 600; }
.ba-doc__signatures { margin-top: 32px; font-size: 11pt; }
.ba-doc__sig-row { display: flex; gap: 24px; margin-top: 18px; flex-wrap: wrap; }
.ba-doc__sig-cell { flex: 1; min-width: 200px; }
.ba-doc__sig-role { font-weight: 600; margin-bottom: 24px; }
.ba-doc__sig-line { border-bottom: 1px solid #444; padding-bottom: 2px; min-height: 22px; }
.ba-doc__sig-meta { font-size: 10pt; color: #555; margin-top: 4px; }

/* ── A4 нэгжийн бүрхүүлүүд ───────────────────────────────────────────
 * Хүрээ хайрцаг нь ДОТООД эхний элементийнхээ margin-ыг ӨӨРТӨӨ авна
 * (эхний хүүхдийн margin-top → 0).  Ингэснээр:
 *   • эцэг↔хүүхдийн margin collapsing үүсэхгүй тул A4Paginator-ийн
 *     margin-top уншилт бодит зайтай яг таарна;
 *   • дэлгэц дээрх зай хуучин (бүрхүүлгүй) хувилбартай ИЖИЛ хэвээр —
 *     Багийн тайлангийн таб дээр ямар ч өөрчлөлт харагдахгүй. */
.ba-doc__group { margin: 18px 0 0; }
.ba-doc__group > .ba-doc__heading:first-child { margin-top: 0; }
.ba-doc__group--para,
.ba-doc__keep { margin: 6px 0 0; }
.ba-doc__group--para > .ba-doc__para:first-child,
.ba-doc__keep > .ba-doc__para:first-child { margin-top: 0; }

@media print {
  .ba-doc { max-width: none; padding: 0; }
  .ba-doc__heading { break-after: avoid; }
  .ba-doc__para, .ba-doc__list, .ba-doc__table { break-inside: avoid-page; }
  /* Удиртгал өгүүлбэр + хүснэгтийг нэг бүхэл болгоно: хүснэгт дараагийн
   * хуудас руу шилжихэд өгүүлбэр нь хуудасны хамгийн доод захад орхигдож
   * footer-ийн зурвастай давхцдаг байсан (Гүйцэтгэлийн тайлангийн PDF). */
  .ba-doc__keep { break-inside: avoid; page-break-inside: avoid; }
  /* Гарчиг өөрийн агуулгаасаа салахгүй (дэлгэцийн data-a4-item-ийн
   * хэвлэлийн хос). */
  .ba-doc__group { break-inside: avoid; page-break-inside: avoid; }
}
`;
