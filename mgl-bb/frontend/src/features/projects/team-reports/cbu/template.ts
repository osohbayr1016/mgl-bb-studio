/* =============================================================
 * ЦБУ report template — Цэвэр бохир ус.  11 sections covering
 * everything in the MAX URGUU ЦБУ TOR plus the typical sewage
 * and storm-water disciplines that always travel with it.
 * ============================================================= */
import type { SectionDef } from '@/features/projects/team-reports/types';
import type { CbuReportAnswers } from '@/features/projects/team-reports/cbu/types';

export type CbuSection = SectionDef<CbuReportAnswers>;

// Эхний хуудас (header) section removed — building name / location /
// client / design year+month live on the Мэдээлэл project passport.
// "Зураг төсөл боловсруулах үндэслэл" and "Барилгын ангилал" are
// authored on the BA (architecture) form and shared across disciplines.

export const WATER_SOURCE_SECTION: CbuSection = {
  id: 'water-source',
  title: 'Усан хангамжийн эх үүсвэр',
  fields: [
    {
      key: 'water_source_kind',
      label: 'Эх үүсвэрийн төрөл',
      kind: 'select',
      span: 'half',
      options: [
        { value: 'city', label: 'Хотын төвлөрсөн усан хангамж' },
        { value: 'borehole', label: 'Өөрийн худаг' },
        { value: 'mixed', label: 'Холимог' },
      ],
    },
    {
      key: 'water_inlet_count',
      label: 'Усны оролтын тоо',
      kind: 'number',
      span: 'half',
      suffix: 'тоо',
    },
    {
      key: 'water_inlet_pressure',
      label: 'Оролтын даралт',
      kind: 'text',
      span: 'half',
      suffix: 'бар',
    },
    {
      key: 'water_source_text',
      label: 'Дэлгэрэнгүй тайлбар',
      kind: 'textarea',
      span: 'full',
      placeholder:
        'Жишээ нь: Усан хангамжийн техникийн нөхцөл №… дагуу хотын төвлөрсөн сүлжээнээс хоёр чиглэлээр Ø100мм пластик хоолойгоор тэжээнэ.',
    },
  ],
};

export const WATER_DEMAND_SECTION: CbuSection = {
  id: 'water-demand',
  title: 'Хэрэглээний цэвэр, халуун ус',
  fields: [
    {
      key: 'water_demand_total',
      label: 'Нийт хоногийн усны хэрэглээ',
      kind: 'text',
      span: 'half',
      suffix: 'м³/хоног',
    },
    {
      key: 'water_demand_per_person',
      label: 'Хүнд ноогдох хэрэглээ',
      kind: 'text',
      span: 'half',
      suffix: 'л/хүн/хоног',
    },
    {
      key: 'water_pressure_required',
      label: 'Шаардлагатай ажлын даралт',
      kind: 'text',
      span: 'half',
      suffix: 'бар',
    },
    {
      key: 'water_pressure_zoning',
      label: 'Даралтыг давхар бүсчилсэн',
      kind: 'checkbox',
      span: 'full',
      hint: 'Өндөр барилгад заавал бүсчилнэ.',
    },
    {
      key: 'hot_water_source',
      label: 'Халуун усны эх үүсвэр',
      kind: 'select',
      span: 'half',
      options: [
        { value: 'central', label: 'Төвлөрсөн' },
        { value: 'boiler', label: 'Уурын зуух' },
        { value: 'heat_exchanger', label: 'Дулаан солилцуур (ДЦС-аас)' },
        { value: 'instant', label: 'Шуурхай халаагч' },
        { value: 'none', label: 'Үгүй' },
      ],
    },
    {
      key: 'hot_water_supply_temp',
      label: 'Халуун усны нийлүүлэх т°',
      kind: 'text',
      span: 'half',
      suffix: '°C',
      placeholder: '60',
    },
    {
      key: 'water_saving_fixtures',
      label: 'Ус хэмнэх төхөөрөмж (sensor, ¼ турбин гм)',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'water_sound_dampening',
      label: 'Шугам, хоолойд дуу намсгагч, чичиргээ зөөлрүүлэгч',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'water_narrative',
      label: 'Нэмэлт тайлбар',
      kind: 'textarea',
      span: 'full',
    },
  ],
};

