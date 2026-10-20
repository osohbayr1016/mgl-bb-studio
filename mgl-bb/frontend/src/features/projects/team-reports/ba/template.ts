/* =============================================================
 * BA report template — pure data driving the questionnaire UI.
 * -------------------------------------------------------------
 * The form walks this list to render inputs; the document
 * component reads the same `BaReportAnswers` keys to compose
 * the final prose.  Adding a field here makes it editable; the
 * print template still has to be updated to weave it in.
 *
 * Sections + fields use the shared `SectionDef` / `FieldDef`
 * types so the generic AccordionForm renderer can consume them
 * unchanged — `variants: ['rc']` (or `['steel']`) gates a row
 * to one building-type variant; leaving `variants` undefined
 * makes the row apply to both.
 * ============================================================= */
import type { SectionDef } from '@/features/projects/team-reports/types';
import type { BaReportAnswers } from '@/features/projects/team-reports/ba/types';

export type BaSection = SectionDef<BaReportAnswers>;

/* ─────────────────────────────────────────────────────────────
 * Sections
 *
 * Ordering follows the source template (Тайлбар бичиг).
 * MVP scope per the user: Үндэслэл, Байршил, Ерөнхий
 * төлөвлөгөө, Төлөвлөлт, Бүтээц, Дээвэр, Хана, Шал, ТЭЗ.
 * ─────────────────────────────────────────────────────────── */

// Эхний хуудас (header) section was removed — building name / location /
// client / design year+month all live on the project record + passport
// in the Мэдээлэл tab, so we read from there at print time instead of
// duplicating per-discipline.

export const GENERAL_PLAN_SECTION: BaSection = {
  id: 'general-plan',
  title: 'Ерөнхий төлөвлөгөө',
  fields: [
    {
      key: 'gp_alignment_with',
      label: 'Уялдуулсан зүйл',
      kind: 'text',
      span: 'full',
      placeholder: 'жишээ: одоо байгаа зам, хөрш барилгууд',
    },
    {
      key: 'gp_main_entrance_count',
      label: 'Үндсэн орц',
      kind: 'number',
      span: 'half',
      suffix: 'ширхэг',
    },
    {
      key: 'gp_main_entrance_side',
      label: 'Үндсэн орцны байрлал',
      kind: 'text',
      span: 'half',
      placeholder: 'жишээ: зүүн талаас',
    },
    {
      key: 'gp_service_entrance_count',
      label: 'Туслах орц',
      kind: 'number',
      span: 'half',
      suffix: 'ширхэг',
    },
    {
      key: 'gp_parking_entrance_count',
      label: 'Авто зогсоолын орц гарц',
      kind: 'number',
      span: 'half',
      suffix: 'ширхэг',
    },
    {
      key: 'gp_ramp_count',
      label: 'ХБИ-д зориулсан пандус',
      kind: 'number',
      span: 'half',
      suffix: 'ширхэг',
    },
  ],
};

