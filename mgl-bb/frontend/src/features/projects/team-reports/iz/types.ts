/* =============================================================
 * IZ (Интерьер зураг) report answer shapes.
 * -------------------------------------------------------------
 * Бодит MGL интерьер тайлан нь БҮС × ӨНГӨЛГӨӨ, ТОНОГЛОЛ бүтэцтэй + 3D
 * рендерийн индекстэй. Тиймээс давтагдах `zone-rows` ба
 * `floor-areas-rows` widget-ийн мөрийн хэлбэрийг энд нарийсгана.
 * Эдгээр нь AccordionForm доторх ижил нэртэй мөрийн хэлбэртэй
 * бүтцийн хувьд тохирно.
 * ============================================================= */

/** Нэг бүсийн өнгөлгөө, тоноглолын шийдэл (zone-rows мөр). */
export interface IzZoneRow {
  name: string;
  wall: string;
  floor: string;
  ceiling: string;
  lighting: string;
  doors: string;
  furniture: string;
  fixtures: string;
  general: string;
}

/** Рендер индексийн нэг хэсэг (давхрын дэд мөр). */
export interface IzRenderArea {
  name: string;
  pages: string;
}

/** Рендер индексийн нэг давхар (floor-areas-rows мөр). */
export interface IzRenderFloor {
  floor: string;
  firstPage: string;
  areas: IzRenderArea[];
}

export interface IzReportAnswers {
  /** Ерөнхий шийдэл / концепц. */
  iz_concept?: string;
  /** Бүсчлэлийн шийдэл (бүс × өнгөлгөө, тоноглол). */
  iz_zones?: IzZoneRow[];
  /** 3D рендерийн индекс. */
  iz_render_index?: IzRenderFloor[];

  /** Интерьерийн зургийн жагсаалт. */
  dl_wall_model?: boolean;
  dl_floor_model?: boolean;
  dl_ceiling_model?: boolean;
  dl_furniture_model?: boolean;
  dl_demo_wall_layout?: boolean;
  dl_main_layout?: boolean;
  dl_ceiling_layout?: boolean;
  dl_floor_layout?: boolean;
  dl_lighting_layout?: boolean;
  dl_furniture_layout?: boolean;
  dl_sockets_switches?: boolean;
  dl_comms_alarm?: boolean;
  dl_wall_elevations?: boolean;
  dl_furniture_details?: boolean;
  dl_ceiling_wall_sections?: boolean;
  dl_quantities?: boolean;
}
