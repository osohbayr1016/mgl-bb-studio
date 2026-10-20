/* =============================================================
 * АУ team Тайлбар бичиг — types.
 * -------------------------------------------------------------
 * Барилгын инженерийн системийн автоматжуулалт.  АУ нь HAS,
 * ЦБУ, ЦАХ, ХД-ын даалгаврыг шууд авдаг тул бусад баг
 * тогтворжтой нь ажиллаж дуусгахын өмнө бүрэн дуусч чадахгүй
 * (committee feedback тэмдэглэгдэв).  Backend team_code = 'AU'.
 * ============================================================= */

export interface AuReportAnswers {
  /* ─── Header ──────────────────────────────────────────────── */
  building_name?: string;
  building_location?: string;
  client_name?: string;
  design_year?: string;
  design_month?: string;

  // Design basis + Classification fields moved to BA — architects
  // author them once and the data is shared across disciplines.

  /** АУ багийн ажил нь дараах багуудын зураг төсөл зохиогчийн
   *  даалгаврыг шууд авдаг — хэн тогтворжсон, хэн дутуу гэдгийг
   *  тэмдэглэх checkbox-ууд + хүлээгдэж буй даалгаврын тэмдэглэл. */
  input_from_has?: boolean;
  input_from_cbu?: boolean;
  input_from_tsah?: boolean;
  input_from_hd?: boolean;
  input_from_client?: boolean;
  input_pending_text?: string;

  /* ─── Norms ──────────────────────────────────────────────── */
  norms_bnbd_31_17_10?: boolean; // Өндөр барилгын төлөвлөлт
  norms_bnbd_21_01_02?: boolean; // Барилгын галын аюулгүй байдал
  norms_bnbd_21_02_02?: boolean; // Зураг төслийн галын норм
  norms_bnbd_21_04_05?: boolean; // Гал унтраах автомат, дохиолол
  norms_mns_iso_16484?: boolean; // BMS стандарт
  norms_mns_kn_x?: boolean; // KNX / интегратив автоматжуулалт

  /* ─── Building Management System (BMS) ─────────────────────── */
  bms_present?: boolean;
  bms_protocol?: 'bacnet' | 'modbus' | 'knx' | 'mixed';
  bms_monitors_hvac?: boolean; // халаалт, агаар сэлгэлт
  bms_monitors_lighting?: boolean;
  bms_monitors_water?: boolean; // насос, нөөц
  bms_monitors_power?: boolean; // цахилгаан
  bms_monitors_smoke?: boolean;
  bms_monitors_access?: boolean;
  bms_scheduling?: boolean; // ажиллах цагийн хуваарь
  bms_alarms?: boolean; // алармын систем
  bms_narrative?: string;

  /* ─── Home automation ────────────────────────────────────── */
  home_auto_present?: boolean; // айл бүрд home автомат
  home_auto_lighting?: boolean;
  home_auto_climate?: boolean; // халаалт хөргөлт
  home_auto_security?: boolean;
  home_auto_window_blinds?: boolean;
  home_auto_app_control?: boolean; // утсан аппликейшнтай
  home_auto_voice_control?: boolean;
  home_auto_narrative?: string;

  /* ─── Inter-discipline integration ───────────────────────── */
  /** Олон системийг нэгтгэх зорилгот заавал онцлох зүйлс. */
  integ_fa_smoke_extract?: boolean; // гал дохиолол ⇒ утаа зайлуулах
  integ_fa_pa?: boolean; // гал дохиолол ⇒ зарлан мэдээлэл
  integ_fa_access_unlock?: boolean; // гал дохиолол ⇒ нэвтрэх нээх
  integ_fa_lift_recall?: boolean; // гал ⇒ лифт 1-р давхар уриалах
  integ_fa_hvac_shutdown?: boolean; // гал ⇒ ХАС зогсох
  integ_security_cctv?: boolean; // нэвтрэх ⇒ CCTV бичих
  integ_lighting_motion?: boolean; // хөдөлгөөн ⇒ гэрэлтүүлэг
  integ_narrative?: string;

  /* ─── Monitoring room (БУС нэгдсэн хяналтын өрөө) ─────────── */
  monitoring_room_floor?: string; // "1F"
  monitoring_room_area?: string; // м²
  monitoring_unified_per_block?: boolean; // хоёр блок нэгдсэн хяналттай
  monitoring_24_7_staffed?: boolean; // 24/7 ажилтантай
  monitoring_narrative?: string;

  /* ─── Drawing list ───────────────────────────────────────── */
  dl_cover?: boolean;
  dl_drawing_list?: boolean;
  dl_explanatory_note?: boolean;
  dl_bms_architecture?: boolean; // BMS системийн архитектур
  dl_bms_io_list?: boolean; // мэдрэгч / удирдлагын I/O жагсаалт
  dl_home_auto?: boolean;
  dl_integration_diagram?: boolean; // системүүдийн уялдааны схем
  dl_monitoring_room?: boolean;
  dl_equipment_schedule?: boolean;
  dl_details?: boolean;

  /* ─── Signatures ──────────────────────────────────────────── */
  sig_automation_engineer_name?: string;
  sig_automation_engineer_license?: string;
  sig_pm_name?: string;
  sig_pm_license?: string;
  sig_director_name?: string;
  sig_approval_date?: string;
}