export const LAYOUT_SECTION: BaSection = {
  id: 'layout',
  title: 'Төлөвлөлт / Архитектур төлөвлөлт',
  fields: [
    {
      key: 'plan_layout_kind',
      label: 'Төлөвлөлтийн төрөл',
      kind: 'select',
      span: 'full',
      options: [
        { value: 'single', label: 'Нэг блок, олон давхар' },
        { value: 'multi', label: 'Олон блокт цогцолбор' },
      ],
    },
    {
      key: 'plan_dimensions',
      label: 'Тэнхлэгийн хэмжээ',
      kind: 'text',
      span: 'full',
      placeholder: '30 × 60 м',
      visibleIf: (a) => a.plan_layout_kind !== 'multi',
    },
    {
      key: 'plan_basement_floors',
      label: 'Зоорийн давхар',
      kind: 'number',
      span: 'half',
      suffix: 'давхар',
      visibleIf: (a) => a.plan_layout_kind !== 'multi',
    },
    {
      key: 'plan_above_ground_floors',
      label: 'Газраас дээш давхар',
      kind: 'number',
      span: 'half',
      suffix: 'давхар',
      visibleIf: (a) => a.plan_layout_kind !== 'multi',
    },
    {
      key: 'plan_blocks',
      label: 'Блокуудын жагсаалт',
      kind: 'block-rows',
      span: 'full',
      visibleIf: (a) => a.plan_layout_kind === 'multi',
    },
    {
      key: 'plan_main_structure_notes',
      label: 'Үндсэн бүтээцийн тайлбар',
      kind: 'textarea',
      span: 'full',
      placeholder: 'Жишээ нь: төмөр бетон шугаман суурь дээр B1 давхартай металл каркас.',
    },
    {
      key: 'plan_floor_purposes',
      label: 'Давхар бүрийн зориулалт',
      kind: 'floor-rows',
      span: 'full',
    },
  ],
};

export const STRUCTURE_SECTION: BaSection = {
  id: 'structure',
  title: 'Барилгын бүтээц',
  fields: [
    // option A
    {
      key: 'rc_wall_thickness',
      label: 'Төмөр бетон ханын зузаан',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['rc'],
    },
    {
      key: 'rc_foundation_type',
      label: 'Суурийн төрөл',
      kind: 'select',
      span: 'half',
      variants: ['rc'],
      options: [
        { value: 'mat', label: 'Нил хавтан суурь' },
        { value: 'cup', label: 'Аяган суурь' },
        { value: 'strip', label: 'Шугаман суурь' },
      ],
    },
    {
      key: 'rc_slab_thickness',
      label: 'Хучилтын зузаан',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['rc'],
    },
    // option B
    {
      key: 'steel_basement_floor',
      label: 'Зоорийн давхар (төмөр бетон)',
      kind: 'text',
      span: 'half',
      variants: ['steel'],
      placeholder: 'жишээ: B1',
    },
    {
      key: 'steel_slab_thickness',
      label: 'Хучилт (металл тавцантай ТБ)',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['steel'],
    },
  ],
};

export const ROOF_SECTION: BaSection = {
  id: 'roof',
  title: 'Дээвэр',
  blurb:
    'Хавтгай дээвэр, дотуур ус зайлуулах системтэй. Налуулга, усны хаялгыг ЕТ-маркын зургаас үзнэ.',
  fields: [
    // option A — RC roof
    {
      key: 'roof_xps_thickness',
      label: 'XPS пеноплекс дулаалга',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['rc'],
    },
    {
      key: 'roof_screed_thickness',
      label: 'Бетон тэгшилгээ (тортой)',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['rc'],
    },
    // option B — metal deck roof (ranges)
    {
      key: 'roof_xps_range_from',
      label: 'XPS хөөсөнцөр доод хязгаар',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['steel'],
    },
    {
      key: 'roof_xps_range_to',
      label: 'XPS хөөсөнцөр дээд хязгаар',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['steel'],
    },
    {
      key: 'roof_eps_range_from',
      label: 'EPS хөөсөнцөр доод хязгаар',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['steel'],
    },
    {
      key: 'roof_eps_range_to',
      label: 'EPS хөөсөнцөр дээд хязгаар',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['steel'],
    },
    {
      key: 'roof_concrete_screed_thickness',
      label: 'Бетон тэгшилгээ',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['steel'],
    },
    // shared — usable roof
    { key: 'roof_usable', label: 'Ашиглалттай дээвэртэй', kind: 'checkbox', span: 'full' },
    {
      key: 'roof_usable_sand_thickness',
      label: 'Элсний зузаан',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      visibleIf: (a) => a.roof_usable === true,
    },
  ],
};

