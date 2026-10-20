/* =============================================================
 * ЦБУ team Тайлбар бичиг — types.
 * -------------------------------------------------------------
 * Цэвэр, бохир ус — domestic supply + hot water + sewage +
 * storm water + sprinkler fire-protection in one combined
 * document.  Same shape as BB/HAS.
 *
 * Team code on the backend is the existing 4-char "TSBU"
 * (Цэвэр Бохир Усны хангамж) — matches what the rest of the
 * app uses already in `DRAWING_DISCIPLINES`.
 * ============================================================= */

export interface CbuReportAnswers {
  /* ─── Header ──────────────────────────────────────────────── */
  building_name?: string;
  building_location?: string;
  client_name?: string;
  design_year?: string;
  design_month?: string;

  // Design basis + Classification fields moved to BA — architects
  // author them once and the data is shared across disciplines.

  /* ─── Norms ──────────────────────────────────────────────── */
  norms_bnbd_40_05_13?: boolean; // Барилгын дотор ариун цэврийн зориулалт
  norms_bnbd_40_02_12?: boolean; // Усан хангамж
  norms_bnbd_40_03_12?: boolean; // Ариутгах татуурга
  norms_bnbd_21_04_05?: boolean; // Гал унтраах автомат, дохиолол
  norms_bnbd_21_01_02?: boolean; // Барилгын галын аюулгүй байдал
  norms_bnbd_31_17_10?: boolean; // Өндөр барилгын төлөвлөлт
  norms_mns_6502?: boolean; // Дотоод сантехник
  norms_mns_0900?: boolean; // Унд ахуйн усны чанар

  /* ─── Water source ───────────────────────────────────────── */
  water_source_kind?: 'city' | 'borehole' | 'mixed'; // Хотын / Өөрийн худаг / Холимог
  water_source_text?: string; // free-text
  water_inlet_count?: string; // тоо
  water_inlet_pressure?: string; // бар

  /* ─── Cold / hot water ────────────────────────────────────── */
  water_demand_total?: string; // м³/хоног
  water_demand_per_person?: string; // л/хүн/хоног
  water_pressure_required?: string; // бар (давхар тус бүрд)
  water_pressure_zoning?: boolean; // даралтын бүсчилсэн
  hot_water_source?: 'central' | 'boiler' | 'heat_exchanger' | 'instant' | 'none';
  hot_water_supply_temp?: string; // °C (≥ 60 нормоор)
  water_saving_fixtures?: boolean; // ус хэмнэх төхөөрөмж
  water_sound_dampening?: boolean; // дуу намсгагч, чичиргээ
  water_narrative?: string;

  /* ─── Sewage + storm ─────────────────────────────────────── */
  sewage_system?: 'gravity' | 'pumped' | 'mixed';
  sewage_separated?: boolean; // ахуйн / үйлдвэрлэлийн салгасан
  sewage_treatment_local?: boolean; // дотоод цэвэрлэгээ
  sewage_pumping_required?: boolean;
  storm_roof_drains?: boolean; // дотуур ус зайлуулах
  storm_parking_drains?: boolean; // зогсоолын шал
  storm_surface_drainage?: boolean; // гадаргын ус
  sewage_narrative?: string;

  /* ─── Fire protection ────────────────────────────────────── */
  fire_sprinkler_auto?: boolean; // автомат спринклер
  fire_sprinkler_zones?: string; // textarea (зогсоол / худалдаа / орон сууцны хонгил)
  fire_hose_reels?: boolean; // галын барих сэлгэцийн шугам
  fire_hydrants_outdoor?: boolean; // гадна гидрант
  fire_hydrants_indoor?: boolean; // дотор гидрант
  fire_reserve_volume?: string; // м³
  fire_reserve_duration?: string; // цаг (3 цаг гэх мэт)
  fire_pump_redundancy?: boolean; // 2 насос (ажиллах + нөөц)

  /* ─── Vertical risers + tech room ─────────────────────────── */
  riser_shaft_count?: string; // тоо
  riser_shaft_locations?: string; // textarea
  techroom_floor?: string; // "B1"
  techroom_water_reserve_domestic?: string; // м³
  techroom_water_reserve_fire?: string; // м³
  techroom_pump_sound_dampening?: boolean;
  techroom_narrative?: string;

  /* ─── Drawing list ───────────────────────────────────────── */
  dl_cover?: boolean;
  dl_drawing_list?: boolean;
  dl_explanatory_note?: boolean;
  dl_cold_water_plan?: boolean; // Цэвэр усны төлөвлөгөө
  dl_hot_water_plan?: boolean; // Халуун усны төлөвлөгөө
  dl_sewage_plan?: boolean; // Бохирын төлөвлөгөө
  dl_storm_plan?: boolean; // Борооны ус
  dl_sprinkler_plan?: boolean; // Спринклер
  dl_riser_diagram?: boolean; // Босоо шугам
  dl_techroom?: boolean; // Техникийн өрөө
  dl_equipment_schedule?: boolean;
  dl_sections?: boolean;
  dl_details?: boolean;

  /* ─── Signatures ──────────────────────────────────────────── */
  sig_cbu_engineer_name?: string;
  sig_cbu_engineer_license?: string;
  sig_pm_name?: string;
  sig_pm_license?: string;
  sig_director_name?: string;
  sig_approval_date?: string;
}
