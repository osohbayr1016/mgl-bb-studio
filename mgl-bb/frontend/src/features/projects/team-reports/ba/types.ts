/* =============================================================
 * BA team architectural explanatory note (Тайлбар бичиг)
 * -------------------------------------------------------------
 * The questionnaire produces a flat record of string answers
 * plus a couple of repeated rows (blocks, floor purposes).
 * The discriminator `building_type` is stored as a top-level
 * column on the server so the form can gate sections cheaply.
 * ============================================================= */

export type BaBuildingType = 'rc' | 'steel';
//                            └─ Төмөр бетон цутгамал каркас (СОНГОЛТ А)
//                                  └─ Металл каркас (СОНГОЛТ Б)

/** One row of the multi-block table (used by option Б — олон блокт цогцолбор). */
export interface BaBlockRow {
  name: string; // e.g. "А блок"
  dimensions: string; // e.g. "30 × 12 м"
  height: string; // e.g. "12.5 м"
  floors: string; // e.g. "3"
  purpose: string; // e.g. "Хүлээн авах, оффис"
}

/** One row of the per-floor purpose table. */
export interface BaFloorPurposeRow {
  floor: string; // e.g. "1-р давхар (+0.00)"
  purpose: string; // e.g. "Үндсэн орц, лобби"
}

/**
 * The full answers record. All keys are optional — the form fills
 * what's relevant for the chosen building_type and section. Nested
 * arrays are kept inline for atomicity (they round-trip through
 * a single JSON column on the server).
 */
export interface BaReportAnswers {
  /* ─── Header (1-р хуудас) ───────────────────────────────────── */
  building_name?: string;
  building_location?: string;
  client_name?: string;
  design_year?: string; // YYYY
  design_month?: string; // 1..12

  /* ─── Үндэслэл ────────────────────────────────────────────── */
  justification_kind?: 'city' | 'gov' | 'protected';
  /** Free-form prose for whichever justification variant was picked.
   *  Form pre-fills with a stub the user can edit. */
  justification_text?: string;

  /* ─── Норм дүрэм (checkboxes) ─────────────────────────────── */
  norms_residential?: boolean; // БНбД 31-01-…
  norms_public?: boolean; // БНбД 31-01-10
  norms_parking?: boolean; // БНбД 21-05-10
  norms_fire?: boolean; // БНбД 21-01-02 / 21-02-02
  norms_accessibility?: boolean; // БНбД 35-01-22
  norms_thermal?: boolean; // БНбД 25-01-20

  /* ─── Байршил ─────────────────────────────────────────────── */
  location_zoning?: string;

  /* ─── Ерөнхий төлөвлөгөө ──────────────────────────────────── */
  gp_alignment_with?: string; // "…-тэй уялдуулан"
  gp_main_entrance_count?: string;
  gp_main_entrance_side?: string;
  gp_service_entrance_count?: string;
  gp_parking_entrance_count?: string;
  gp_ramp_count?: string;

  /* ─── Төлөвлөлт / Архитектур төлөвлөлт ─────────────────────── */
  plan_layout_kind?: 'single' | 'multi'; // single-block vs cogцолбор
  // single-block fields:
  plan_structure_kind?: string; // pre-filled from building_type
  plan_dimensions?: string; // "30 × 60 м"
  plan_basement_floors?: string;
  plan_above_ground_floors?: string;
  // multi-block:
  plan_blocks?: BaBlockRow[];
  plan_main_structure_notes?: string;
  plan_floor_purposes?: BaFloorPurposeRow[];

  /* ─── Барилгын бүтээц ─────────────────────────────────────── */
  // option А (rc cast-in-place)
  rc_wall_thickness?: string; // mm
  rc_foundation_type?: 'mat' | 'cup' | 'strip';
  rc_slab_thickness?: string; // mm
  // option Б (metal frame)
  steel_basement_floor?: string; // e.g. "B1"
  steel_slab_thickness?: string; // mm — metal deck composite

