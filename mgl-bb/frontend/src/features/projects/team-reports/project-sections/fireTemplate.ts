import type { SectionDef } from '@/features/projects/team-reports/types';

/* =============================================================
 * FIRE — "Галын аюулгүй байдал" төслийн нэгдсэн хэсэг.
 * -------------------------------------------------------------
 * Өмнө BA (эвакуац), HAS (утаа зайлуулах), TSBU (галын ус), HD
 * (гал дохиолол), TSAH+AU (галд тэсвэртэй кабель/интеграц)-д
 * давхардаж байсныг нэгтгэв. Талбарын түлхүүрийг хуучин нэрээр нь
 * үлдээсэн. deep-research-ээр (IBC/NFPA/UFC gal, life-safety)
 * нэмсэн талбаруудыг тэмдэглэв.
 * ============================================================= */

const SMOKE_EXTRACT_OPTIONS = [
  { value: 'natural', label: 'Байгалийн' },
  { value: 'mechanical', label: 'Механик' },
  { value: 'hybrid', label: 'Холимог' },
];

export const FIRE_SECTIONS: SectionDef[] = [
  {
    id: 'fire-class',
    title: 'Галын тусгаарлалт ба бүтээцийн хамгаалалт',
    // Барилгын галын ангилал / гал тэсвэрлэлтийн анги нь BA (Барилга
    // архитектур)-гийн "Барилгын ангилал" хэсэгт (building_purpose_category,
    // building_complexity_class, fire_safety_class) аль хэдийн бичигддэг тул
    // энд давхардуулахгүй — зөвхөн галын тусгаарлалт/хамгаалалтын зүйлс.
    blurb:
      'Барилгын галын ангилал, гал тэсвэрлэлтийн ангийг "Барилга архитектур (BA)" багийн "Барилгын ангилал" хэсэгт бичнэ.',
    fields: [
      { key: 'fire_building_separation', label: 'Барилга хоорондын галын зай', kind: 'text', suffix: 'м', span: 'half' },
      { key: 'fire_compartmentation', label: 'Галын тусгаарлалт / хэсэгчлэл (галын хана, хаалт)', kind: 'checkbox' },
      { key: 'fire_penetration_sealing', label: 'Хэвтээ/босоо нэвчилтийн галын битүүмжлэл', kind: 'checkbox' },
      { key: 'fire_class_narrative', label: 'Нэмэлт тайлбар', kind: 'textarea', span: 'full' },
    ],
  },
  {
    id: 'evacuation',
    title: 'Эвакуац / гал гарах төлөвлөлт',
    fields: [
      { key: 'evac_exit_count_per_floor', label: 'Давхар бүрийн гарцын тоо', kind: 'number', span: 'half' },
      // deep-research: means-of-egress capacity (UFC/IBC Ch.10)
      { key: 'evac_occupant_load', label: 'Тооцоолсон хүний багтаамж (occupant load)', kind: 'text', span: 'half' },
      { key: 'evac_exit_width', label: 'Гарцын нийт өргөн / багтаамж', kind: 'text', span: 'half' },
      { key: 'evac_travel_distance', label: 'Эвакуацийн зам (м), мухар коридор', kind: 'text', span: 'half' },
      { key: 'evac_secondary_stair_per_apt', label: 'Айл/хэсэг бүрт нөөц шат', kind: 'checkbox' },
      { key: 'evac_smoke_free_main_stair', label: 'Утаагүй үндсэн шат', kind: 'checkbox' },
      { key: 'evac_pressurized_vestibule', label: 'Даралттай гонх (вестибюль)', kind: 'checkbox' },
      { key: 'evac_dedicated_fire_lift', label: 'Гал сөнөөгчийн тусгай лифт', kind: 'checkbox' },
      { key: 'evac_narrative', label: 'Нэмэлт тайлбар', kind: 'textarea', span: 'full' },
    ],
  },
  {
    id: 'smoke',
    title: 'Утаа зайлуулах / даралтжуулалт',
    fields: [
      { key: 'smoke_main_stair_pressurized', label: 'Үндсэн шат даралтжуулсан', kind: 'checkbox' },
      { key: 'smoke_dedicated_ff_lift_shaft', label: 'Гал сөнөөгчийн лифтний тусгай босоо хонгил', kind: 'checkbox' },
      { key: 'smoke_corridor_extract', label: 'Коридорын утаа сорох', kind: 'checkbox' },
      { key: 'smoke_lobby_pressurized', label: 'Лобби даралтжуулсан', kind: 'checkbox' },
      { key: 'smoke_vestibule_2stage', label: 'Хоёр шатлалт гонх', kind: 'checkbox' },
      { key: 'smoke_extract_method', label: 'Утаа зайлуулах арга', kind: 'select', options: SMOKE_EXTRACT_OPTIONS, span: 'half' },
      { key: 'smoke_narrative', label: 'Нэмэлт тайлбар', kind: 'textarea', span: 'full' },
    ],
  },
  {
    id: 'fire-water',
    title: 'Галын усан хангамж',
    fields: [
      { key: 'fire_sprinkler_auto', label: 'Автомат спринклер систем', kind: 'checkbox' },
      {
        key: 'fire_sprinkler_zones',
        label: 'Спринклерийн бүсчлэл',
        kind: 'textarea',
        span: 'full',
        visibleIf: (a) => a.fire_sprinkler_auto === true,
      },
      { key: 'fire_hose_reels', label: 'Галын хоолойн ороомог', kind: 'checkbox' },
      { key: 'fire_hydrants_outdoor', label: 'Гадна гидрант', kind: 'checkbox' },
      { key: 'fire_hydrants_indoor', label: 'Дотор гидрант', kind: 'checkbox' },
      { key: 'fire_reserve_volume', label: 'Галын усны нөөцийн эзэлхүүн', kind: 'text', suffix: 'м³', span: 'half' },
      { key: 'fire_reserve_duration', label: 'Нөөцийн хүрэлцэх хугацаа', kind: 'text', suffix: 'цаг', span: 'half' },
      { key: 'fire_pump_redundancy', label: '2 насос (1 ажлын + 1 нөөц)', kind: 'checkbox' },
    ],
  },
  {
    id: 'fire-alarm',
    title: 'Гал дохиолол',
    fields: [
      { key: 'fa_facp_location', label: 'Галын төв самбар (FACP) байрлал', kind: 'text', span: 'full' },
      { key: 'fa_addressable', label: 'Хаягжсан мэдрэгчид', kind: 'checkbox' },
      { key: 'fa_manual_call_points', label: 'Давхар бүрт гар дуудлагын товч', kind: 'checkbox' },
      { key: 'fa_fire_rated_cabling', label: 'Галд тэсвэртэй кабель', kind: 'checkbox' },
      { key: 'fa_facp_controls_smoke', label: 'FACP → утаа сорогч удирдана', kind: 'checkbox' },
      { key: 'fa_facp_controls_doors', label: 'FACP → нэвтрэх хаалга удирдана', kind: 'checkbox' },
      { key: 'fa_facp_controls_pa', label: 'FACP → зарлан мэдээлэл удирдана', kind: 'checkbox' },
    ],
  },
  {
    id: 'fire-integration',
    title: 'Галд тэсвэртэй кабель ба системийн интеграц',
    fields: [
      { key: 'fire_rated_cabling_present', label: 'Галд тэсвэртэй кабель (БД 43-105-12)', kind: 'checkbox' },
      { key: 'integ_fa_smoke_extract', label: 'Гал дохиолол → утаа сорох', kind: 'checkbox' },
      { key: 'integ_fa_pa', label: 'Гал дохиолол → зарлан мэдээлэл', kind: 'checkbox' },
      { key: 'integ_fa_access_unlock', label: 'Гал дохиолол → хаалга онгойлгох', kind: 'checkbox' },
      { key: 'integ_fa_lift_recall', label: 'Гал дохиолол → лифт татах', kind: 'checkbox' },
      { key: 'integ_fa_hvac_shutdown', label: 'Гал дохиолол → агаар сэлгэлт зогсоох', kind: 'checkbox' },
    ],
  },
];
