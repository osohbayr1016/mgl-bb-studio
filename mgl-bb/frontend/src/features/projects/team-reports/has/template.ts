/* =============================================================
 * HAS report template — Халаалт, агаар сэлгэлт, кондиционер,
 * гал түймрийн утаанаас хамгаалах систем (one combined doc).
 * 12 sections covering everything in the MAX URGUU HAS TOR.
 * ============================================================= */
import type { SectionDef } from '@/features/projects/team-reports/types';
import type { HasReportAnswers } from '@/features/projects/team-reports/has/types';

export type HasSection = SectionDef<HasReportAnswers>;

// Эхний хуудас (header) section removed — building name / location /
// client / design year+month live on the Мэдээлэл project passport.
// "Зураг төсөл боловсруулах үндэслэл" and "Барилгын ангилал" are
// authored on the BA (architecture) form and shared across disciplines.

export const HEAT_SOURCE_SECTION: HasSection = {
  id: 'heat-source',
  title: 'Дулаан хангамжийн эх үүсвэр',
  fields: [
    {
      key: 'heat_source_kind',
      label: 'Эх үүсвэрийн төрөл',
      kind: 'select',
      span: 'half',
      options: [
        { value: 'district', label: 'ДЦС / Хотын дулаан хангамж' },
        { value: 'central_own', label: 'Барилгын төвлөрсөн' },
        { value: 'boiler', label: 'Уурын зуух' },
        { value: 'heat_pump', label: 'Дулааны насос' },
        { value: 'electric', label: 'Цахилгаан' },
      ],
    },
    {
      key: 'heat_supply_temp',
      label: 'Дамжуулагчын температур (нийлүүлэлт)',
      kind: 'text',
      span: 'half',
      suffix: '°C',
      placeholder: '90',
    },
    {
      key: 'heat_return_temp',
      label: 'Дамжуулагчын температур (буцаалт)',
      kind: 'text',
      span: 'half',
      suffix: '°C',
      placeholder: '70',
    },
    {
      key: 'heat_design_outdoor_temp',
      label: 'Тооцооны гадна агаарын т°',
      kind: 'text',
      span: 'half',
      suffix: '°C',
      placeholder: '-31.9',
    },
    {
      key: 'heat_load_total',
      label: 'Нийт халаалтын ачаалал',
      kind: 'text',
      span: 'half',
      suffix: 'кВт',
    },
    {
      key: 'heat_pipe_routing',
      label: 'Дамжуулах хоолойн систем',
      kind: 'select',
      span: 'half',
      options: [
        { value: 'bottom_dead_end', label: 'Доороос тарааж, мухар үзүүртэй' },
        { value: 'bottom_ring', label: 'Доороос тарааж, дугуй холбоост' },
        { value: 'top_distribution', label: 'Дээрээс тараасан' },
      ],
    },
  ],
};

export const HEAT_SYSTEM_SECTION: HasSection = {
  id: 'heat-system',
  title: 'Халаалтын систем',
  blurb: 'Бүсчлэл, халаалтын төхөөрөмж, системийн даралт, тус бүрчилсэн тоолуур.',
  fields: [
    {
      key: 'heat_zoning_text',
      label: 'Халаалтын бүсчлэл',
      kind: 'textarea',
      span: 'full',
      placeholder:
        'Жишээ нь: Зоорийн зогсоол, үйлчилгээний хэсэг, орон сууц 3 бүсээр тус тусдаа удирдлагатай төлөвлөсөн.',
      hint: 'БНбД 31-17-10 дагуу өндөр барилгад бүсчлэх шаардлагатай.',
    },
    { key: 'heat_devices_panel', label: 'Панел радиатор', kind: 'checkbox', span: 'full' },
    { key: 'heat_devices_cast', label: 'Цутгамал радиатор', kind: 'checkbox', span: 'full' },
    { key: 'heat_devices_convector', label: 'Конвектор', kind: 'checkbox', span: 'full' },
    { key: 'heat_devices_fan_coil', label: 'Fan coil', kind: 'checkbox', span: 'full' },
    { key: 'heat_devices_floor', label: 'Шалны халаалт', kind: 'checkbox', span: 'full' },
    { key: 'heat_devices_other', label: 'Бусад төхөөрөмж', kind: 'text', span: 'full' },
    {
      key: 'heat_system_pressure',
      label: 'Системийн ажлын даралт',
      kind: 'text',
      span: 'half',
      suffix: 'бар',
    },
    {
      key: 'heat_individual_metering',
      label: 'Айл бүрд дулааны тоолуур',
      kind: 'checkbox',
      span: 'full',
    },
  ],
};