  /* ─── Дээвэр ─────────────────────────────────────────────── */
  roof_xps_thickness?: string;
  roof_screed_thickness?: string;
  // metal-deck variant extras
  roof_xps_range_from?: string;
  roof_xps_range_to?: string;
  roof_eps_range_from?: string;
  roof_eps_range_to?: string;
  roof_concrete_screed_thickness?: string;
  // usable / walking roof
  roof_usable?: boolean;
  roof_usable_sand_thickness?: string;

  /* ─── Гадна хана (зоорь + газрын дээд) ──────────────────────── */
  basement_rc_wall_thickness?: string;
  basement_xps_thickness?: string;
  basement_konkrevol_thickness?: string;

  // option А (массив + чулуун хөвөн + хавтан)
  ext_rc_thickness?: string;
  ext_masonry_thickness?: string;
  ext_stone_wool_thickness?: string;
  ext_finish_kind?: 'metal_cladding' | 'glass_facade' | 'stone_cladding';
  ext_stone_thickness?: string;
  // option Б (сэндвич хавтан)
  sandwich_total_thickness?: string;
  sandwich_outer_metal?: string;
  sandwich_inner_metal?: string;
  // thermal targets (both)
  ext_heat_resistance_target?: string; // ≤ value
  facade_heat_resistance_target?: string; // ≥ value

  /* ─── Дотор хана / хамар хана ──────────────────────────────── */
  // option А (өрлөг)
  int_basement_min?: string;
  int_basement_max?: string;
  int_apartment_thickness?: string;
  int_bedroom_thickness?: string;
  int_bathroom_thickness?: string;
  // option Б (сэндвич + Кнауф)
  int_sandwich_thickness?: string;
  int_cold_room_thickness?: string;
  int_fire_sandwich_thickness?: string;

  /* ─── Шилэн фасад, цонх ────────────────────────────────────── */
  glazed_facade_kind?: 'metal_3layer_vacuum' | 'unitized_2layer';
  glass_frame_u?: string;
  glass_transom_u?: string;
  glass_unit_u?: string;
  // option Б (юнитайз)
  unitized_outer_glass_thickness?: string;
  unitized_inner_glass_thickness?: string;
  unitized_light_transmission?: string;
  window_kind?: 'metal_3layer_vacuum' | 'pvc_vacuum';
  window_fire_rating_hours?: string;

  /* ─── Шал ─────────────────────────────────────────────────── */
  floor_metal_deck_thickness?: string;
  floor_screed_thickness_min?: string;
  floor_screed_thickness_max?: string;
  floor_hollow_thickness?: string;

  /* ─── ТЭЗ үзүүлэлт ─────────────────────────────────────────── */
  tez_floor_count?: string;
  tez_capacity?: string; // айл / хүн
  tez_volume_m3?: string;
  tez_built_area_m2?: string;
  tez_useful_area_m2?: string;
  tez_working_area_m2?: string;
  tez_k1?: string;
  tez_k2?: string;

  /* ─── Барилгын ангилал (Building classification) ─────────────
   *  Regulatory categories that every Mongolian Тайлбар бичиг
   *  has to state. Kept as string unions so the form can render
   *  selects, but stored as strings so future norm changes
   *  don't break existing rows. */
  building_purpose_category?: 'residential' | 'public' | 'service' | 'industrial' | 'mixed_use';
  /** 4-tier complexity classification — same vocabulary as the
   *  project-level ProjectComplexity enum. */
  building_complexity_class?: 'low' | 'mid' | 'high' | 'special';
  fire_safety_class?: 'I' | 'II' | 'III' | 'IV' | 'V';
  building_lifetime_years?: string; // 25 / 50 / 100 / 150
  seismic_intensity_balls?: '7' | '8' | '9';
  reliability_class?: 'I' | 'II' | 'III';
  reliability_gamma_f?: string; // e.g. "1.1"

