/* =============================================================
 * ХД team Тайлбар бичиг — types.
 * -------------------------------------------------------------
 * Холбоо, дохиолол, мэдээлэл, дотоод сүлжээ, хяналт хамгаалалт,
 * гал дохиолол, зарлан мэдээлэл, UPS.  Backend team_code = 'HD'.
 * ============================================================= */

export interface HdReportAnswers {
  /* ─── Header ──────────────────────────────────────────────── */
  building_name?: string;
  building_location?: string;
  client_name?: string;
  design_year?: string;
  design_month?: string;

  // Design basis + Classification fields moved to BA — architects
  // author them once and the data is shared across disciplines.

  /* ─── Norms ──────────────────────────────────────────────── */
  norms_bnbd_31_17_10?: boolean; // Өндөр барилгын төлөвлөлт
  norms_bnbd_21_04_05?: boolean; // Гал унтраах автомат, дохиолол
  norms_bnbd_21_04_04?: boolean; // Барилгын галын автомат хамгаалалт
  norms_mns_5532?: boolean; // Холбоо мэдээллийн ерөнхий шаардлага
  norms_mns_6586?: boolean; // Гал дохиоллын систем
  norms_mns_iec_62676?: boolean; // CCTV систем
  norms_mns_iec_62305?: boolean; // Аянгаас хамгаалах

  /* ─── Fiber / Server room ─────────────────────────────────── */
  fiber_inlet_cores?: string; // 12 core fiber
  fiber_inlet_route?: string; // textarea (subugchlal, depth)
  server_room_floor?: string; // "B1"
  server_room_area?: string; // м²
  ip_telephony_present?: boolean;
  per_floor_signal_cabinet?: boolean;

  /* ─── Phone + Computer net ────────────────────────────────── */
  phone_per_office?: boolean; // оффис бүрд телефон
  phone_separate_service_res?: boolean; // үйлчилгээ, орон сууц тусдаа
  computer_multi_isp?: boolean; // олон ISP-ийн үйлчилгээ
  computer_per_office?: boolean;
  computer_separate_service_res?: boolean;
  network_speed?: string; // 1 Гбит/сек гэх мэт
  cable_category?: string; // CAT6 / CAT6A

  /* ─── Mobile booster + cable TV ───────────────────────────── */
  mobile_booster_basement?: boolean; // B1, B2 давхар
  mobile_booster_high_floors?: boolean; // 15+ давхар
  cable_tv_present?: boolean;
  cable_tv_topology?: 'star' | 'tree' | 'mixed';

  /* ─── Access control ─────────────────────────────────────── */
  access_main_entry?: boolean;
  access_server_room?: boolean;
  access_comms_rooms?: boolean;
  access_auto_unlock_on_fire?: boolean;
  access_kind?: 'card' | 'biometric' | 'pin' | 'mixed';
  access_narrative?: string;

  /* ─── CCTV ────────────────────────────────────────────────── */
  cctv_camera_count?: string; // тоо
  cctv_camera_min_resolution?: string; // 4MP / 8MP
  cctv_nvr_retention_days?: string; // 30 хоног
  cctv_coverage_text?: string; // textarea (where covered)
  cctv_outdoor_cameras?: boolean;
  cctv_lift_cabs?: boolean;
  cctv_parking?: boolean;
  cctv_poe_powered?: boolean;
  cctv_max_cable_run?: string; // 90м гэх мэт
  cctv_monitor_size?: string; // 42"
  cctv_monitor_floor?: string; // "1F"

  /* ─── Fire alarm + PA ─────────────────────────────────────── */
  fa_facp_location?: string; // "1-р давхрын хяналтын өрөө"
  fa_addressable?: boolean; // хаягжуулсан мэдрэгч
  fa_manual_call_points?: boolean; // гар дуудлагын товч
  fa_fire_rated_cabling?: boolean; // галд тэсвэртэй кабель
  fa_facp_controls_smoke?: boolean; // FACP-аас утаа сорогт удирдлага
  fa_facp_controls_doors?: boolean;
  fa_facp_controls_pa?: boolean;
  pa_present?: boolean;
  pa_background_music?: boolean;
  pa_emergency_override?: boolean;
  pa_zoned?: boolean;

  /* ─── UPS ─────────────────────────────────────────────────── */
  ups_present?: boolean;
  ups_autonomy_hours?: string; // 3-4 цаг
  ups_covers_text?: string; // textarea

  /* ─── Drawing list ───────────────────────────────────────── */
  dl_cover?: boolean;
  dl_drawing_list?: boolean;
  dl_explanatory_note?: boolean;
  dl_phone_plan?: boolean;
  dl_computer_plan?: boolean;
  dl_cctv_plan?: boolean;
  dl_access_plan?: boolean;
  dl_fa_plan?: boolean;
  dl_pa_plan?: boolean;
  dl_cable_tv_plan?: boolean;
  dl_server_room?: boolean;
  dl_riser_diagram?: boolean;
  dl_equipment_schedule?: boolean;
  dl_details?: boolean;

  /* ─── Signatures ──────────────────────────────────────────── */
  sig_comms_engineer_name?: string;
  sig_comms_engineer_license?: string;
  sig_pm_name?: string;
  sig_pm_license?: string;
  sig_director_name?: string;
  sig_approval_date?: string;
}