export const EXT_WALL_SECTION: BaSection = {
  id: 'ext-wall',
  title: 'Гадна хана',
  blurb: 'Зоорийн давхрын гадна хана + газрын түвшнээс дээш гадна хана.',
  fields: [
    // basement (both)
    {
      key: 'basement_rc_wall_thickness',
      label: 'Зоорийн ТБ хана',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
    },
    {
      key: 'basement_xps_thickness',
      label: 'Зоорийн XPS дулаалга',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
    },
    {
      key: 'basement_konkrevol_thickness',
      label: 'Конкреволл хавтан',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
    },
    // option A
    {
      key: 'ext_finish_kind',
      label: 'Гадна өнгөлгөө',
      kind: 'select',
      span: 'full',
      variants: ['rc'],
      options: [
        { value: 'metal_cladding', label: 'Хөнгөн цагаан металл хавтан систем' },
        { value: 'glass_facade', label: '3 давхар шилэн фасад' },
        { value: 'stone_cladding', label: 'Байгалийн чулуун хавтан' },
      ],
    },
    {
      key: 'ext_rc_thickness',
      label: 'Гадна ТБ ханын зузаан',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['rc'],
    },
    {
      key: 'ext_masonry_thickness',
      label: 'Хүчитгэлтэй өрлөгөн ханын зузаан',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['rc'],
    },
    {
      key: 'ext_stone_wool_thickness',
      label: 'Чулуун хөвөн дулаалга',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['rc'],
    },
    {
      key: 'ext_stone_thickness',
      label: 'Чулуун хавтан өнгөлгөөний зузаан',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['rc'],
      visibleIf: (a) => a.ext_finish_kind === 'stone_cladding',
    },
    // option B
    {
      key: 'sandwich_total_thickness',
      label: 'Сэндвич хавтангийн нийт зузаан',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['steel'],
    },
    {
      key: 'sandwich_outer_metal',
      label: 'Гадна металл лист',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['steel'],
    },
    {
      key: 'sandwich_inner_metal',
      label: 'Дотор металл лист',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['steel'],
    },
    // thermal targets (both)
    {
      key: 'ext_heat_resistance_target',
      label: 'Гадна ханын дулаан дамжуулалт ≤',
      kind: 'text',
      span: 'half',
    },
    {
      key: 'facade_heat_resistance_target',
      label: 'Шилэн фасадны дулаан дамжуулалт ≥',
      kind: 'text',
      span: 'half',
    },
  ],
};

export const INT_WALL_SECTION: BaSection = {
  id: 'int-wall',
  title: 'Дотор хана / хамар хана',
  fields: [
    // option A
    {
      key: 'int_basement_min',
      label: 'Зоорийн дотор ханын зузаан (доод)',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['rc'],
    },
    {
      key: 'int_basement_max',
      label: 'Зоорийн дотор ханын зузаан (дээд)',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['rc'],
    },
    {
      key: 'int_apartment_thickness',
      label: 'Айл хоорондын хана',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['rc'],
    },
    {
      key: 'int_bedroom_thickness',
      label: 'Унтлагын/зочны өрөө хоорондын хана',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['rc'],
    },
    {
      key: 'int_bathroom_thickness',
      label: 'Ариун цэврийн өрөөний хана',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['rc'],
    },
    // option B
    {
      key: 'int_sandwich_thickness',
      label: 'Үндсэн сэндвич хамар хана',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['steel'],
    },
    {
      key: 'int_cold_room_thickness',
      label: 'Хөргүүртэй кабины хана',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['steel'],
    },
    {
      key: 'int_fire_sandwich_thickness',
      label: 'Шарах шүүгээний галд тэсвэртэй хана',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['steel'],
    },
  ],
};

