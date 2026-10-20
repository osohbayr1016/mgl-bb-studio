/* =============================================================
 * АУ report template — Барилгын инженерийн системийн
 * автоматжуулалт.  10 sections covering the MAX URGUU АУ TOR.
 *
 * АУ template highlights inter-discipline inputs explicitly
 * (section "Үндэслэл") because in practice this is the team
 * most often blocked by stale HAS / ЦБУ / ЦАХ / ХД briefs.
 * ============================================================= */
import type { SectionDef } from '@/features/projects/team-reports/types';
import type { AuReportAnswers } from '@/features/projects/team-reports/au/types';

export type AuSection = SectionDef<AuReportAnswers>;

// Эхний хуудас (header) section removed — building name / location /
// client / design year+month live on the Мэдээлэл project passport.
// "Зураг төсөл боловсруулах үндэслэл" and "Барилгын ангилал" are
// authored on the BA (architecture) form and shared across disciplines.

// AU-specific inputs section: which other disciplines have stabilised
// their briefs (HAS/ЦБУ/ЦАХ/ХД) — kept here because АУ is the team
// most often blocked by stale inter-discipline inputs.
export const INPUTS_SECTION: AuSection = {
  id: 'inputs',
  title: 'Бусад багуудаас зураг төсөл зохиогчийн даалгавар',
  blurb:
    'АУ-ийн ажил нь HAS, ЦБУ, ЦАХ, ХД-ийн зураг төсөл зохиогчийн даалгавруудаас шууд хамаардаг — аль нь тогтвортой ирсэнийг чагтлах.',
  fields: [
    {
      key: 'input_from_has',
      label: 'HAS багаас даалгавар хүлээн авсан',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'input_from_cbu',
      label: 'ЦБУ багаас даалгавар хүлээн авсан',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'input_from_tsah',
      label: 'ЦАХ багаас даалгавар хүлээн авсан',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'input_from_hd',
      label: 'ХД багаас даалгавар хүлээн авсан',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'input_from_client',
      label: 'Захиалагчаас тусгай даалгавар',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'input_pending_text',
      label: 'Хүлээгдэж буй даалгавар, шийдэл',
      kind: 'textarea',
      span: 'full',
      placeholder:
        'Жишээ нь: ЦАХ багаас баруун зүүний цэнэглэгчийн ачааллын тооцоо хүлээгдэж байна.',
      hint: 'Бусад баг тогтвортой биш бол энд тэмдэглэх.',
    },
  ],
};

export const BMS_SECTION: AuSection = {
  id: 'bms',
  title: 'Барилгын удирдлагын систем (BMS)',
  fields: [
    { key: 'bms_present', label: 'BMS систем төлөвлөв', kind: 'checkbox', span: 'full' },
    {
      key: 'bms_protocol',
      label: 'Удирдлагын протокол',
      kind: 'select',
      span: 'half',
      options: [
        { value: 'bacnet', label: 'BACnet' },
        { value: 'modbus', label: 'Modbus' },
        { value: 'knx', label: 'KNX' },
        { value: 'mixed', label: 'Холимог' },
      ],
      visibleIf: (a) => a.bms_present === true,
    },
    { key: 'bms_monitors_hvac', label: 'ХАС-ыг хянадаг', kind: 'checkbox', span: 'full' },
    {
      key: 'bms_monitors_lighting',
      label: 'Гэрэлтүүлгийг хянадаг',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'bms_monitors_water',
      label: 'Усан хангамж, насосыг хянадаг',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'bms_monitors_power',
      label: 'Цахилгаан хангамжийг хянадаг',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'bms_monitors_smoke',
      label: 'Утаа сорогт системийг хянадаг',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'bms_monitors_access',
      label: 'Нэвтрэх хяналтыг хянадаг',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'bms_scheduling',
      label: 'Цаг хуваарийн систем (scheduling)',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'bms_alarms',
      label: 'Алармын систем (имэйл / SMS мэдээ)',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'bms_narrative',
      label: 'BMS-ийн нэмэлт тайлбар',
      kind: 'textarea',
      span: 'full',
      placeholder:
        'Жишээ нь: BACnet/IP протоколтой нэгдсэн сервер, давхар бүрд I/O контроллер, веб дашбоардаар хяналт.',
    },
  ],
};