export const SEWAGE_SECTION: CbuSection = {
  id: 'sewage',
  title: 'Ариутгах татуурга, борооны ус',
  fields: [
    {
      key: 'sewage_system',
      label: 'Бохирын систем',
      kind: 'select',
      span: 'half',
      options: [
        { value: 'gravity', label: 'Хүндийн хүчээр (gravity)' },
        { value: 'pumped', label: 'Шахуургалттай' },
        { value: 'mixed', label: 'Холимог' },
      ],
    },
    {
      key: 'sewage_separated',
      label: 'Ахуйн, үйлдвэрлэлийн бохирыг салгасан',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'sewage_treatment_local',
      label: 'Дотоод цэвэршүүлэх төхөөрөмжтэй',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'sewage_pumping_required',
      label: 'Шахуурга шаардлагатай (зоорийн давхар)',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'storm_roof_drains',
      label: 'Дээврийн дотуур ус зайлуулах',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'storm_parking_drains',
      label: 'Зогсоолын шалын ус зайлуулах',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'storm_surface_drainage',
      label: 'Гадаргын усны зайлуулалт',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'sewage_narrative',
      label: 'Нэмэлт тайлбар',
      kind: 'textarea',
      span: 'full',
      placeholder:
        'Жишээ нь: Зоорийн давхрын ахуйн бохир ус нь шахуургат стандартын насос (1 ажиллах + 1 нөөц) болон 1.5 м³ нөөцийн савтай систем.',
    },
  ],
};

export const RISERS_SECTION: CbuSection = {
  id: 'risers',
  title: 'Босоо шугам',
  fields: [
    {
      key: 'riser_shaft_count',
      label: 'Босоо шугамын тоо',
      kind: 'number',
      span: 'half',
      suffix: 'тоо',
    },
    {
      key: 'riser_shaft_locations',
      label: 'Босоо шугамын байрлал',
      kind: 'textarea',
      span: 'full',
      placeholder:
        'Жишээ нь: A блок-2 ширхэг (Y3, Y6 тэнхлэгт), Б блок-2 ширхэг (Y10, Y12 тэнхлэгт).',
    },
  ],
};

export const DRAWING_LIST_SECTION: CbuSection = {
  id: 'drawing-list',
  title: 'ЦБУ-ийн зургийн жагсаалт',
  fields: [
    { key: 'dl_cover', label: '1.  Нүүр хуудас', kind: 'checkbox', span: 'full' },
    { key: 'dl_drawing_list', label: '2.  Зургийн жагсаалт', kind: 'checkbox', span: 'full' },
    { key: 'dl_explanatory_note', label: '3.  Тайлбар бичиг', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_cold_water_plan',
      label: '4.  Цэвэр усны төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_hot_water_plan',
      label: '5.  Халуун усны төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_sewage_plan', label: '6.  Бохирын төлөвлөгөө', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_storm_plan',
      label: '7.  Борооны ус зайлуулах төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_sprinkler_plan',
      label: '8.  Спринклер, галын төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_riser_diagram', label: '9.  Босоо шугамын схем', kind: 'checkbox', span: 'full' },
    { key: 'dl_techroom', label: '10. Техникийн өрөө', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_equipment_schedule',
      label: '11. Тоног төхөөрөмжийн жагсаалт',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_sections', label: '12. Огтлолууд', kind: 'checkbox', span: 'full' },
    { key: 'dl_details', label: '13. Деталь, зангилаа', kind: 'checkbox', span: 'full' },
  ],
};

// Гарын үсэг (signatures) section removed — signatures aren't authored
// per-discipline in the digital form; the bundled cover handles them.

export const CBU_SECTIONS: CbuSection[] = [
  WATER_SOURCE_SECTION,
  WATER_DEMAND_SECTION,
  SEWAGE_SECTION,
  RISERS_SECTION,
  DRAWING_LIST_SECTION,
];
