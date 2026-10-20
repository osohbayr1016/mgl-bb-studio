/* =============================================================
 * ХД report template — Холбоо дохиолол.  13 sections covering
 * the MAX URGUU ХД TOR + standard low-voltage disciplines
 * (CCTV, access control, fire alarm, PA, UPS).
 * ============================================================= */
import type { SectionDef } from '@/features/projects/team-reports/types';
import type { HdReportAnswers } from '@/features/projects/team-reports/hd/types';

export type HdSection = SectionDef<HdReportAnswers>;

// Эхний хуудас (header) section removed — building name / location /
// client / design year+month live on the Мэдээлэл project passport.
// "Зураг төсөл боловсруулах үндэслэл" and "Барилгын ангилал" are
// authored on the BA (architecture) form and shared across disciplines.

export const FIBER_SECTION: HdSection = {
  id: 'fiber',
  title: 'Шилэн кабель',
  fields: [
    {
      key: 'fiber_inlet_cores',
      label: 'Шилэн кабелийн судлын тоо',
      kind: 'text',
      span: 'half',
      suffix: 'судал',
      placeholder: '12',
    },
    {
      key: 'fiber_inlet_route',
      label: 'Кабелийн оролтын замнал',
      kind: 'textarea',
      span: 'full',
      placeholder:
        'Жишээ нь: ТӨХХК-ийн худгаас Ø100мм PVC сувагчлалаар 0.8-1.2м гүнд B1 давхар хүртэл оруулна.',
    },
  ],
};

export const PHONE_COMP_SECTION: HdSection = {
  id: 'phone-comp',
  title: 'Утас, компьютерын сүлжээ',
  fields: [
    {
      key: 'phone_per_office',
      label: 'Оффис бүрд телефоны розетка',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'phone_separate_service_res',
      label: 'Үйлчилгээ, орон сууц тусдаа систем',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'computer_multi_isp',
      label: 'Олон ISP сонголтоор үйлчилнэ',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'computer_per_office',
      label: 'Оффис бүрд компьютерын розетка',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'computer_separate_service_res',
      label: 'Үйлчилгээ, орон сууц тусдаа систем',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'network_speed',
      label: 'Сүлжээний хурд (свитч)',
      kind: 'text',
      span: 'half',
      placeholder: '1 Гбит/сек',
    },
    {
      key: 'cable_category',
      label: 'Кабелийн төрөл',
      kind: 'text',
      span: 'half',
      placeholder: 'CAT6 / CAT6A',
    },
  ],
};

export const MOBILE_TV_SECTION: HdSection = {
  id: 'mobile-tv',
  title: 'Гар утасны сүлжээ өргөгч, кабелийн ТВ',
  fields: [
    {
      key: 'mobile_booster_basement',
      label: 'B1/B2 зоорийн давхарт гар утасны сүлжээ өргөгч',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'mobile_booster_high_floors',
      label: '15-р давхраас дээш гар утасны сүлжээ өргөгч',
      kind: 'checkbox',
      span: 'full',
      hint: 'Өндөр давхар нь шилэн фасадны нөлөөгөөр сүлжээ унах боломжтой.',
    },
    { key: 'cable_tv_present', label: 'Кабелийн ТВ систем', kind: 'checkbox', span: 'full' },
    {
      key: 'cable_tv_topology',
      label: 'Кабелийн ТВ-ийн топологи',
      kind: 'select',
      span: 'half',
      options: [
        { value: 'star', label: 'Од хэлбэрийн (star)' },
        { value: 'tree', label: 'Мод хэлбэрийн (tree)' },
        { value: 'mixed', label: 'Холимог' },
      ],
      visibleIf: (a) => a.cable_tv_present === true,
    },
  ],
};

export const ACCESS_SECTION: HdSection = {
  id: 'access',
  title: 'Нэвтрэх хяналтын систем',
  fields: [
    { key: 'access_main_entry', label: 'Гол орц гарц', kind: 'checkbox', span: 'full' },
    { key: 'access_server_room', label: 'Серверийн өрөө', kind: 'checkbox', span: 'full' },
    { key: 'access_comms_rooms', label: 'Холбооны өрөөнүүд', kind: 'checkbox', span: 'full' },
    {
      key: 'access_auto_unlock_on_fire',
      label: 'Гал гарсан үед автомат нээгдэх',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'access_kind',
      label: 'Хяналтын төрөл',
      kind: 'select',
      span: 'half',
      options: [
        { value: 'card', label: 'Карт' },
        { value: 'biometric', label: 'Биометр' },
        { value: 'pin', label: 'PIN код' },
        { value: 'mixed', label: 'Холимог' },
      ],
    },
    {
      key: 'access_narrative',
      label: 'Нэмэлт тайлбар',
      kind: 'textarea',
      span: 'full',
    },
  ],
};

