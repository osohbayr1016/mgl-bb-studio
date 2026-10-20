/* =============================================================
 * ЦАХ team Тайлбар бичиг — types.
 * -------------------------------------------------------------
 * Цахилгаан хангамж, дотоод цахилгаан, гадна гэрэлтүүлэг,
 * газардуулга / аянганаас хамгаалах, EV цэнэглэгч.  One
 * combined report.  Team code on the backend is `TSAH`.
 * ============================================================= */

export interface TsahReportAnswers {
  /* ─── Header ──────────────────────────────────────────────── */
  building_name?: string;
  building_location?: string;
  client_name?: string;
  design_year?: string;
  design_month?: string;

  // Design basis + Classification fields moved to BA — architects
  // author them once and the data is shared across disciplines.

  /* ─── Norms ──────────────────────────────────────────────── */
  norms_bnbd_31_17_23?: boolean; // Барилгын дотоод цахилгаан
  norms_bd_43_101_07?: boolean;
  norms_bd_43_102_07?: boolean;
  norms_bd_43_103_08?: boolean;
  norms_bd_43_105_12?: boolean; // Галд тэсвэртэй кабель
  norms_bd_43_107_19?: boolean; // Газардуулга
  norms_bnbd_31_17_10?: boolean; // Өндөр барилгын төлөвлөлт
  norms_bnbd_21_04_05?: boolean; // Гал унтраах автомат, дохиолол
  norms_mns_iec_60364?: boolean; // MNS IEC 60364

  /* ─── Power source ───────────────────────────────────────── */
  source_substation?: string; // free-text (substation name + voltage)
  source_voltage_primary?: string; // кВ (10 / 6 / 0.4)
  source_voltage_secondary?: string; // кВ
  source_feed_count?: string; // тоо (2 ширхэг гм)
  source_load_total?: string; // кВт
  source_load_calculated?: string; // кВт (тооцоонд авах)
  source_power_factor?: string; // cosφ (≥ 0.95 нормоор)
  source_narrative?: string;

  /* ─── Reliability classes ─────────────────────────────────── */
  reliability_class_1_present?: boolean; // I класс байгаа
  reliability_class_2_present?: boolean; // II класс байгаа
  reliability_class_3_present?: boolean; // III класс байгаа
  reliability_class_1_items?: string; // textarea: галын шат, утаа сорогт, дохиолол гм
  reliability_class_2_items?: string; // textarea: лифт, орон сууцны өрөөнүүд гм

  /* ─── Class-I backup ─────────────────────────────────────── */
  backup_generator_present?: boolean;
  backup_generator_power?: string; // кВА
  backup_generator_autonomy_hours?: string; // цаг (3 цаг гм)
  backup_ups_present?: boolean;
  backup_ups_autonomy?: string; // минут / цаг
  backup_narrative?: string;

  /* ─── Distribution ───────────────────────────────────────── */
  distrib_main_panel_location?: string; // text
  distrib_separate_residential?: boolean; // орон сууцанд тусдаа ОХС
  distrib_separate_service?: boolean; // үйлчилгээнд тусдаа ОХС
  distrib_separate_parking?: boolean; // зогсоолд тусдаа ОХС
  distrib_metering_per_zone?: boolean; // бүсчилсэн тоолуур
  distrib_metering_per_apt?: boolean; // айл бүрд тоолуур
  distrib_high_rise_riser?: boolean; // өндөр давхарт тусдаа босоо шугам

  /* ─── Lighting ────────────────────────────────────────────── */
  lighting_interior_led?: boolean;
  lighting_emergency_3h?: boolean; // 3-цагийн нөөц аваргын гэрэлтүүлэг
  lighting_exterior?: boolean;
  lighting_facade?: boolean;
  lighting_motion_sensor?: boolean;
  lighting_dali_control?: boolean; // DALI хяналт
  lighting_lux_levels_text?: string; // textarea (норм утгууд)

  /* ─── Grounding + lightning ──────────────────────────────── */
  grounding_tn_s_system?: boolean; // TN-S систем
  grounding_main_loop?: boolean; // үндсэн контур
  lightning_terminal_present?: boolean; // аянганы шонт
  lightning_class?: 'I' | 'II' | 'III' | 'IV'; // IEC 62305 анги
  grounding_narrative?: string;

  /* ─── Special / EV ────────────────────────────────────────── */
  ev_chargers_count?: string; // тоо
  ev_chargers_kw?: string; // кВт нэг бүрд
  ev_chargers_location?: string; // text
  fire_rated_cabling_present?: boolean; // галд тэсвэртэй кабель
  smart_metering_present?: boolean; // ухаалаг тоолуур
  special_narrative?: string;

  /* ─── Drawing list ───────────────────────────────────────── */
  dl_cover?: boolean;
  dl_drawing_list?: boolean;
  dl_explanatory_note?: boolean;
  dl_single_line?: boolean; // нэг шугамын схем
  dl_power_plan?: boolean; // цахилгаан хангамжийн төлөвлөгөө
  dl_lighting_plan?: boolean;
  dl_outlet_plan?: boolean; // розетка
  dl_emergency_lighting?: boolean;
  dl_grounding_plan?: boolean;
  dl_lightning_plan?: boolean;
  dl_ev_charging?: boolean;
  dl_equipment_schedule?: boolean;
  dl_cable_schedule?: boolean;
  dl_details?: boolean;

  /* ─── Signatures ──────────────────────────────────────────── */
  sig_electrical_engineer_name?: string;
  sig_electrical_engineer_license?: string;
  sig_pm_name?: string;
  sig_pm_license?: string;
  sig_director_name?: string;
  sig_approval_date?: string;
}