export const HOME_AUTO_SECTION: AuSection = {
  id: 'home-auto',
  title: 'Home автоматжуулалт (айл бүрд)',
  blurb:
    'Орон сууцны айл бүрд home automation төлөвлөсөн эсэх (МАКС ӨРГӨӨ хурлын Ч.Ариунболдын зөвлөмж).',
  fields: [
    {
      key: 'home_auto_present',
      label: 'Айл бүрд home автомат систем',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'home_auto_lighting',
      label: 'Гэрэлтүүлгийн удирдлага',
      kind: 'checkbox',
      span: 'full',
      visibleIf: (a) => a.home_auto_present === true,
    },
    {
      key: 'home_auto_climate',
      label: 'Халаалт, хөргөлтийн удирдлага',
      kind: 'checkbox',
      span: 'full',
      visibleIf: (a) => a.home_auto_present === true,
    },
    {
      key: 'home_auto_security',
      label: 'Аюулгүй байдлын удирдлага',
      kind: 'checkbox',
      span: 'full',
      visibleIf: (a) => a.home_auto_present === true,
    },
    {
      key: 'home_auto_window_blinds',
      label: 'Цонхны хөшиг (хатгуурт)',
      kind: 'checkbox',
      span: 'full',
      visibleIf: (a) => a.home_auto_present === true,
    },
    {
      key: 'home_auto_app_control',
      label: 'Утасны аппликейшнаар удирдах',
      kind: 'checkbox',
      span: 'full',
      visibleIf: (a) => a.home_auto_present === true,
    },
    {
      key: 'home_auto_voice_control',
      label: 'Дуун удирдлага (Alexa / Google)',
      kind: 'checkbox',
      span: 'full',
      visibleIf: (a) => a.home_auto_present === true,
    },
    {
      key: 'home_auto_narrative',
      label: 'Нэмэлт тайлбар',
      kind: 'textarea',
      span: 'full',
      visibleIf: (a) => a.home_auto_present === true,
    },
  ],
};

export const INTEGRATION_SECTION: AuSection = {
  id: 'integration',
  title: 'Системүүдийн уялдаа холбоо',
  blurb: 'Аюулгүй байдал, гэрэлтүүлгийн систем хоорондын автомат уялдаа. (Галын уялдааг "Галын аюулгүй байдал" хэсэгт нэгтгэв.)',
  fields: [
    {
      key: 'integ_security_cctv',
      label: 'Нэвтрэх ⇒ CCTV-д үйл явдал бичигдэх',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'integ_lighting_motion',
      label: 'Хөдөлгөөн мэдрэгч ⇒ гэрэлтүүлэг асах',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'integ_narrative',
      label: 'Нэмэлт тайлбар',
      kind: 'textarea',
      span: 'full',
    },
  ],
};

export const DRAWING_LIST_SECTION: AuSection = {
  id: 'drawing-list',
  title: 'АУ-ийн зургийн жагсаалт',
  fields: [
    { key: 'dl_cover', label: '1.  Нүүр хуудас', kind: 'checkbox', span: 'full' },
    { key: 'dl_drawing_list', label: '2.  Зургийн жагсаалт', kind: 'checkbox', span: 'full' },
    { key: 'dl_explanatory_note', label: '3.  Тайлбар бичиг', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_bms_architecture',
      label: '4.  BMS системийн архитектур',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_bms_io_list',
      label: '5.  Мэдрэгч, удирдлагын I/O жагсаалт',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_home_auto',
      label: '6.  Home автоматжуулалтын зураг',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_integration_diagram',
      label: '7.  Системүүдийн уялдааны схем',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_monitoring_room',
      label: '8.  Хяналтын өрөөний зураг',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'dl_equipment_schedule',
      label: '9.  Тоног төхөөрөмжийн жагсаалт',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_details', label: '10. Деталь, зангилаа', kind: 'checkbox', span: 'full' },
  ],
};

// Гарын үсэг (signatures) section removed — signatures aren't authored
// per-discipline in the digital form; the bundled cover handles them.

export const AU_SECTIONS: AuSection[] = [
  INPUTS_SECTION,
  BMS_SECTION,
  HOME_AUTO_SECTION,
  INTEGRATION_SECTION,
  DRAWING_LIST_SECTION,
];
