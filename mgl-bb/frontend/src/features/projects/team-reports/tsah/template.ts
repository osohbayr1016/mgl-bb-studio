/* =============================================================
 * ЦАХ report template — Цахилгаан.  12 sections covering
 * everything in the MAX URGUU ЦАХ TOR plus standard electrical
 * disciplines (grounding, lightning, EV charging).
 * ============================================================= */
import type { SectionDef } from '@/features/projects/team-reports/types';
import type { TsahReportAnswers } from '@/features/projects/team-reports/tsah/types';

export type TsahSection = SectionDef<TsahReportAnswers>;

// Эхний хуудас (header) section removed — building name / location /
// client / design year+month live on the Мэдээлэл project passport.
// "Зураг төсөл боловсруулах үндэслэл" and "Барилгын ангилал" are
// authored on the BA (architecture) form and shared across disciplines.

export const SOURCE_SECTION: TsahSection = {
  id: 'source',
  title: 'Цахилгаан хангамжийн эх үүсвэр',
  fields: [
    {
      key: 'source_substation',
      label: 'Дэд өртөө / Эх үүсвэр',
      kind: 'text',
      span: 'full',
      placeholder: 'Жишээ нь: 110/35/10 кВ-ын Сонгино дэд өртөө.',
    },
    {
      key: 'source_voltage_primary',
      label: 'Үндсэн хүчдэл',
      kind: 'text',
      span: 'half',
      suffix: 'кВ',
      placeholder: '10',
    },
    {
      key: 'source_voltage_secondary',
      label: 'Хоёрдогч хүчдэл',
      kind: 'text',
      span: 'half',
      suffix: 'кВ',
      placeholder: '0.4',
    },
    {
      key: 'source_feed_count',
      label: 'Гадна тэжээлийн шугамын тоо',
      kind: 'number',
      span: 'half',
      suffix: 'ширхэг',
    },
    {
      key: 'source_load_total',
      label: 'Нийт ачаалал (суурилагдсан)',
      kind: 'text',
      span: 'half',
      suffix: 'кВт',
    },
    {
      key: 'source_load_calculated',
      label: 'Тооцооны ачаалал',
      kind: 'text',
      span: 'half',
      suffix: 'кВт',
    },
    {
      key: 'source_power_factor',
      label: 'Чадлын коэффициент cosφ',
      kind: 'text',
      span: 'half',
      placeholder: '0.95',
      hint: 'Норм утга ≥ 0.95.',
    },
    {
      key: 'source_narrative',
      label: 'Дэлгэрэнгүй тайлбар',
      kind: 'textarea',
      span: 'full',
    },
  ],
};

export const RELIABILITY_SECTION: TsahSection = {
  id: 'reliability',
  title: 'Цахилгаан хэрэглэгчийн найдварлагын анги',
  blurb: 'I, II, III ангийн хэрэглэгчдийг ялгаж бичих.',
  fields: [
    {
      key: 'reliability_class_1_present',
      label: 'I анги (онцгой) хэрэглэгчтэй',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'reliability_class_1_items',
      label: 'I ангийн хэрэглэгчид',
      kind: 'textarea',
      span: 'full',
      placeholder:
        'Жишээ нь: Гал сөнөөгчийн цахилгаан шат, утаа зайлуулах сэнс, гал дохиоллын систем, авагдаах гэрэлтүүлэг, насосны өрөө.',
      visibleIf: (a) => a.reliability_class_1_present === true,
    },
    {
      key: 'reliability_class_2_present',
      label: 'II анги (хэвийн) хэрэглэгчтэй',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'reliability_class_2_items',
      label: 'II ангийн хэрэглэгчид',
      kind: 'textarea',
      span: 'full',
      placeholder: 'Жишээ нь: Орон сууцны айл өрхийн гэрэлтүүлэг, розетка, гал тогооны төхөөрөмж.',
      visibleIf: (a) => a.reliability_class_2_present === true,
    },
    {
      key: 'reliability_class_3_present',
      label: 'III анги (бууруулсан) хэрэглэгчтэй',
      kind: 'checkbox',
      span: 'full',
    },
  ],
};

export const DISTRIBUTION_SECTION: TsahSection = {
  id: 'distribution',
  title: 'Цахилгаан хуваарилалт, тоолуур',
  fields: [
    {
      key: 'distrib_main_panel_location',
      label: 'Гол хуваарилах самбарын байрлал',
      kind: 'text',
      span: 'full',
      placeholder: 'B1 давхрын цахилгааны өрөө',
    },
    {
      key: 'distrib_separate_residential',
      label: 'Орон сууцанд тусдаа ОХС',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'distrib_separate_service',
      label: 'Үйлчилгээний хэсэгт тусдаа ОХС',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'distrib_separate_parking',
      label: 'Зогсоолд тусдаа ОХС',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'distrib_metering_per_zone',
      label: 'Бүсчилсэн тоолуур',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'distrib_metering_per_apt', label: 'Айл бүрд тоолуур', kind: 'checkbox', span: 'full' },
    {
      key: 'distrib_high_rise_riser',
      label: 'Өндөр давхарт тусдаа босоо шугам',
      kind: 'checkbox',
      span: 'full',
    },
  ],
};