export const GLAZING_SECTION: BaSection = {
  id: 'glazing',
  title: 'Шилэн фасад, цонх',
  fields: [
    {
      key: 'glazed_facade_kind',
      label: 'Шилэн ханын төрөл',
      kind: 'select',
      span: 'full',
      options: [
        { value: 'metal_3layer_vacuum', label: 'Металл рам, 3 давхар вакуум' },
        { value: 'unitized_2layer', label: 'Юнитайз, 2 давхар (Low-E)' },
      ],
    },
    {
      key: 'glass_frame_u',
      label: 'Шилэн ханын рам U',
      kind: 'text',
      suffix: 'Вт/м²°C',
      span: 'half',
    },
    {
      key: 'glass_transom_u',
      label: 'Шилэн ханын трансом U',
      kind: 'text',
      suffix: 'Вт/м²°C',
      span: 'half',
    },
    { key: 'glass_unit_u', label: 'Шиллэгээний U', kind: 'text', suffix: 'Вт/м²°C', span: 'half' },
    {
      key: 'unitized_outer_glass_thickness',
      label: 'Гадна шилний зузаан',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      visibleIf: (a) => a.glazed_facade_kind === 'unitized_2layer',
    },
    {
      key: 'unitized_inner_glass_thickness',
      label: 'Дотор шилний зузаан',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      visibleIf: (a) => a.glazed_facade_kind === 'unitized_2layer',
    },
    {
      key: 'unitized_light_transmission',
      label: 'Гэрэл нэвтрүүлэлт',
      kind: 'text',
      suffix: '%',
      span: 'half',
      visibleIf: (a) => a.glazed_facade_kind === 'unitized_2layer',
    },
    {
      key: 'window_kind',
      label: 'Цонхны төрөл',
      kind: 'select',
      span: 'full',
      options: [
        { value: 'metal_3layer_vacuum', label: 'Металл рам, 3 давхар вакуум' },
        { value: 'pvc_vacuum', label: 'Хуванцар рам, вакуум' },
      ],
    },
    {
      key: 'window_fire_rating_hours',
      label: 'Цонхны гал тэсвэрлэлт',
      kind: 'text',
      suffix: 'цаг',
      span: 'half',
    },
  ],
};

export const FLOOR_SECTION: BaSection = {
  id: 'floor',
  title: 'Шал',
  fields: [
    {
      key: 'floor_metal_deck_thickness',
      label: 'Металл тавцантай ТБ зузаан',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['steel'],
    },
    {
      key: 'floor_screed_thickness_min',
      label: 'Бетон тэгшилгээ (доод)',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
    },
    {
      key: 'floor_screed_thickness_max',
      label: 'Бетон тэгшилгээ (дээд)',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
    },
    {
      key: 'floor_hollow_thickness',
      label: 'Хөндий шалны зузаан',
      kind: 'number',
      suffix: 'мм',
      span: 'half',
      variants: ['steel'],
    },
  ],
};

/* Улаанбаатарын БНбД 23-01-09 уур амьсгалын утгууд — preset нь
 * бүх 14 талбарт нэг товчлуураар бөглөнө.  Тооны утгуудыг текстээр
 * хадгалж байгаа нь юм гэвэл янз бүрийн формат (-0.5 vs 0.5°C)
 * шууд харагдах боломжтой байх (the field is `text` kind so the
 * "-0.5" doesn't get coerced into a number). */
const ULAANBAATAR_CLIMATE = {
  climate_station: 'МУИС-ын цаг уурын станц',
  climate_temp_avg_annual: '-0.5',
  climate_temp_max: '+33.8',
  climate_temp_july_max_avg: '31.6',
  climate_temp_min: '-36',
  climate_temp_jan_min_avg: '-31.9',
  climate_temp_heating_avg: '-8.8',
  climate_heating_grad: '-2049.4',
  climate_precip_annual: '233.1',
  climate_wind_avg: '1.3',
  climate_temp_soil_avg: '0.3',
  climate_wind_cold_3mo: '0.9',
  climate_snow_load: '50',
  climate_zone: 'II',
  climate_wind_5yr_pressure: '33',
} satisfies Partial<BaReportAnswers>;