  /* ─── Уур амьсгал (Climate, БНбД 23-01-09) ───────────────────
   *  Values come from the building's location. Defaults are
   *  Улаанбаатар (UB Climate zone II) and the section's preset
   *  button drops them into all 14 fields in one click. */
  climate_station?: string; // e.g. "МУИС-ын цаг уурын станц"
  climate_temp_avg_annual?: string; // °C
  climate_temp_max?: string; // °C, +33.8
  climate_temp_july_max_avg?: string; // °C, 31.6
  climate_temp_min?: string; // °C, -36
  climate_temp_jan_min_avg?: string; // °C, -31.9
  climate_temp_heating_avg?: string; // °C, -8.8
  climate_heating_grad?: string; // град·өдөр, -2049.4
  climate_precip_annual?: string; // мм, 233.1
  climate_wind_avg?: string; // м/с, 1.3
  climate_temp_soil_avg?: string; // °C, 0.3
  climate_wind_cold_3mo?: string; // м/с, 0.9
  climate_snow_load?: string; // кг/м², 50
  climate_zone?: string; // I/II/III, "II"
  climate_wind_5yr_pressure?: string; // кг/м², 33

  /* ─── Эвакуац / гал гарах төлөвлөлт ───────────────────────────
   *  Fire-egress narrative section. Booleans drive bullet lists
   *  in the document; the free-text field is for project-specific
   *  nuance. */
  evac_secondary_stair_per_apt?: boolean; // тагт бүрд хоёрдогч галын шат
  evac_smoke_free_main_stair?: boolean; // утаашихгүй үндсэн шат
  evac_pressurized_vestibule?: boolean; // даралттай гонх
  evac_dedicated_fire_lift?: boolean; // зөвхөн гал сөнөөгчийн цахилгаан шат
  evac_exit_count_per_floor?: string; // тоо
  evac_narrative?: string; // free text

  /* ─── Архитектурын зургийн жагсаалт ───────────────────────────
   *  Table-of-contents checklist. The 21 standard items from the
   *  Mongolian high-rise TOR; ticked items render as a numbered
   *  list in the document. */
  dl_cover?: boolean; // 1.  Нүүр хуудас
  dl_general_plan?: boolean; // 2.  Ерөнхий төлөвлөгөө
  dl_drawing_list?: boolean; // 3.  Зургийн жагсаалт
  dl_explanatory_note?: boolean; // 4.  Тайлбар бичиг
  dl_floor_plans?: boolean; // 5.  Давхрын байгуулалт
  dl_roof_plan?: boolean; // 6.  Дээврийн байгуулалт
  dl_sections?: boolean; // 7.  Огтлолууд
  dl_facades?: boolean; // 8.  Нүүр талууд
  dl_bathroom?: boolean; // 9.  Ариун цэврийн хэсэглэл
  dl_door_window?: boolean; // 10. Цонх, хаалга
  dl_glass_wall?: boolean; // 11. Шилэн хана нэгдсэн түүвэр
  dl_system_detail?: boolean; // 12. Систем деталь
  dl_wall_section?: boolean; // 13. Ханын хэсэглэл
  dl_floor_assembly?: boolean; // 14. Шалны байгуулалт
  dl_floor_ceiling_detail?: boolean; // 15. Шал, таазны хийц
  dl_ceiling_assembly?: boolean; // 16. Таазны байгуулалт
  dl_elevator?: boolean; // 17. Цахилгаан шат
  dl_outdoor_porch?: boolean; // 18. Гадна довжоо, шат
  dl_fire_stair?: boolean; // 19. Галын шатны хэсэглэл
  dl_technology?: boolean; // 20. Технологийн байгуулалт
  dl_other?: boolean; // 21. Бусад нарийн хэсэглэл

  /* ─── Гарын үсэг (Signature block) ───────────────────────────
   *  Renders as the closing block of the document — without it
   *  the report is a draft, not a deliverable. */
  sig_architect_name?: string;
  sig_architect_license?: string; // мэргэшсэн инженерийн дугаар
  sig_pm_name?: string;
  sig_pm_license?: string;
  sig_director_name?: string;
  sig_approval_date?: string; // YYYY-MM-DD
}
