import type { SectionDef } from '@/features/projects/team-reports/types';

/* =============================================================
 * ROOMS — "Техникийн өрөө ба нөөц тэжээл" төслийн нэгдсэн хэсэг.
 * -------------------------------------------------------------
 * Өмнө HAS/TSBU (техникийн өрөө), HD (серверийн өрөө), AU (хяналтын
 * өрөө), TSAH+HD (генератор/UPS)-д давхардаж байсныг нэгтгэв.
 * Талбарын түлхүүрийг боломжтой газар хуучин нэрээр нь үлдээсэн.
 * deep-research-ээр нэмсэн талбаруудыг тэмдэглэв.
 * ============================================================= */

export const ROOMS_SECTIONS: SectionDef[] = [
  {
    id: 'techroom',
    title: 'Техникийн / насосны өрөө',
    fields: [
      { key: 'techroom_floor', label: 'Техникийн өрөөний байрлал (давхар)', kind: 'text', span: 'half' },
      { key: 'techroom_water_reserve_domestic', label: 'Ахуйн усны нөөц', kind: 'text', suffix: 'м³', span: 'half' },
      { key: 'techroom_water_reserve_fire', label: 'Галын усны нөөц', kind: 'text', suffix: 'м³', span: 'half' },
      { key: 'techroom_pump_sound_dampening', label: 'Насосны дуу чимээ тусгаарлалт', kind: 'checkbox' },
      { key: 'techroom_narrative', label: 'Нэмэлт тайлбар', kind: 'textarea', span: 'full' },
    ],
  },
  {
    id: 'server-room',
    title: 'Серверийн / холбооны өрөө',
    fields: [
      { key: 'server_room_floor', label: 'Серверийн өрөөний байрлал (давхар)', kind: 'text', span: 'half' },
      { key: 'server_room_area', label: 'Серверийн өрөөний талбай', kind: 'text', suffix: 'м²', span: 'half' },
      { key: 'ip_telephony_present', label: 'IP телефони сервер', kind: 'checkbox' },
      { key: 'per_floor_signal_cabinet', label: 'Давхар бүрийн дохиоллын шүүгээ', kind: 'checkbox' },
      // deep-research: server-room орчны нөхцөл (TIA-942 / U-Alberta)
      { key: 'server_room_climate_control', label: 'Температур/чийгшил хяналт (≈18–24°C, 30–55%)', kind: 'checkbox' },
      { key: 'server_room_positive_pressure', label: 'Эерэг даралт / тусгай агааржуулалт', kind: 'checkbox' },
      { key: 'server_room_narrative', label: 'Нэмэлт тайлбар', kind: 'textarea', span: 'full' },
    ],
  },
  {
    id: 'monitoring',
    title: 'Нэгдсэн хяналтын өрөө',
    fields: [
      { key: 'monitoring_room_floor', label: 'Хяналтын өрөөний байрлал (давхар)', kind: 'text', span: 'half' },
      { key: 'monitoring_room_area', label: 'Хяналтын өрөөний талбай', kind: 'text', suffix: 'м²', span: 'half' },
      { key: 'monitoring_unified_per_block', label: 'Блок бүрт нэгдсэн хяналт', kind: 'checkbox' },
      { key: 'monitoring_24_7_staffed', label: '24/7 хүнтэй ажиллана', kind: 'checkbox' },
      { key: 'monitoring_narrative', label: 'Нэмэлт тайлбар', kind: 'textarea', span: 'full' },
    ],
  },
  {
    id: 'backup',
    title: 'Нөөц тэжээл (генератор / UPS)',
    fields: [
      { key: 'backup_generator_present', label: 'Дизель генератор', kind: 'checkbox' },
      {
        key: 'backup_generator_power',
        label: 'Генераторын чадал',
        kind: 'text',
        suffix: 'kVA',
        span: 'half',
        visibleIf: (a) => a.backup_generator_present === true,
      },
      {
        key: 'backup_generator_autonomy_hours',
        label: 'Генераторын ажиллах хугацаа',
        kind: 'text',
        suffix: 'цаг',
        span: 'half',
        visibleIf: (a) => a.backup_generator_present === true,
      },
      // deep-research: түлшний нөөц
      {
        key: 'backup_generator_fuel_reserve',
        label: 'Дизель түлшний нөөц (цаг / литр)',
        kind: 'text',
        span: 'half',
        visibleIf: (a) => a.backup_generator_present === true,
      },
      { key: 'backup_ups_present', label: 'UPS (тасралтгүй тэжээл)', kind: 'checkbox' },
      {
        key: 'backup_ups_autonomy',
        label: 'UPS ажиллах хугацаа',
        kind: 'text',
        suffix: 'мин',
        span: 'half',
        visibleIf: (a) => a.backup_ups_present === true,
      },
      {
        key: 'ups_covers_text',
        label: 'UPS-ээр хамгаалагдах системүүд',
        kind: 'textarea',
        span: 'full',
        visibleIf: (a) => a.backup_ups_present === true,
      },
      // deep-research: яаралтай тэжээлийн галд тэсвэртэй кабель (NEC-700 → БНбД)
      { key: 'backup_emergency_fire_rated_cabling', label: 'Нөөц/яаралтай тэжээлийн галд тэсвэртэй кабель', kind: 'checkbox' },
      { key: 'backup_narrative', label: 'Нэмэлт тайлбар', kind: 'textarea', span: 'full' },
    ],
  },
];