export const LIGHTING_SECTION: TsahSection = {
  id: 'lighting',
  title: 'Гэрэлтүүлэг',
  fields: [
    {
      key: 'lighting_interior_led',
      label: 'Дотор LED гэрэлтүүлэг',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'lighting_emergency_3h',
      label: '3 цагийн нөөцтэй авагдаах гэрэлтүүлэг',
      kind: 'checkbox',
      span: 'full',
      hint: 'Шат, хонгил, гарц, дохиоллын тэмдэг.',
    },
    { key: 'lighting_exterior', label: 'Гадна гэрэлтүүлэг', kind: 'checkbox', span: 'full' },
    {
      key: 'lighting_facade',
      label: 'Фасадны архитектур гэрэлтүүлэг',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'lighting_motion_sensor',
      label: 'Зогсоол, хонгилд хөдөлгөөн мэдрэгч',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'lighting_dali_control', label: 'DALI хяналтын систем', kind: 'checkbox', span: 'full' },
    {
      key: 'lighting_lux_levels_text',
      label: 'Норм бүхий гэрэлтүүлгийн утгууд',
      kind: 'textarea',
      span: 'full',
      placeholder:
        'Орон сууцны өрөөнд 200 лк, ажлын талбайд 300-500 лк, шат хонгилд 50-100 лк гэх мэт.',
    },
  ],
};

export const GROUNDING_SECTION: TsahSection = {
  id: 'grounding',
  title: 'Газардуулга, аянганаас хамгаалах',
  fields: [
    { key: 'grounding_tn_s_system', label: 'TN-S систем', kind: 'checkbox', span: 'full' },
    {
      key: 'grounding_main_loop',
      label: 'Үндсэн газардуулгын контур',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'lightning_terminal_present',
      label: 'Аянганы шонт төлөвлөв',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'lightning_class',
      label: 'Аянгаас хамгаалах анги (IEC 62305)',
      kind: 'select',
      span: 'half',
      options: [
        { value: 'I', label: 'I (онцгой эрсдэлтэй)' },
        { value: 'II', label: 'II (өндөр эрсдэл)' },
        { value: 'III', label: 'III (хэвийн)' },
        { value: 'IV', label: 'IV (бууруулсан)' },
      ],
    },
    {
      key: 'grounding_narrative',
      label: 'Нэмэлт тайлбар',
      kind: 'textarea',
      span: 'full',
    },
  ],
};

export const EV_SECTION: TsahSection = {
  id: 'ev',
  title: 'Цахилгаан машины цэнэглэгч, тусгай ачаалал',
  fields: [
    {
      key: 'ev_chargers_count',
      label: 'EV цэнэглэгчийн тоо',
      kind: 'number',
      span: 'half',
      suffix: 'тоо',
    },
    {
      key: 'ev_chargers_kw',
      label: 'Цэнэглэгч тус бүрийн чадал',
      kind: 'text',
      span: 'half',
      suffix: 'кВт',
    },
    {
      key: 'ev_chargers_location',
      label: 'Цэнэглэгчийн байрлал',
      kind: 'text',
      span: 'full',
      placeholder: 'B1 давхрын зогсоолд',
    },
    { key: 'smart_metering_present', label: 'Ухаалаг тоолуур', kind: 'checkbox', span: 'full' },
    {
      key: 'special_narrative',
      label: 'Нэмэлт тайлбар',
      kind: 'textarea',
      span: 'full',
    },
  ],
};

export const DRAWING_LIST_SECTION: TsahSection = {
  id: 'drawing-list',
  title: 'Цахилгааны зургийн жагсаалт',
  fields: [
    { key: 'dl_cover', label: '1.  Нүүр хуудас', kind: 'checkbox', span: 'full' },
    { key: 'dl_drawing_list', label: '2.  Зургийн жагсаалт', kind: 'checkbox', span: 'full' },
    { key: 'dl_explanatory_note', label: '3.  Тайлбар бичиг', kind: 'checkbox', span: 'full' },
    { key: 'dl_single_line', label: '4.  Нэг шугамын схем', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_power_plan',
      label: '5.  Цахилгаан хангамжийн төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_lighting_plan',
      label: '6.  Гэрэлтүүлгийн төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_outlet_plan', label: '7.  Розеткын төлөвлөгөө', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_emergency_lighting',
      label: '8.  Авагдаах гэрэлтүүлгийн төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_grounding_plan',
      label: '9.  Газардуулгын төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_lightning_plan', label: '10. Аянгаас хамгаалах', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_ev_charging',
      label: '11. EV цэнэглэгчийн төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_equipment_schedule',
      label: '12. Тоног төхөөрөмжийн жагсаалт',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_cable_schedule', label: '13. Кабелийн жагсаалт', kind: 'checkbox', span: 'full' },
    { key: 'dl_details', label: '14. Деталь, зангилаа', kind: 'checkbox', span: 'full' },
  ],
};

// Гарын үсэг (signatures) section removed — signatures aren't authored
// per-discipline in the digital form; the bundled cover handles them.

export const TSAH_SECTIONS: TsahSection[] = [
  SOURCE_SECTION,
  RELIABILITY_SECTION,
  DISTRIBUTION_SECTION,
  LIGHTING_SECTION,
  GROUNDING_SECTION,
  EV_SECTION,
  DRAWING_LIST_SECTION,
];