export const CLIMATE_SECTION: BaSection = {
  id: 'climate',
  title: 'Уур амьсгалын үзүүлэлт',
  blurb:
    'БНбД 23-01-09 норм дагуу барилгын талбайн цаг уурын үзүүлэлтүүд. "Улаанбаатар" товчлуураар хотын стандарт утгуудыг нэг дор бөглөнө.',
  preset: {
    label: 'Улаанбаатар',
    description: 'БНбД 23-01-09-н дагуу Улаанбаатарын цаг уурын стандарт утгуудаар бөглөх',
    values: ULAANBAATAR_CLIMATE,
    confirm: true,
  },
  fields: [
    { key: 'climate_station', label: 'Цаг уурын станц', kind: 'text', span: 'full' },
    {
      key: 'climate_temp_avg_annual',
      label: 'Жилийн дундаж агаарын т°',
      kind: 'text',
      span: 'half',
      suffix: '°C',
    },
    {
      key: 'climate_temp_max',
      label: 'Үнэмлэхүй хамгийн их т°',
      kind: 'text',
      span: 'half',
      suffix: '°C',
    },
    {
      key: 'climate_temp_july_max_avg',
      label: 'YII сарын үнэмлэхүй их дундаж',
      kind: 'text',
      span: 'half',
      suffix: '°C',
    },
    {
      key: 'climate_temp_min',
      label: 'Үнэмлэхүй хамгийн бага т°',
      kind: 'text',
      span: 'half',
      suffix: '°C',
    },
    {
      key: 'climate_temp_jan_min_avg',
      label: 'I сарын үнэмлэхүй бага дундаж',
      kind: 'text',
      span: 'half',
      suffix: '°C',
    },
    {
      key: 'climate_temp_heating_avg',
      label: 'Халаалтын улирлын дундаж',
      kind: 'text',
      span: 'half',
      suffix: '°C',
    },
    {
      key: 'climate_heating_grad',
      label: 'Халаалтын улирлын эрчим (град)',
      kind: 'text',
      span: 'half',
      suffix: '°C·өдөр',
    },
    {
      key: 'climate_precip_annual',
      label: 'Хур тунадасны жилийн дундаж',
      kind: 'text',
      span: 'half',
      suffix: 'мм',
    },
    {
      key: 'climate_wind_avg',
      label: 'Салхины жилийн дундаж хурд',
      kind: 'text',
      span: 'half',
      suffix: 'м/с',
    },
    {
      key: 'climate_temp_soil_avg',
      label: 'Хөрсний гадаргын жилийн дундаж',
      kind: 'text',
      span: 'half',
      suffix: '°C',
    },
    {
      key: 'climate_wind_cold_3mo',
      label: 'Хамгийн хүйтэн 3 сарын салхины дундаж',
      kind: 'text',
      span: 'half',
      suffix: 'м/с',
    },
    {
      key: 'climate_snow_load',
      label: 'Цасны ачааллын нормчилсон утга',
      kind: 'text',
      span: 'half',
      suffix: 'кг/м²',
    },
    { key: 'climate_zone', label: 'Уур амьсгалын бүс', kind: 'text', span: 'half' },
    {
      key: 'climate_wind_5yr_pressure',
      label: '5 жил тутамд тохиох салхины даралт',
      kind: 'text',
      span: 'half',
      suffix: 'кг/м²',
    },
  ],
};

