/* =============================================================
 * BB team structural explanatory note (Тайлбар бичиг) — types.
 * -------------------------------------------------------------
 * Mirrors BA's `BaReportAnswers` shape: a single flat record of
 * optional values, stored as JSON in `project_team_reports.answers_json`.
 * All keys are optional so a partially-filled form round-trips
 * cleanly.  No variant picker today — the lateral-system field
 * is a regular select; if RC vs steel ever needs deeper template
 * branching, add a top-level `BbBuildingType` later.
 * ============================================================= */

export interface BbReportAnswers {
  /* ─── Header ──────────────────────────────────────────────── */
  building_name?: string;
  building_location?: string;
  client_name?: string;
  design_year?: string;
  design_month?: string;

  // "Зураг төсөл боловсруулах үндэслэл" + "Барилгын ангилал" fields
  // moved to BA — architects author them once and the data is shared.

  /* ─── Мөрдсөн норм дүрэм (structural specific) ──────────────
   *  Each flag matches one Mongolian Барилгын бүтээц БНбД / БД
   *  number; ticked items print as a bulleted list in the doc. */
  norms_bnbd_50_01_16?: boolean; // Барилгын бүтээц БНбД 50-01-16
  norms_bd_50_103_21?: boolean; // БД 50-103-21
  norms_bd_11_115_16?: boolean; // БД 11-115-16
  norms_bd_11_118_17?: boolean; // БД 11-118-17
  norms_bd_11_102_07?: boolean; // БД 11-102-07
  norms_bd_11_108_12?: boolean; // БД 11-108-12
  norms_bd_11_109_12?: boolean; // БД 11-109-12
  norms_bd_11_110_12?: boolean; // БД 11-110-12
  norms_bd_11_124_21?: boolean; // БД 11-124-21
  norms_bnod_22_01_21?: boolean; // Газар хөдлөлт БНОД 22-01-21
  norms_bnbd_31_17_10?: boolean; // Өндөр барилгын төлөвлөлт
  norms_bnbd_20_04_17?: boolean; // Ачаа ба үйлчлэл
  norms_bnbd_23_01_09?: boolean; // Цаг уур амьсгал

  /* ─── Геотехникийн нөхцөл (soil) ──────────────────────────── */
  soil_narrative?: string; // free-text summary
  soil_groundwater_depth?: string; // м
  soil_freezing_depth?: string; // м
  soil_seismic_category?: 'I' | 'II' | 'III'; // I/II/III ангилал
  soil_rqd_min?: string; // %
  soil_design_resistance?: string; // тонн/м² (R0)
  soil_special_conditions?: string; // free-text (рамшил, нөлөөлөл)

  /* ─── Суурь (Foundation) ─────────────────────────────────── */
  foundation_type?: 'mat' | 'strip' | 'cup' | 'pile' | 'hybrid';
  foundation_depth?: string; // м
  foundation_thickness?: string; // мм
  foundation_concrete_grade?: string; // B30 / B25
  foundation_water_class?: string; // W4 / W6 / W8
  foundation_rebar_main?: string; // A500C
  foundation_rebar_aux?: string; // A240
  foundation_settlement_max?: string; // см

  /* ─── Үндсэн каркас (Lateral system / framing) ─────────────── */
  lateral_system?:
    | 'cast_in_place' // бүрэн цутгамал ТБ
    | 'rc_frame' // рам-холбоост ТБ каркас
    | 'shear_wall' // ТБ хана даацт
    | 'steel_frame' // металл каркас
    | 'hybrid'; // холимог
  wall_thickness?: string; // мм
  column_grid?: string; // "9 × 8 м"
  column_size?: string; // "400 × 600 мм"
  slab_system?: 'flat' | 'beam_slab' | 'metal_deck';
  slab_thickness?: string; // мм

  /* ─── Бетон, арматур (Concrete + rebar) ───────────────────── */
  concrete_grade_main?: string; // B30
  concrete_grade_secondary?: string; // B25 / B20
  rebar_grade_main?: string; // A500C (MNS GOST 34028:2024)
  rebar_grade_aux?: string; // A240
  rebar_secondary?: string; // A400

  /* ─── Газар хөдлөлтийн тооцоо (Seismic) ───────────────────── */
  seismic_k0?: string; // 1.1
  seismic_k1?: string; // 0.25
  seismic_k_psi?: string; // 1
  seismic_joint_count?: string; // тоо
  seismic_joint_locations?: string; // textarea
  seismic_calc_method?: 'response_spectrum' | 'time_history' | 'pushover';

  /* ─── Салхины ачаалал (Wind + special) ─────────────────────── */
  wind_5yr_pressure?: string; // кг/м²
  wind_resonance_check?: boolean; // салхины резонанс шалгасан эсэх
  vehicle_load_3t?: boolean; // авто 3T
  vehicle_load_5t?: boolean; // хүргэлт 5T
  vehicle_load_26t?: boolean; // галын машин 26T
  helipad_static_load?: string; // кг (3800 жишээ)
  helipad_dynamic_load?: string; // кг (7600 жишээ)
  aerodynamic_method?: string; // free-text

  /* ─── Тооцоо төлөвлөх (Limit state + monitoring) ──────────── */
  limit_state_first_group?: boolean; // 1-р бүлэг шалгасан
  limit_state_second_group?: boolean; // 2-р бүлэг шалгасан
  progressive_collapse_calc?: boolean; // өргөжин нурах шалгасан
  permanent_monitoring?: boolean; // байнгын хяналт

  /* ─── Барилгын бүтээцийн зургийн жагсаалт ──────────────────
   *  10 typical BB drawing types.  Ticked items render in the
   *  doc as a numbered TOC, same pattern as BA's drawing list. */
  dl_cover?: boolean; // 1. Нүүр хуудас
  dl_drawing_list?: boolean; // 2. Зургийн жагсаалт
  dl_explanatory_note?: boolean; // 3. Тайлбар бичиг
  dl_foundation_plan?: boolean; // 4. Суурийн байгуулалт
  dl_column_plan?: boolean; // 5. Багана / даацын хана
  dl_slab_plan?: boolean; // 6. Хучилтын байгуулалт
  dl_beam_layout?: boolean; // 7. Дам нурууны байгуулалт
  dl_rebar_details?: boolean; // 8. Арматурын зураг
  dl_sections?: boolean; // 9. Огтлолууд
  dl_details?: boolean; // 10. Деталь, зангилаа

  /* ─── Гарын үсэг ──────────────────────────────────────────── */
  sig_structural_engineer_name?: string;
  sig_structural_engineer_license?: string;
  sig_pm_name?: string;
  sig_pm_license?: string;
  sig_director_name?: string;
  sig_approval_date?: string;
}