export const VENTILATION_SECTION: HasSection = {
  id: 'ventilation',
  title: 'Агаар сэлгэлт',
  fields: [
    { key: 'vent_supply_mech', label: 'Механик нийлүүлэлт', kind: 'checkbox', span: 'full' },
    { key: 'vent_exhaust_mech', label: 'Механик сорогт', kind: 'checkbox', span: 'full' },
    {
      key: 'vent_natural_exhaust',
      label: 'Байгалийн сорогт (орон сууцны хэсэг)',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'vent_heat_recovery',
      label: 'Дулаан буцаах систем (heat recovery)',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'vent_wc_full_mechanical',
      label: 'Ариун цэврийн өрөөнд 100% механик сорогт',
      kind: 'checkbox',
      span: 'full',
      hint: 'Хүйтний улиралд халуун агаар хаягдахаас сэргийлж нэгдсэн нэг систем бус, зориулалтын систем.',
    },
    {
      key: 'vent_service_supply',
      label: 'Үйлчилгээний хэсэг механик нийлүүлэлт',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'vent_parking_pressurized',
      label: 'Зогсоол даралттай агаартай',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'vent_ring_ducts',
      label: 'Агаар сэлгэлтийн салбар хоолой дугуй хийцтэй',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'vent_narrative',
      label: 'Нэмэлт тайлбар',
      kind: 'textarea',
      span: 'full',
      placeholder:
        'Жишээ нь: Орон сууцны хэсэгт ердийн ажиллагаатай агаар сорох систем, агаар боловсруулах төхөөрөмж нь хаягдаж буй агаарын дулааныг эргүүлэн ашиглах шийдэлтэй.',
    },
  ],
};

export const AC_SECTION: HasSection = {
  id: 'ac',
  title: 'Хөргөлтийн систем (кондиционер)',
  fields: [
    {
      key: 'ac_system_kind',
      label: 'Системийн төрөл',
      kind: 'select',
      span: 'half',
      options: [
        { value: 'vrv', label: 'VRV (хувьсах хөргөлт)' },
        { value: 'split', label: 'Сплит систем' },
        { value: 'chilled_water', label: 'Хүйтэн усны систем' },
        { value: 'mixed', label: 'Холимог' },
        { value: 'none', label: 'Төлөвлөгөөгүй' },
      ],
    },
    {
      key: 'ac_indoor_kinds',
      label: 'Дотор хэсгийн төрлүүд',
      kind: 'text',
      span: 'half',
      placeholder: 'Cassette / wall / duct',
    },
    {
      key: 'ac_outdoor_placement',
      label: 'Гадна тоног төхөөрөмжийн байрлал',
      kind: 'text',
      span: 'full',
      placeholder: '1-2 давхар + дээвэр дээр',
    },
    {
      key: 'ac_independent_per_floor',
      label: 'Үйлчилгээний хэсэгт давхар тус бүр бие даасан VRV систем',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'ac_service_dedicated_tech_room',
      label: 'Үйлчилгээний хэсгийн АС-д техникийн өрөө төлөвлөсөн',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'ac_narrative',
      label: 'Нэмэлт тайлбар',
      kind: 'textarea',
      span: 'full',
      placeholder:
        'Жишээ нь: 1-2-р давхрын үйлчилгээний хэсэгт давхар бүр бие даасан VRV систем, гадна тоног төхөөрөмжийг 1-2-р давхар болон дээвэр дээр байрлуулсан.',
    },
  ],
};

export const DRAWING_LIST_SECTION: HasSection = {
  id: 'drawing-list',
  title: 'ХАС-ын зургийн жагсаалт',
  fields: [
    { key: 'dl_cover', label: '1.  Нүүр хуудас', kind: 'checkbox', span: 'full' },
    { key: 'dl_drawing_list', label: '2.  Зургийн жагсаалт', kind: 'checkbox', span: 'full' },
    { key: 'dl_explanatory_note', label: '3.  Тайлбар бичиг', kind: 'checkbox', span: 'full' },
    { key: 'dl_heating_plan', label: '4.  Халаалтын төлөвлөгөө', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_vent_plan',
      label: '5.  Агаар сэлгэлтийн төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_ac_plan',
      label: '6.  Хөргөлтийн (АС/VRV) төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_smoke_plan',
      label: '7.  Утаа зайлуулах төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_riser_diagram', label: '8.  Шугам холболтын схем', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_equipment_schedule',
      label: '9.  Тоног төхөөрөмжийн жагсаалт',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_sections', label: '10. Огтлолууд', kind: 'checkbox', span: 'full' },
    { key: 'dl_details', label: '11. Деталь, зангилаа', kind: 'checkbox', span: 'full' },
  ],
};

// Гарын үсэг (signatures) section removed — signatures aren't authored
// per-discipline in the digital form; the bundled cover handles them.

export const HAS_SECTIONS: HasSection[] = [
  HEAT_SOURCE_SECTION,
  HEAT_SYSTEM_SECTION,
  VENTILATION_SECTION,
  AC_SECTION,
  DRAWING_LIST_SECTION,
];