export const DRAWING_LIST_SECTION: BaSection = {
  id: 'drawing-list',
  title: 'Архитектурын зургийн жагсаалт',
  blurb:
    'Тайлбар бичигт хавсаргах ажлын зургийн төрлүүдийг чагтлах. Чагтласан зүйлс хэвлэх хуудсанд дугаарласан жагсаалтаар орно.',
  fields: [
    { key: 'dl_cover', label: '1.  Нүүр хуудас', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_general_plan',
      label: '2.  Ерөнхий төлөвлөгөө, зай хэмжээ, тохижилт, картограмм',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_drawing_list', label: '3.  Зургийн жагсаалт', kind: 'checkbox', span: 'full' },
    { key: 'dl_explanatory_note', label: '4.  Тайлбар бичиг', kind: 'checkbox', span: 'full' },
    { key: 'dl_floor_plans', label: '5.  Давхрын байгуулалтууд', kind: 'checkbox', span: 'full' },
    { key: 'dl_roof_plan', label: '6.  Дээврийн байгуулалт', kind: 'checkbox', span: 'full' },
    { key: 'dl_sections', label: '7.  Огтлолууд', kind: 'checkbox', span: 'full' },
    { key: 'dl_facades', label: '8.  Нүүр талууд', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_bathroom',
      label: '9.  Ариун цэврийн өрөөний хэсэглэл, дэлгээс',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_door_window',
      label: '10. Цонх, хаалганы схем, бүтэц, түүвэр',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_glass_wall',
      label: '11. Шилэн ханын нэгдсэн түүвэр',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_system_detail', label: '12. Систем деталь', kind: 'checkbox', span: 'full' },
    { key: 'dl_wall_section', label: '13. Ханын хэсэглэл', kind: 'checkbox', span: 'full' },
    { key: 'dl_floor_assembly', label: '14. Шалны байгуулалтууд', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_floor_ceiling_detail',
      label: '15. Шал, таазны хийц, бүтэц, түүвэр',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_ceiling_assembly',
      label: '16. Таазны байгуулалтууд',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_elevator',
      label: '17. Цахилгаан шат, шатны хэсэглэл',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_outdoor_porch',
      label: '18. Гадна довжоо, шатны хэсэглэл',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_fire_stair', label: '19. Галын шатны хэсэглэл', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_technology',
      label: '20. Технологийн байгуулалтууд',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_other', label: '21. Бусад нарийн хэсэглэл', kind: 'checkbox', span: 'full' },
  ],
};

// Гарын үсэг (signatures) section was removed — signatures are not
// authored per-discipline in the digital form. The final printable
// bundle adds signatures at the cover-page level instead.

export const TEZ_SECTION: BaSection = {
  id: 'tez',
  title: 'Техник эдийн засгийн үзүүлэлт',
  fields: [
    { key: 'tez_floor_count', label: 'Давхрын тоо', kind: 'number', span: 'half', suffix: 'тоо' },
    { key: 'tez_capacity', label: 'Хүчин чадал', kind: 'text', span: 'half', suffix: 'айл / хүн' },
    {
      key: 'tez_volume_m3',
      label: 'Барилгын эзэлхүүн',
      kind: 'number',
      span: 'half',
      suffix: 'м³',
    },
    {
      key: 'tez_built_area_m2',
      label: 'Барилгажилтын талбай',
      kind: 'number',
      span: 'half',
      suffix: 'м²',
    },
    {
      key: 'tez_useful_area_m2',
      label: 'Ашигтай талбай',
      kind: 'number',
      span: 'half',
      suffix: 'м²',
    },
    {
      key: 'tez_working_area_m2',
      label: 'Ажлын талбай',
      kind: 'number',
      span: 'half',
      suffix: 'м²',
    },
    { key: 'tez_k1', label: 'K1 (Sаж/Sаш)', kind: 'text', span: 'half' },
    { key: 'tez_k2', label: 'K2', kind: 'text', span: 'half' },
  ],
};

export const BA_SECTIONS: BaSection[] = [
  CLIMATE_SECTION,
  GENERAL_PLAN_SECTION,
  LAYOUT_SECTION,
  STRUCTURE_SECTION,
  ROOF_SECTION,
  EXT_WALL_SECTION,
  INT_WALL_SECTION,
  GLAZING_SECTION,
  FLOOR_SECTION,
  DRAWING_LIST_SECTION,
  TEZ_SECTION,
];