export const CCTV_SECTION: HdSection = {
  id: 'cctv',
  title: 'Хяналтын камерын систем',
  fields: [
    { key: 'cctv_camera_count', label: 'Камерын тоо', kind: 'number', span: 'half', suffix: 'тоо' },
    {
      key: 'cctv_camera_min_resolution',
      label: 'Камерын дүрсний нягтрал (доод хязгаар)',
      kind: 'text',
      span: 'half',
      placeholder: '4MP',
    },
    {
      key: 'cctv_nvr_retention_days',
      label: 'NVR-ийн бичлэг хадгалах хугацаа',
      kind: 'text',
      span: 'half',
      suffix: 'хоног',
      placeholder: '30',
    },
    {
      key: 'cctv_outdoor_cameras',
      label: 'Гадна суурилуулсан камерууд (өдөр шөнийн ажиллагаатай)',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'cctv_lift_cabs',
      label: 'Цахилгаан шатны кабинд камертай',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'cctv_parking', label: 'Зогсоолд камертай', kind: 'checkbox', span: 'full' },
    {
      key: 'cctv_poe_powered',
      label: 'PoE-ээр тэжээлтэй камерууд',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'cctv_max_cable_run',
      label: 'Камерын кабелийн дээд урт',
      kind: 'text',
      span: 'half',
      suffix: 'м',
      placeholder: '90',
    },
    {
      key: 'cctv_monitor_size',
      label: 'Хяналтын дэлгэцийн хэмжээ',
      kind: 'text',
      span: 'half',
      suffix: 'инч',
      placeholder: '42',
    },
    {
      key: 'cctv_monitor_floor',
      label: 'Хяналтын өрөөний давхар',
      kind: 'text',
      span: 'half',
      placeholder: '1F',
    },
    {
      key: 'cctv_coverage_text',
      label: 'Хяналт хийгдэх талбайнууд',
      kind: 'textarea',
      span: 'full',
      placeholder:
        'Жишээ нь: Гол орцуудын төв нь хяналтын өрөөтэй холбогдсон, зогсоол, цахилгаан шатны хонгил, шат, нийтийн талбайн орц гарц бүхэлд нь.',
    },
  ],
};

export const PA_SECTION: HdSection = {
  id: 'pa',
  title: 'Зарлан мэдээлэл',
  fields: [
    { key: 'pa_present', label: 'Зарлан мэдээллийн систем', kind: 'checkbox', span: 'full' },
    {
      key: 'pa_background_music',
      label: 'Дэвсгэр хөгжимтэй',
      kind: 'checkbox',
      span: 'full',
      visibleIf: (a) => a.pa_present === true,
    },
    {
      key: 'pa_emergency_override',
      label: 'Гал гарсан үед автомат зарлан мэдээлэх',
      kind: 'checkbox',
      span: 'full',
      visibleIf: (a) => a.pa_present === true,
    },
    {
      key: 'pa_zoned',
      label: 'Бүсчилсэн чанга яригч',
      kind: 'checkbox',
      span: 'full',
      visibleIf: (a) => a.pa_present === true,
    },
  ],
};

export const DRAWING_LIST_SECTION: HdSection = {
  id: 'drawing-list',
  title: 'ХД-ийн зургийн жагсаалт',
  fields: [
    { key: 'dl_cover', label: '1.  Нүүр хуудас', kind: 'checkbox', span: 'full' },
    { key: 'dl_drawing_list', label: '2.  Зургийн жагсаалт', kind: 'checkbox', span: 'full' },
    { key: 'dl_explanatory_note', label: '3.  Тайлбар бичиг', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_phone_plan',
      label: '4.  Утасны сүлжээний төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_computer_plan',
      label: '5.  Компьютерын сүлжээний төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_cctv_plan', label: '6.  CCTV-ийн төлөвлөгөө', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_access_plan',
      label: '7.  Нэвтрэх хяналтын төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_fa_plan', label: '8.  Гал дохиоллын төлөвлөгөө', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_pa_plan',
      label: '9.  Зарлан мэдээллийн төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_cable_tv_plan',
      label: '10. Кабелийн ТВ-ийн төлөвлөгөө',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_server_room', label: '11. Серверийн өрөөний зураг', kind: 'checkbox', span: 'full' },
    { key: 'dl_riser_diagram', label: '12. Босоо шугамын схем', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_equipment_schedule',
      label: '13. Тоног төхөөрөмжийн жагсаалт',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_details', label: '14. Деталь, зангилаа', kind: 'checkbox', span: 'full' },
  ],
};

// Гарын үсэг (signatures) section removed — signatures aren't authored
// per-discipline in the digital form; the bundled cover handles them.

export const HD_SECTIONS: HdSection[] = [
  FIBER_SECTION,
  PHONE_COMP_SECTION,
  MOBILE_TV_SECTION,
  ACCESS_SECTION,
  CCTV_SECTION,
  PA_SECTION,
  DRAWING_LIST_SECTION,
];
