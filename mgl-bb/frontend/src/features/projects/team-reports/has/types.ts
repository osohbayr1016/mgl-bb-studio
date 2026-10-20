/* =============================================================
 * HAS team Тайлбар бичиг — types.
 * -------------------------------------------------------------
 * Халаалт, агаар сэлгэлт, кондиционер, гал түймрийн утаанаас
 * хамгаалах систем — single combined report (matches the
 * MAX URGUU HAS TOR which bundles all four into one document).
 * Same flat-record shape + JSON persistence as BA/BB.
 * ============================================================= */

export interface HasReportAnswers {
  /* ─── Header ──────────────────────────────────────────────── */
  building_name?: string;
  building_location?: string;
  client_name?: string;
  design_year?: string;
  design_month?: string;

  // Design basis + Classification fields moved to BA — architects
  // author them once and the data is shared across disciplines.

  /* ─── Norms ──────────────────────────────────────────────── */
  norms_bnbd_41_01_11?: boolean; // Халаалт, агаар сэлгэлт ба кондиционер
  norms_bnbd_41_01_16?: boolean; // Барилгын дотор халаалт
  norms_bnbd_31_17_10?: boolean; // Өндөр барилгын төлөвлөлт
  norms_bnbd_23_01_09?: boolean; // Цаг уур амьсгал
  norms_bnbd_25_01_20?: boolean; // Барилгын дулаан хамгаалалт
  norms_bnbd_21_04_05?: boolean; // Гал унтраах автомат төхөөрөмж, дохиоллын хэрэгсэл
  norms_bnbd_21_01_02?: boolean; // Барилгын галын аюулгүй байдал
  norms_mns_6058?: boolean; // MNS 6058 (АС)

  /* ─── Heat source ─────────────────────────────────────────── */
  heat_source_kind?: 'district' | 'central_own' | 'boiler' | 'heat_pump' | 'electric';
  heat_supply_temp?: string; // °C (supply)
  heat_return_temp?: string; // °C (return)
  heat_design_outdoor_temp?: string; // °C
  heat_load_total?: string; // кВт
  heat_pipe_routing?: 'bottom_dead_end' | 'bottom_ring' | 'top_distribution';

  /* ─── Heating system ─────────────────────────────────────── */
  heat_zoning_text?: string; // textarea narrative
  heat_devices_panel?: boolean; // панел радиатор
  heat_devices_cast?: boolean; // цутгамал радиатор
  heat_devices_convector?: boolean; // конвектор
  heat_devices_fan_coil?: boolean; // fan coil
  heat_devices_floor?: boolean; // шалны халаалт
  heat_devices_other?: string;
  heat_system_pressure?: string; // бар
  heat_individual_metering?: boolean;

  /* ─── Ventilation ─────────────────────────────────────────── */
  vent_supply_mech?: boolean; // механик нийлүүлэлт
  vent_exhaust_mech?: boolean; // механик сорогт
  vent_natural_exhaust?: boolean; // байгалийн сорогт
  vent_heat_recovery?: boolean; // дулаан буцаах
  vent_wc_full_mechanical?: boolean; // АЦО 100% механик сорогт
  vent_service_supply?: boolean; // үйлчилгээний хэсэг механик нийлүүлэлт
  vent_parking_pressurized?: boolean; // зогсоол даралттай
  vent_ring_ducts?: boolean; // дугуй хоолой
  vent_narrative?: string; // free-text

  /* ─── AC / Cooling ────────────────────────────────────────── */
  ac_system_kind?: 'vrv' | 'split' | 'chilled_water' | 'mixed' | 'none';
  ac_outdoor_placement?: string; // text (1-2 давхар + дээвэр гэх мэт)
  ac_indoor_kinds?: string; // text (cassette / wall / duct)
  ac_independent_per_floor?: boolean;
  ac_service_dedicated_tech_room?: boolean;
  ac_narrative?: string;

  /* ─── Smoke protection ────────────────────────────────────── */
  smoke_main_stair_pressurized?: boolean;
  smoke_dedicated_ff_lift_shaft?: boolean;
  smoke_corridor_extract?: boolean;
  smoke_lobby_pressurized?: boolean;
  smoke_vestibule_2stage?: boolean;
  smoke_extract_method?: 'natural' | 'mechanical' | 'hybrid';
  smoke_narrative?: string;

  /* ─── Tech room / fire reserves ───────────────────────────── */
  techroom_floor?: string; // e.g. "B1"
  techroom_water_reserve_domestic?: string; // м³
  techroom_water_reserve_fire?: string; // м³
  techroom_pump_sound_dampening?: boolean;
  techroom_narrative?: string;

  /* ─── Drawing list ───────────────────────────────────────── */
  dl_cover?: boolean; // 1
  dl_drawing_list?: boolean; // 2
  dl_explanatory_note?: boolean; // 3
  dl_heating_plan?: boolean; // 4
  dl_vent_plan?: boolean; // 5
  dl_ac_plan?: boolean; // 6
  dl_smoke_plan?: boolean; // 7
  dl_riser_diagram?: boolean; // 8 (шугам холболтын схем)
  dl_equipment_schedule?: boolean; // 9 (тоног төхөөрөмжийн жагсаалт)
  dl_sections?: boolean; // 10
  dl_details?: boolean; // 11

  /* ─── Signatures ──────────────────────────────────────────── */
  sig_hvac_engineer_name?: string;
  sig_hvac_engineer_license?: string;
  sig_pm_name?: string;
  sig_pm_license?: string;
  sig_director_name?: string;
  sig_approval_date?: string;
}
