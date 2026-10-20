/* =============================================================
 * Team-report FIELD CATALOG (backend copy of the frontend templates).
 * -------------------------------------------------------------
 * AUTO-EXTRACTED from frontend/src/features/projects/team-reports/<team>/template.ts
 * (via the extract-team-report-catalog workflow, 2026-07-21).  Maps each
 * team-report answer `key` -> human label + kind (+ select options, + row-widget
 * column labels) so the get_team_reports MCP tool can return LABELLED sections
 * instead of raw keys.
 *
 * ⚠ This is a DUPLICATE of the frontend template definitions.  If a template's
 * field keys/labels change in the frontend, re-run the workflow to regenerate
 * this file (labels are display-only; unknown keys still fall through as raw).
 * Do NOT hand-edit — regenerate.
 * ============================================================= */

export interface CatalogFieldOption { value: string; label: string }
export interface CatalogFieldColumn { key: string; label: string }
export interface CatalogField {
  key: string;
  label: string;
  kind: string;
  variants?: string[];
  options?: CatalogFieldOption[];
  columns?: CatalogFieldColumn[];
}
export interface CatalogSection { id: string; title: string; fields: CatalogField[] }
export interface CatalogTeam { team_code: string; variant_note?: string; sections: CatalogSection[] }

/** team_code (uppercase) -> its section/field catalog. */
export const TEAM_REPORT_CATALOG: Record<string, CatalogTeam> = {
  "BA": {
    "team_code": "BA",
    "variant_note": "BA uses a top-level building_type variant discriminator with two values: 'rc' (СОНГОЛТ А — Төмөр бетон цутгамал каркас) and 'steel' (СОНГОЛТ Б — Металл каркас), chosen in BaPanel before the form renders. Fields tagged variants:['rc'] show only for the rc frame system; variants:['steel'] only for the metal frame; fields with no variants apply to both. No SectionDef itself is variant-gated (only individual fields are). The variant is passed to AccordionForm as `variant` and filters which fields render/count.",
    "sections": [
      {
        "id": "climate",
        "title": "Уур амьсгалын үзүүлэлт",
        "fields": [
          {
            "key": "climate_station",
            "label": "Цаг уурын станц",
            "kind": "text"
          },
          {
            "key": "climate_temp_avg_annual",
            "label": "Жилийн дундаж агаарын т°",
            "kind": "text"
          },
          {
            "key": "climate_temp_max",
            "label": "Үнэмлэхүй хамгийн их т°",
            "kind": "text"
          },
          {
            "key": "climate_temp_july_max_avg",
            "label": "YII сарын үнэмлэхүй их дундаж",
            "kind": "text"
          },
          {
            "key": "climate_temp_min",
            "label": "Үнэмлэхүй хамгийн бага т°",
            "kind": "text"
          },
          {
            "key": "climate_temp_jan_min_avg",
            "label": "I сарын үнэмлэхүй бага дундаж",
            "kind": "text"
          },
          {
            "key": "climate_temp_heating_avg",
            "label": "Халаалтын улирлын дундаж",
            "kind": "text"
          },
          {
            "key": "climate_heating_grad",
            "label": "Халаалтын улирлын эрчим (град)",
            "kind": "text"
          },
          {
            "key": "climate_precip_annual",
            "label": "Хур тунадасны жилийн дундаж",
            "kind": "text"
          },
          {
            "key": "climate_wind_avg",
            "label": "Салхины жилийн дундаж хурд",
            "kind": "text"
          },
          {
            "key": "climate_temp_soil_avg",
            "label": "Хөрсний гадаргын жилийн дундаж",
            "kind": "text"
          },
          {
            "key": "climate_wind_cold_3mo",
            "label": "Хамгийн хүйтэн 3 сарын салхины дундаж",
            "kind": "text"
          },
          {
            "key": "climate_snow_load",
            "label": "Цасны ачааллын нормчилсон утга",
            "kind": "text"
          },
          {
            "key": "climate_zone",
            "label": "Уур амьсгалын бүс",
            "kind": "text"
          },
          {
            "key": "climate_wind_5yr_pressure",
            "label": "5 жил тутамд тохиох салхины даралт",
            "kind": "text"
          }
        ]
      },
      {
        "id": "general-plan",
        "title": "Ерөнхий төлөвлөгөө",
        "fields": [
          {
            "key": "gp_alignment_with",
            "label": "Уялдуулсан зүйл",
            "kind": "text"
          },
          {
            "key": "gp_main_entrance_count",
            "label": "Үндсэн орц",
            "kind": "number"
          },
          {
            "key": "gp_main_entrance_side",
            "label": "Үндсэн орцны байрлал",
            "kind": "text"
          },
          {
            "key": "gp_service_entrance_count",
            "label": "Туслах орц",
            "kind": "number"
          },
          {
            "key": "gp_parking_entrance_count",
            "label": "Авто зогсоолын орц гарц",
            "kind": "number"
          },
          {
            "key": "gp_ramp_count",
            "label": "ХБИ-д зориулсан пандус",
            "kind": "number"
          }
        ]
      },
      {
        "id": "layout",
        "title": "Төлөвлөлт / Архитектур төлөвлөлт",
        "fields": [
          {
            "key": "plan_layout_kind",
            "label": "Төлөвлөлтийн төрөл",
            "kind": "select",
            "options": [
              {
                "value": "single",
                "label": "Нэг блок, олон давхар"
              },
              {
                "value": "multi",
                "label": "Олон блокт цогцолбор"
              }
            ]
          },
          {
            "key": "plan_dimensions",
            "label": "Тэнхлэгийн хэмжээ",
            "kind": "text"
          },
          {
            "key": "plan_basement_floors",
            "label": "Зоорийн давхар",
            "kind": "number"
          },
          {
            "key": "plan_above_ground_floors",
            "label": "Газраас дээш давхар",
            "kind": "number"
          },
          {
            "key": "plan_blocks",
            "label": "Блокуудын жагсаалт",
            "kind": "block-rows",
            "columns": [
              {
                "key": "name",
                "label": "Блок"
              },
              {
                "key": "dimensions",
                "label": "Хэмжээ"
              },
              {
                "key": "height",
                "label": "Өндөр"
              },
              {
                "key": "floors",
                "label": "Давхар"
              },
              {
                "key": "purpose",
                "label": "Зориулалт"
              }
            ]
          },
          {
            "key": "plan_main_structure_notes",
            "label": "Үндсэн бүтээцийн тайлбар",
            "kind": "textarea"
          },
          {
            "key": "plan_floor_purposes",
            "label": "Давхар бүрийн зориулалт",
            "kind": "floor-rows",
            "columns": [
              {
                "key": "floor",
                "label": "Давхар"
              },
              {
                "key": "purpose",
                "label": "Зориулалт"
              }
            ]
          }
        ]
      },
      {
        "id": "structure",
        "title": "Барилгын бүтээц",
        "fields": [
          {
            "key": "rc_wall_thickness",
            "label": "Төмөр бетон ханын зузаан",
            "kind": "number",
            "variants": [
              "rc"
            ]
          },
          {
            "key": "rc_foundation_type",
            "label": "Суурийн төрөл",
            "kind": "select",
            "variants": [
              "rc"
            ],
            "options": [
              {
                "value": "mat",
                "label": "Нил хавтан суурь"
              },
              {
                "value": "cup",
                "label": "Аяган суурь"
              },
              {
                "value": "strip",
                "label": "Шугаман суурь"
              }
            ]
          },
          {
            "key": "rc_slab_thickness",
            "label": "Хучилтын зузаан",
            "kind": "number",
            "variants": [
              "rc"
            ]
          },
          {
            "key": "steel_basement_floor",
            "label": "Зоорийн давхар (төмөр бетон)",
            "kind": "text",
            "variants": [
              "steel"
            ]
          },
          {
            "key": "steel_slab_thickness",
            "label": "Хучилт (металл тавцантай ТБ)",
            "kind": "number",
            "variants": [
              "steel"
            ]
          }
        ]
      },
      {
        "id": "roof",
        "title": "Дээвэр",
        "fields": [
          {
            "key": "roof_xps_thickness",
            "label": "XPS пеноплекс дулаалга",
            "kind": "number",
            "variants": [
              "rc"
            ]
          },
          {
            "key": "roof_screed_thickness",
            "label": "Бетон тэгшилгээ (тортой)",
            "kind": "number",
            "variants": [
              "rc"
            ]
          },
          {
            "key": "roof_xps_range_from",
            "label": "XPS хөөсөнцөр доод хязгаар",
            "kind": "number",
            "variants": [
              "steel"
            ]
          },
          {
            "key": "roof_xps_range_to",
            "label": "XPS хөөсөнцөр дээд хязгаар",
            "kind": "number",
            "variants": [
              "steel"
            ]
          },
          {
            "key": "roof_eps_range_from",
            "label": "EPS хөөсөнцөр доод хязгаар",
            "kind": "number",
            "variants": [
              "steel"
            ]
          },
          {
            "key": "roof_eps_range_to",
            "label": "EPS хөөсөнцөр дээд хязгаар",
            "kind": "number",
            "variants": [
              "steel"
            ]
          },
          {
            "key": "roof_concrete_screed_thickness",
            "label": "Бетон тэгшилгээ",
            "kind": "number",
            "variants": [
              "steel"
            ]
          },
          {
            "key": "roof_usable",
            "label": "Ашиглалттай дээвэртэй",
            "kind": "checkbox"
          },
          {
            "key": "roof_usable_sand_thickness",
            "label": "Элсний зузаан",
            "kind": "number"
          }
        ]
      },
      {
        "id": "ext-wall",
        "title": "Гадна хана",
        "fields": [
          {
            "key": "basement_rc_wall_thickness",
            "label": "Зоорийн ТБ хана",
            "kind": "number"
          },
          {
            "key": "basement_xps_thickness",
            "label": "Зоорийн XPS дулаалга",
            "kind": "number"
          },
          {
            "key": "basement_konkrevol_thickness",
            "label": "Конкреволл хавтан",
            "kind": "number"
          },
          {
            "key": "ext_finish_kind",
            "label": "Гадна өнгөлгөө",
            "kind": "select",
            "variants": [
              "rc"
            ],
            "options": [
              {
                "value": "metal_cladding",
                "label": "Хөнгөн цагаан металл хавтан систем"
              },
              {
                "value": "glass_facade",
                "label": "3 давхар шилэн фасад"
              },
              {
                "value": "stone_cladding",
                "label": "Байгалийн чулуун хавтан"
              }
            ]
          },
          {
            "key": "ext_rc_thickness",
            "label": "Гадна ТБ ханын зузаан",
            "kind": "number",
            "variants": [
              "rc"
            ]
          },
          {
            "key": "ext_masonry_thickness",
            "label": "Хүчитгэлтэй өрлөгөн ханын зузаан",
            "kind": "number",
            "variants": [
              "rc"
            ]
          },
          {
            "key": "ext_stone_wool_thickness",
            "label": "Чулуун хөвөн дулаалга",
            "kind": "number",
            "variants": [
              "rc"
            ]
          },
          {
            "key": "ext_stone_thickness",
            "label": "Чулуун хавтан өнгөлгөөний зузаан",
            "kind": "number",
            "variants": [
              "rc"
            ]
          },
          {
            "key": "sandwich_total_thickness",
            "label": "Сэндвич хавтангийн нийт зузаан",
            "kind": "number",
            "variants": [
              "steel"
            ]
          },
          {
            "key": "sandwich_outer_metal",
            "label": "Гадна металл лист",
            "kind": "number",
            "variants": [
              "steel"
            ]
          },
          {
            "key": "sandwich_inner_metal",
            "label": "Дотор металл лист",
            "kind": "number",
            "variants": [
              "steel"
            ]
          },
          {
            "key": "ext_heat_resistance_target",
            "label": "Гадна ханын дулаан дамжуулалт ≤",
            "kind": "text"
          },
          {
            "key": "facade_heat_resistance_target",
            "label": "Шилэн фасадны дулаан дамжуулалт ≥",
            "kind": "text"
          }
        ]
      },
      {
        "id": "int-wall",
        "title": "Дотор хана / хамар хана",
        "fields": [
          {
            "key": "int_basement_min",
            "label": "Зоорийн дотор ханын зузаан (доод)",
            "kind": "number",
            "variants": [
              "rc"
            ]
          },
          {
            "key": "int_basement_max",
            "label": "Зоорийн дотор ханын зузаан (дээд)",
            "kind": "number",
            "variants": [
              "rc"
            ]
          },
          {
            "key": "int_apartment_thickness",
            "label": "Айл хоорондын хана",
            "kind": "number",
            "variants": [
              "rc"
            ]
          },
          {
            "key": "int_bedroom_thickness",
            "label": "Унтлагын/зочны өрөө хоорондын хана",
            "kind": "number",
            "variants": [
              "rc"
            ]
          },
          {
            "key": "int_bathroom_thickness",
            "label": "Ариун цэврийн өрөөний хана",
            "kind": "number",
            "variants": [
              "rc"
            ]
          },
          {
            "key": "int_sandwich_thickness",
            "label": "Үндсэн сэндвич хамар хана",
            "kind": "number",
            "variants": [
              "steel"
            ]
          },
          {
            "key": "int_cold_room_thickness",
            "label": "Хөргүүртэй кабины хана",
            "kind": "number",
            "variants": [
              "steel"
            ]
          },
          {
            "key": "int_fire_sandwich_thickness",
            "label": "Шарах шүүгээний галд тэсвэртэй хана",
            "kind": "number",
            "variants": [
              "steel"
            ]
          }
        ]
      },
      {
        "id": "glazing",
        "title": "Шилэн фасад, цонх",
        "fields": [
          {
            "key": "glazed_facade_kind",
            "label": "Шилэн ханын төрөл",
            "kind": "select",
            "options": [
              {
                "value": "metal_3layer_vacuum",
                "label": "Металл рам, 3 давхар вакуум"
              },
              {
                "value": "unitized_2layer",
                "label": "Юнитайз, 2 давхар (Low-E)"
              }
            ]
          },
          {
            "key": "glass_frame_u",
            "label": "Шилэн ханын рам U",
            "kind": "text"
          },
          {
            "key": "glass_transom_u",
            "label": "Шилэн ханын трансом U",
            "kind": "text"
          },
          {
            "key": "glass_unit_u",
            "label": "Шиллэгээний U",
            "kind": "text"
          },
          {
            "key": "unitized_outer_glass_thickness",
            "label": "Гадна шилний зузаан",
            "kind": "number"
          },
          {
            "key": "unitized_inner_glass_thickness",
            "label": "Дотор шилний зузаан",
            "kind": "number"
          },
          {
            "key": "unitized_light_transmission",
            "label": "Гэрэл нэвтрүүлэлт",
            "kind": "text"
          },
          {
            "key": "window_kind",
            "label": "Цонхны төрөл",
            "kind": "select",
            "options": [
              {
                "value": "metal_3layer_vacuum",
                "label": "Металл рам, 3 давхар вакуум"
              },
              {
                "value": "pvc_vacuum",
                "label": "Хуванцар рам, вакуум"
              }
            ]
          },
          {
            "key": "window_fire_rating_hours",
            "label": "Цонхны гал тэсвэрлэлт",
            "kind": "text"
          }
        ]
      },
      {
        "id": "floor",
        "title": "Шал",
        "fields": [
          {
            "key": "floor_metal_deck_thickness",
            "label": "Металл тавцантай ТБ зузаан",
            "kind": "number",
            "variants": [
              "steel"
            ]
          },
          {
            "key": "floor_screed_thickness_min",
            "label": "Бетон тэгшилгээ (доод)",
            "kind": "number"
          },
          {
            "key": "floor_screed_thickness_max",
            "label": "Бетон тэгшилгээ (дээд)",
            "kind": "number"
          },
          {
            "key": "floor_hollow_thickness",
            "label": "Хөндий шалны зузаан",
            "kind": "number",
            "variants": [
              "steel"
            ]
          }
        ]
      },
      {
        "id": "drawing-list",
        "title": "Архитектурын зургийн жагсаалт",
        "fields": [
          {
            "key": "dl_cover",
            "label": "1.  Нүүр хуудас",
            "kind": "checkbox"
          },
          {
            "key": "dl_general_plan",
            "label": "2.  Ерөнхий төлөвлөгөө, зай хэмжээ, тохижилт, картограмм",
            "kind": "checkbox"
          },
          {
            "key": "dl_drawing_list",
            "label": "3.  Зургийн жагсаалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_explanatory_note",
            "label": "4.  Тайлбар бичиг",
            "kind": "checkbox"
          },
          {
            "key": "dl_floor_plans",
            "label": "5.  Давхрын байгуулалтууд",
            "kind": "checkbox"
          },
          {
            "key": "dl_roof_plan",
            "label": "6.  Дээврийн байгуулалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_sections",
            "label": "7.  Огтлолууд",
            "kind": "checkbox"
          },
          {
            "key": "dl_facades",
            "label": "8.  Нүүр талууд",
            "kind": "checkbox"
          },
          {
            "key": "dl_bathroom",
            "label": "9.  Ариун цэврийн өрөөний хэсэглэл, дэлгээс",
            "kind": "checkbox"
          },
          {
            "key": "dl_door_window",
            "label": "10. Цонх, хаалганы схем, бүтэц, түүвэр",
            "kind": "checkbox"
          },
          {
            "key": "dl_glass_wall",
            "label": "11. Шилэн ханын нэгдсэн түүвэр",
            "kind": "checkbox"
          },
          {
            "key": "dl_system_detail",
            "label": "12. Систем деталь",
            "kind": "checkbox"
          },
          {
            "key": "dl_wall_section",
            "label": "13. Ханын хэсэглэл",
            "kind": "checkbox"
          },
          {
            "key": "dl_floor_assembly",
            "label": "14. Шалны байгуулалтууд",
            "kind": "checkbox"
          },
          {
            "key": "dl_floor_ceiling_detail",
            "label": "15. Шал, таазны хийц, бүтэц, түүвэр",
            "kind": "checkbox"
          },
          {
            "key": "dl_ceiling_assembly",
            "label": "16. Таазны байгуулалтууд",
            "kind": "checkbox"
          },
          {
            "key": "dl_elevator",
            "label": "17. Цахилгаан шат, шатны хэсэглэл",
            "kind": "checkbox"
          },
          {
            "key": "dl_outdoor_porch",
            "label": "18. Гадна довжоо, шатны хэсэглэл",
            "kind": "checkbox"
          },
          {
            "key": "dl_fire_stair",
            "label": "19. Галын шатны хэсэглэл",
            "kind": "checkbox"
          },
          {
            "key": "dl_technology",
            "label": "20. Технологийн байгуулалтууд",
            "kind": "checkbox"
          },
          {
            "key": "dl_other",
            "label": "21. Бусад нарийн хэсэглэл",
            "kind": "checkbox"
          }
        ]
      },
      {
        "id": "tez",
        "title": "Техник эдийн засгийн үзүүлэлт",
        "fields": [
          {
            "key": "tez_floor_count",
            "label": "Давхрын тоо",
            "kind": "number"
          },
          {
            "key": "tez_capacity",
            "label": "Хүчин чадал",
            "kind": "text"
          },
          {
            "key": "tez_volume_m3",
            "label": "Барилгын эзэлхүүн",
            "kind": "number"
          },
          {
            "key": "tez_built_area_m2",
            "label": "Барилгажилтын талбай",
            "kind": "number"
          },
          {
            "key": "tez_useful_area_m2",
            "label": "Ашигтай талбай",
            "kind": "number"
          },
          {
            "key": "tez_working_area_m2",
            "label": "Ажлын талбай",
            "kind": "number"
          },
          {
            "key": "tez_k1",
            "label": "K1 (Sаж/Sаш)",
            "kind": "text"
          },
          {
            "key": "tez_k2",
            "label": "K2",
            "kind": "text"
          }
        ]
      }
    ]
  },
  "BB": {
    "team_code": "BB",
    "sections": [
      {
        "id": "soil",
        "title": "Геотехникийн нөхцөл",
        "fields": [
          {
            "key": "soil_narrative",
            "label": "Хөрсний нөхцлийн товч тайлбар",
            "kind": "textarea"
          },
          {
            "key": "soil_groundwater_depth",
            "label": "Газрын доорх усны түвшин",
            "kind": "text"
          },
          {
            "key": "soil_freezing_depth",
            "label": "Хөрс хөлдөлтийн гүн",
            "kind": "text"
          },
          {
            "key": "soil_seismic_category",
            "label": "Хөрсний газар хөдлөлтийн анги",
            "kind": "select",
            "options": [
              {
                "value": "I",
                "label": "I (хатуу чулуулаг)"
              },
              {
                "value": "II",
                "label": "II (хатуу хөрс)"
              },
              {
                "value": "III",
                "label": "III (зөөлөн хөрс)"
              }
            ]
          },
          {
            "key": "soil_rqd_min",
            "label": "Хамгийн бага RQD утга",
            "kind": "text"
          },
          {
            "key": "soil_design_resistance",
            "label": "Хөрсний тооцооны эсэргүүцэл R0",
            "kind": "text"
          },
          {
            "key": "soil_special_conditions",
            "label": "Онцгой нөхцөл, нөлөөлөл",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "foundation",
        "title": "Суурь",
        "fields": [
          {
            "key": "foundation_type",
            "label": "Суурийн төрөл",
            "kind": "select",
            "options": [
              {
                "value": "mat",
                "label": "Нил хавтан суурь"
              },
              {
                "value": "strip",
                "label": "Шугаман суурь"
              },
              {
                "value": "cup",
                "label": "Аяган суурь"
              },
              {
                "value": "pile",
                "label": "Шонгийн суурь"
              },
              {
                "value": "hybrid",
                "label": "Холимог суурь"
              }
            ]
          },
          {
            "key": "foundation_depth",
            "label": "Суурийн гүн",
            "kind": "text"
          },
          {
            "key": "foundation_thickness",
            "label": "Суурийн зузаан",
            "kind": "number"
          },
          {
            "key": "foundation_concrete_grade",
            "label": "Бетоны марк",
            "kind": "text"
          },
          {
            "key": "foundation_water_class",
            "label": "Усны эсэргүүцлийн анги",
            "kind": "text"
          },
          {
            "key": "foundation_rebar_main",
            "label": "Үндсэн арматур",
            "kind": "text"
          },
          {
            "key": "foundation_rebar_aux",
            "label": "Туслах арматур",
            "kind": "text"
          },
          {
            "key": "foundation_settlement_max",
            "label": "Зөвшөөрөгдөх хамгийн их суулт",
            "kind": "text"
          }
        ]
      },
      {
        "id": "framing",
        "title": "Үндсэн каркас (даацын систем)",
        "fields": [
          {
            "key": "lateral_system",
            "label": "Үндсэн системийн төрөл",
            "kind": "select",
            "options": [
              {
                "value": "cast_in_place",
                "label": "Бүрэн цутгамал төмөр бетон"
              },
              {
                "value": "rc_frame",
                "label": "Рам-холбоост ТБ каркас"
              },
              {
                "value": "shear_wall",
                "label": "ТБ ханан даацт"
              },
              {
                "value": "steel_frame",
                "label": "Металл каркас"
              },
              {
                "value": "hybrid",
                "label": "Холимог систем"
              }
            ]
          },
          {
            "key": "wall_thickness",
            "label": "Хана / цөмийн зузаан",
            "kind": "number"
          },
          {
            "key": "column_grid",
            "label": "Баганын алслал",
            "kind": "text"
          },
          {
            "key": "column_size",
            "label": "Баганын хэмжээ",
            "kind": "text"
          },
          {
            "key": "slab_system",
            "label": "Хучилтын систем",
            "kind": "select",
            "options": [
              {
                "value": "flat",
                "label": "Тэгш хавтан (flat slab)"
              },
              {
                "value": "beam_slab",
                "label": "Дам нуруутай хавтан"
              },
              {
                "value": "metal_deck",
                "label": "Металл тавцантай ТБ"
              }
            ]
          },
          {
            "key": "slab_thickness",
            "label": "Хучилтын зузаан",
            "kind": "number"
          }
        ]
      },
      {
        "id": "materials",
        "title": "Бетон, арматур",
        "fields": [
          {
            "key": "concrete_grade_main",
            "label": "Үндсэн бетоны марк",
            "kind": "text"
          },
          {
            "key": "concrete_grade_secondary",
            "label": "Хоёрдогч бетоны марк",
            "kind": "text"
          },
          {
            "key": "rebar_grade_main",
            "label": "Үндсэн арматурын марк",
            "kind": "text"
          },
          {
            "key": "rebar_secondary",
            "label": "Хоёрдогч арматур",
            "kind": "text"
          },
          {
            "key": "rebar_grade_aux",
            "label": "Туслах арматур",
            "kind": "text"
          }
        ]
      },
      {
        "id": "seismic",
        "title": "Газар хөдлөлтийн тооцоо",
        "fields": [
          {
            "key": "seismic_k0",
            "label": "K0",
            "kind": "text"
          },
          {
            "key": "seismic_k1",
            "label": "K1",
            "kind": "text"
          },
          {
            "key": "seismic_k_psi",
            "label": "Kψ",
            "kind": "text"
          },
          {
            "key": "seismic_calc_method",
            "label": "Тооцооны арга",
            "kind": "select",
            "options": [
              {
                "value": "response_spectrum",
                "label": "Хариу спектр (response spectrum)"
              },
              {
                "value": "time_history",
                "label": "Цаг хугацааны (time history)"
              },
              {
                "value": "pushover",
                "label": "Пушовер (pushover)"
              }
            ]
          },
          {
            "key": "seismic_joint_count",
            "label": "Газар хөдлөлтийн заадасны тоо",
            "kind": "number"
          },
          {
            "key": "seismic_joint_locations",
            "label": "Заадасны байрлал",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "loads",
        "title": "Салхины ачаалал ба онцгой ачаалал",
        "fields": [
          {
            "key": "wind_5yr_pressure",
            "label": "5 жилд нэг удаа тохиох салхины даралт",
            "kind": "text"
          },
          {
            "key": "wind_resonance_check",
            "label": "Салхины резонансыг шалгасан",
            "kind": "checkbox"
          },
          {
            "key": "vehicle_load_3t",
            "label": "Авто ачаалал 3 тонн",
            "kind": "checkbox"
          },
          {
            "key": "vehicle_load_5t",
            "label": "Хүргэлтийн машины ачаалал 5 тонн",
            "kind": "checkbox"
          },
          {
            "key": "vehicle_load_26t",
            "label": "Гал унтраах машины ачаалал 26 тонн",
            "kind": "checkbox"
          },
          {
            "key": "helipad_static_load",
            "label": "Нисдэг тэрэгний статик ачаалал",
            "kind": "text"
          },
          {
            "key": "helipad_dynamic_load",
            "label": "Нисдэг тэрэгний динамик ачаалал",
            "kind": "text"
          },
          {
            "key": "aerodynamic_method",
            "label": "Аэродинамик илтгэлцүүрийн тодорхойлох арга",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "calc",
        "title": "Тооцоо төлөвлөлт",
        "fields": [
          {
            "key": "limit_state_first_group",
            "label": "1-р бүлэг хязгаарын төлвөөр тооцсон",
            "kind": "checkbox"
          },
          {
            "key": "limit_state_second_group",
            "label": "2-р бүлэг хязгаарын төлвөөр шалгасан",
            "kind": "checkbox"
          },
          {
            "key": "progressive_collapse_calc",
            "label": "Өргөжин нурах эвдрэлийг тооцсон",
            "kind": "checkbox"
          },
          {
            "key": "permanent_monitoring",
            "label": "Даацын бүтээцийн байнгын хяналт шинжилгээ",
            "kind": "checkbox"
          }
        ]
      },
      {
        "id": "drawing-list",
        "title": "Барилгын бүтээцийн зургийн жагсаалт",
        "fields": [
          {
            "key": "dl_cover",
            "label": "1.  Нүүр хуудас",
            "kind": "checkbox"
          },
          {
            "key": "dl_drawing_list",
            "label": "2.  Зургийн жагсаалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_explanatory_note",
            "label": "3.  Тайлбар бичиг",
            "kind": "checkbox"
          },
          {
            "key": "dl_foundation_plan",
            "label": "4.  Суурийн байгуулалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_column_plan",
            "label": "5.  Багана / даацын ханын байгуулалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_slab_plan",
            "label": "6.  Хучилтын байгуулалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_beam_layout",
            "label": "7.  Дам нурууны байгуулалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_rebar_details",
            "label": "8.  Арматурын зураг",
            "kind": "checkbox"
          },
          {
            "key": "dl_sections",
            "label": "9.  Огтлолууд",
            "kind": "checkbox"
          },
          {
            "key": "dl_details",
            "label": "10. Деталь, зангилаа",
            "kind": "checkbox"
          }
        ]
      }
    ]
  },
  "HAS": {
    "team_code": "HAS",
    "sections": [
      {
        "id": "heat-source",
        "title": "Дулаан хангамжийн эх үүсвэр",
        "fields": [
          {
            "key": "heat_source_kind",
            "label": "Эх үүсвэрийн төрөл",
            "kind": "select",
            "options": [
              {
                "value": "district",
                "label": "ДЦС / Хотын дулаан хангамж"
              },
              {
                "value": "central_own",
                "label": "Барилгын төвлөрсөн"
              },
              {
                "value": "boiler",
                "label": "Уурын зуух"
              },
              {
                "value": "heat_pump",
                "label": "Дулааны насос"
              },
              {
                "value": "electric",
                "label": "Цахилгаан"
              }
            ]
          },
          {
            "key": "heat_supply_temp",
            "label": "Дамжуулагчын температур (нийлүүлэлт)",
            "kind": "text"
          },
          {
            "key": "heat_return_temp",
            "label": "Дамжуулагчын температур (буцаалт)",
            "kind": "text"
          },
          {
            "key": "heat_design_outdoor_temp",
            "label": "Тооцооны гадна агаарын т°",
            "kind": "text"
          },
          {
            "key": "heat_load_total",
            "label": "Нийт халаалтын ачаалал",
            "kind": "text"
          },
          {
            "key": "heat_pipe_routing",
            "label": "Дамжуулах хоолойн систем",
            "kind": "select",
            "options": [
              {
                "value": "bottom_dead_end",
                "label": "Доороос тарааж, мухар үзүүртэй"
              },
              {
                "value": "bottom_ring",
                "label": "Доороос тарааж, дугуй холбоост"
              },
              {
                "value": "top_distribution",
                "label": "Дээрээс тараасан"
              }
            ]
          }
        ]
      },
      {
        "id": "heat-system",
        "title": "Халаалтын систем",
        "fields": [
          {
            "key": "heat_zoning_text",
            "label": "Халаалтын бүсчлэл",
            "kind": "textarea"
          },
          {
            "key": "heat_devices_panel",
            "label": "Панел радиатор",
            "kind": "checkbox"
          },
          {
            "key": "heat_devices_cast",
            "label": "Цутгамал радиатор",
            "kind": "checkbox"
          },
          {
            "key": "heat_devices_convector",
            "label": "Конвектор",
            "kind": "checkbox"
          },
          {
            "key": "heat_devices_fan_coil",
            "label": "Fan coil",
            "kind": "checkbox"
          },
          {
            "key": "heat_devices_floor",
            "label": "Шалны халаалт",
            "kind": "checkbox"
          },
          {
            "key": "heat_devices_other",
            "label": "Бусад төхөөрөмж",
            "kind": "text"
          },
          {
            "key": "heat_system_pressure",
            "label": "Системийн ажлын даралт",
            "kind": "text"
          },
          {
            "key": "heat_individual_metering",
            "label": "Айл бүрд дулааны тоолуур",
            "kind": "checkbox"
          }
        ]
      },
      {
        "id": "ventilation",
        "title": "Агаар сэлгэлт",
        "fields": [
          {
            "key": "vent_supply_mech",
            "label": "Механик нийлүүлэлт",
            "kind": "checkbox"
          },
          {
            "key": "vent_exhaust_mech",
            "label": "Механик сорогт",
            "kind": "checkbox"
          },
          {
            "key": "vent_natural_exhaust",
            "label": "Байгалийн сорогт (орон сууцны хэсэг)",
            "kind": "checkbox"
          },
          {
            "key": "vent_heat_recovery",
            "label": "Дулаан буцаах систем (heat recovery)",
            "kind": "checkbox"
          },
          {
            "key": "vent_wc_full_mechanical",
            "label": "Ариун цэврийн өрөөнд 100% механик сорогт",
            "kind": "checkbox"
          },
          {
            "key": "vent_service_supply",
            "label": "Үйлчилгээний хэсэг механик нийлүүлэлт",
            "kind": "checkbox"
          },
          {
            "key": "vent_parking_pressurized",
            "label": "Зогсоол даралттай агаартай",
            "kind": "checkbox"
          },
          {
            "key": "vent_ring_ducts",
            "label": "Агаар сэлгэлтийн салбар хоолой дугуй хийцтэй",
            "kind": "checkbox"
          },
          {
            "key": "vent_narrative",
            "label": "Нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "ac",
        "title": "Хөргөлтийн систем (кондиционер)",
        "fields": [
          {
            "key": "ac_system_kind",
            "label": "Системийн төрөл",
            "kind": "select",
            "options": [
              {
                "value": "vrv",
                "label": "VRV (хувьсах хөргөлт)"
              },
              {
                "value": "split",
                "label": "Сплит систем"
              },
              {
                "value": "chilled_water",
                "label": "Хүйтэн усны систем"
              },
              {
                "value": "mixed",
                "label": "Холимог"
              },
              {
                "value": "none",
                "label": "Төлөвлөгөөгүй"
              }
            ]
          },
          {
            "key": "ac_indoor_kinds",
            "label": "Дотор хэсгийн төрлүүд",
            "kind": "text"
          },
          {
            "key": "ac_outdoor_placement",
            "label": "Гадна тоног төхөөрөмжийн байрлал",
            "kind": "text"
          },
          {
            "key": "ac_independent_per_floor",
            "label": "Үйлчилгээний хэсэгт давхар тус бүр бие даасан VRV систем",
            "kind": "checkbox"
          },
          {
            "key": "ac_service_dedicated_tech_room",
            "label": "Үйлчилгээний хэсгийн АС-д техникийн өрөө төлөвлөсөн",
            "kind": "checkbox"
          },
          {
            "key": "ac_narrative",
            "label": "Нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "drawing-list",
        "title": "ХАС-ын зургийн жагсаалт",
        "fields": [
          {
            "key": "dl_cover",
            "label": "1.  Нүүр хуудас",
            "kind": "checkbox"
          },
          {
            "key": "dl_drawing_list",
            "label": "2.  Зургийн жагсаалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_explanatory_note",
            "label": "3.  Тайлбар бичиг",
            "kind": "checkbox"
          },
          {
            "key": "dl_heating_plan",
            "label": "4.  Халаалтын төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_vent_plan",
            "label": "5.  Агаар сэлгэлтийн төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_ac_plan",
            "label": "6.  Хөргөлтийн (АС/VRV) төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_smoke_plan",
            "label": "7.  Утаа зайлуулах төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_riser_diagram",
            "label": "8.  Шугам холболтын схем",
            "kind": "checkbox"
          },
          {
            "key": "dl_equipment_schedule",
            "label": "9.  Тоног төхөөрөмжийн жагсаалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_sections",
            "label": "10. Огтлолууд",
            "kind": "checkbox"
          },
          {
            "key": "dl_details",
            "label": "11. Деталь, зангилаа",
            "kind": "checkbox"
          }
        ]
      }
    ]
  },
  "TSBU": {
    "team_code": "TSBU",
    "sections": [
      {
        "id": "water-source",
        "title": "Усан хангамжийн эх үүсвэр",
        "fields": [
          {
            "key": "water_source_kind",
            "label": "Эх үүсвэрийн төрөл",
            "kind": "select",
            "options": [
              {
                "value": "city",
                "label": "Хотын төвлөрсөн усан хангамж"
              },
              {
                "value": "borehole",
                "label": "Өөрийн худаг"
              },
              {
                "value": "mixed",
                "label": "Холимог"
              }
            ]
          },
          {
            "key": "water_inlet_count",
            "label": "Усны оролтын тоо",
            "kind": "number"
          },
          {
            "key": "water_inlet_pressure",
            "label": "Оролтын даралт",
            "kind": "text"
          },
          {
            "key": "water_source_text",
            "label": "Дэлгэрэнгүй тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "water-demand",
        "title": "Хэрэглээний цэвэр, халуун ус",
        "fields": [
          {
            "key": "water_demand_total",
            "label": "Нийт хоногийн усны хэрэглээ",
            "kind": "text"
          },
          {
            "key": "water_demand_per_person",
            "label": "Хүнд ноогдох хэрэглээ",
            "kind": "text"
          },
          {
            "key": "water_pressure_required",
            "label": "Шаардлагатай ажлын даралт",
            "kind": "text"
          },
          {
            "key": "water_pressure_zoning",
            "label": "Даралтыг давхар бүсчилсэн",
            "kind": "checkbox"
          },
          {
            "key": "hot_water_source",
            "label": "Халуун усны эх үүсвэр",
            "kind": "select",
            "options": [
              {
                "value": "central",
                "label": "Төвлөрсөн"
              },
              {
                "value": "boiler",
                "label": "Уурын зуух"
              },
              {
                "value": "heat_exchanger",
                "label": "Дулаан солилцуур (ДЦС-аас)"
              },
              {
                "value": "instant",
                "label": "Шуурхай халаагч"
              },
              {
                "value": "none",
                "label": "Үгүй"
              }
            ]
          },
          {
            "key": "hot_water_supply_temp",
            "label": "Халуун усны нийлүүлэх т°",
            "kind": "text"
          },
          {
            "key": "water_saving_fixtures",
            "label": "Ус хэмнэх төхөөрөмж (sensor, ¼ турбин гм)",
            "kind": "checkbox"
          },
          {
            "key": "water_sound_dampening",
            "label": "Шугам, хоолойд дуу намсгагч, чичиргээ зөөлрүүлэгч",
            "kind": "checkbox"
          },
          {
            "key": "water_narrative",
            "label": "Нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "sewage",
        "title": "Ариутгах татуурга, борооны ус",
        "fields": [
          {
            "key": "sewage_system",
            "label": "Бохирын систем",
            "kind": "select",
            "options": [
              {
                "value": "gravity",
                "label": "Хүндийн хүчээр (gravity)"
              },
              {
                "value": "pumped",
                "label": "Шахуургалттай"
              },
              {
                "value": "mixed",
                "label": "Холимог"
              }
            ]
          },
          {
            "key": "sewage_separated",
            "label": "Ахуйн, үйлдвэрлэлийн бохирыг салгасан",
            "kind": "checkbox"
          },
          {
            "key": "sewage_treatment_local",
            "label": "Дотоод цэвэршүүлэх төхөөрөмжтэй",
            "kind": "checkbox"
          },
          {
            "key": "sewage_pumping_required",
            "label": "Шахуурга шаардлагатай (зоорийн давхар)",
            "kind": "checkbox"
          },
          {
            "key": "storm_roof_drains",
            "label": "Дээврийн дотуур ус зайлуулах",
            "kind": "checkbox"
          },
          {
            "key": "storm_parking_drains",
            "label": "Зогсоолын шалын ус зайлуулах",
            "kind": "checkbox"
          },
          {
            "key": "storm_surface_drainage",
            "label": "Гадаргын усны зайлуулалт",
            "kind": "checkbox"
          },
          {
            "key": "sewage_narrative",
            "label": "Нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "risers",
        "title": "Босоо шугам",
        "fields": [
          {
            "key": "riser_shaft_count",
            "label": "Босоо шугамын тоо",
            "kind": "number"
          },
          {
            "key": "riser_shaft_locations",
            "label": "Босоо шугамын байрлал",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "drawing-list",
        "title": "ЦБУ-ийн зургийн жагсаалт",
        "fields": [
          {
            "key": "dl_cover",
            "label": "1.  Нүүр хуудас",
            "kind": "checkbox"
          },
          {
            "key": "dl_drawing_list",
            "label": "2.  Зургийн жагсаалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_explanatory_note",
            "label": "3.  Тайлбар бичиг",
            "kind": "checkbox"
          },
          {
            "key": "dl_cold_water_plan",
            "label": "4.  Цэвэр усны төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_hot_water_plan",
            "label": "5.  Халуун усны төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_sewage_plan",
            "label": "6.  Бохирын төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_storm_plan",
            "label": "7.  Борооны ус зайлуулах төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_sprinkler_plan",
            "label": "8.  Спринклер, галын төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_riser_diagram",
            "label": "9.  Босоо шугамын схем",
            "kind": "checkbox"
          },
          {
            "key": "dl_techroom",
            "label": "10. Техникийн өрөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_equipment_schedule",
            "label": "11. Тоног төхөөрөмжийн жагсаалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_sections",
            "label": "12. Огтлолууд",
            "kind": "checkbox"
          },
          {
            "key": "dl_details",
            "label": "13. Деталь, зангилаа",
            "kind": "checkbox"
          }
        ]
      }
    ]
  },
  "TSAH": {
    "team_code": "TSAH",
    "sections": [
      {
        "id": "source",
        "title": "Цахилгаан хангамжийн эх үүсвэр",
        "fields": [
          {
            "key": "source_substation",
            "label": "Дэд өртөө / Эх үүсвэр",
            "kind": "text"
          },
          {
            "key": "source_voltage_primary",
            "label": "Үндсэн хүчдэл",
            "kind": "text"
          },
          {
            "key": "source_voltage_secondary",
            "label": "Хоёрдогч хүчдэл",
            "kind": "text"
          },
          {
            "key": "source_feed_count",
            "label": "Гадна тэжээлийн шугамын тоо",
            "kind": "number"
          },
          {
            "key": "source_load_total",
            "label": "Нийт ачаалал (суурилагдсан)",
            "kind": "text"
          },
          {
            "key": "source_load_calculated",
            "label": "Тооцооны ачаалал",
            "kind": "text"
          },
          {
            "key": "source_power_factor",
            "label": "Чадлын коэффициент cosφ",
            "kind": "text"
          },
          {
            "key": "source_narrative",
            "label": "Дэлгэрэнгүй тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "reliability",
        "title": "Цахилгаан хэрэглэгчийн найдварлагын анги",
        "fields": [
          {
            "key": "reliability_class_1_present",
            "label": "I анги (онцгой) хэрэглэгчтэй",
            "kind": "checkbox"
          },
          {
            "key": "reliability_class_1_items",
            "label": "I ангийн хэрэглэгчид",
            "kind": "textarea"
          },
          {
            "key": "reliability_class_2_present",
            "label": "II анги (хэвийн) хэрэглэгчтэй",
            "kind": "checkbox"
          },
          {
            "key": "reliability_class_2_items",
            "label": "II ангийн хэрэглэгчид",
            "kind": "textarea"
          },
          {
            "key": "reliability_class_3_present",
            "label": "III анги (бууруулсан) хэрэглэгчтэй",
            "kind": "checkbox"
          }
        ]
      },
      {
        "id": "distribution",
        "title": "Цахилгаан хуваарилалт, тоолуур",
        "fields": [
          {
            "key": "distrib_main_panel_location",
            "label": "Гол хуваарилах самбарын байрлал",
            "kind": "text"
          },
          {
            "key": "distrib_separate_residential",
            "label": "Орон сууцанд тусдаа ОХС",
            "kind": "checkbox"
          },
          {
            "key": "distrib_separate_service",
            "label": "Үйлчилгээний хэсэгт тусдаа ОХС",
            "kind": "checkbox"
          },
          {
            "key": "distrib_separate_parking",
            "label": "Зогсоолд тусдаа ОХС",
            "kind": "checkbox"
          },
          {
            "key": "distrib_metering_per_zone",
            "label": "Бүсчилсэн тоолуур",
            "kind": "checkbox"
          },
          {
            "key": "distrib_metering_per_apt",
            "label": "Айл бүрд тоолуур",
            "kind": "checkbox"
          },
          {
            "key": "distrib_high_rise_riser",
            "label": "Өндөр давхарт тусдаа босоо шугам",
            "kind": "checkbox"
          }
        ]
      },
      {
        "id": "lighting",
        "title": "Гэрэлтүүлэг",
        "fields": [
          {
            "key": "lighting_interior_led",
            "label": "Дотор LED гэрэлтүүлэг",
            "kind": "checkbox"
          },
          {
            "key": "lighting_emergency_3h",
            "label": "3 цагийн нөөцтэй авагдаах гэрэлтүүлэг",
            "kind": "checkbox"
          },
          {
            "key": "lighting_exterior",
            "label": "Гадна гэрэлтүүлэг",
            "kind": "checkbox"
          },
          {
            "key": "lighting_facade",
            "label": "Фасадны архитектур гэрэлтүүлэг",
            "kind": "checkbox"
          },
          {
            "key": "lighting_motion_sensor",
            "label": "Зогсоол, хонгилд хөдөлгөөн мэдрэгч",
            "kind": "checkbox"
          },
          {
            "key": "lighting_dali_control",
            "label": "DALI хяналтын систем",
            "kind": "checkbox"
          },
          {
            "key": "lighting_lux_levels_text",
            "label": "Норм бүхий гэрэлтүүлгийн утгууд",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "grounding",
        "title": "Газардуулга, аянганаас хамгаалах",
        "fields": [
          {
            "key": "grounding_tn_s_system",
            "label": "TN-S систем",
            "kind": "checkbox"
          },
          {
            "key": "grounding_main_loop",
            "label": "Үндсэн газардуулгын контур",
            "kind": "checkbox"
          },
          {
            "key": "lightning_terminal_present",
            "label": "Аянганы шонт төлөвлөв",
            "kind": "checkbox"
          },
          {
            "key": "lightning_class",
            "label": "Аянгаас хамгаалах анги (IEC 62305)",
            "kind": "select",
            "options": [
              {
                "value": "I",
                "label": "I (онцгой эрсдэлтэй)"
              },
              {
                "value": "II",
                "label": "II (өндөр эрсдэл)"
              },
              {
                "value": "III",
                "label": "III (хэвийн)"
              },
              {
                "value": "IV",
                "label": "IV (бууруулсан)"
              }
            ]
          },
          {
            "key": "grounding_narrative",
            "label": "Нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "ev",
        "title": "Цахилгаан машины цэнэглэгч, тусгай ачаалал",
        "fields": [
          {
            "key": "ev_chargers_count",
            "label": "EV цэнэглэгчийн тоо",
            "kind": "number"
          },
          {
            "key": "ev_chargers_kw",
            "label": "Цэнэглэгч тус бүрийн чадал",
            "kind": "text"
          },
          {
            "key": "ev_chargers_location",
            "label": "Цэнэглэгчийн байрлал",
            "kind": "text"
          },
          {
            "key": "smart_metering_present",
            "label": "Ухаалаг тоолуур",
            "kind": "checkbox"
          },
          {
            "key": "special_narrative",
            "label": "Нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "drawing-list",
        "title": "Цахилгааны зургийн жагсаалт",
        "fields": [
          {
            "key": "dl_cover",
            "label": "1.  Нүүр хуудас",
            "kind": "checkbox"
          },
          {
            "key": "dl_drawing_list",
            "label": "2.  Зургийн жагсаалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_explanatory_note",
            "label": "3.  Тайлбар бичиг",
            "kind": "checkbox"
          },
          {
            "key": "dl_single_line",
            "label": "4.  Нэг шугамын схем",
            "kind": "checkbox"
          },
          {
            "key": "dl_power_plan",
            "label": "5.  Цахилгаан хангамжийн төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_lighting_plan",
            "label": "6.  Гэрэлтүүлгийн төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_outlet_plan",
            "label": "7.  Розеткын төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_emergency_lighting",
            "label": "8.  Авагдаах гэрэлтүүлгийн төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_grounding_plan",
            "label": "9.  Газардуулгын төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_lightning_plan",
            "label": "10. Аянгаас хамгаалах",
            "kind": "checkbox"
          },
          {
            "key": "dl_ev_charging",
            "label": "11. EV цэнэглэгчийн төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_equipment_schedule",
            "label": "12. Тоног төхөөрөмжийн жагсаалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_cable_schedule",
            "label": "13. Кабелийн жагсаалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_details",
            "label": "14. Деталь, зангилаа",
            "kind": "checkbox"
          }
        ]
      }
    ]
  },
  "HD": {
    "team_code": "HD",
    "sections": [
      {
        "id": "fiber",
        "title": "Шилэн кабель",
        "fields": [
          {
            "key": "fiber_inlet_cores",
            "label": "Шилэн кабелийн судлын тоо",
            "kind": "text"
          },
          {
            "key": "fiber_inlet_route",
            "label": "Кабелийн оролтын замнал",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "phone-comp",
        "title": "Утас, компьютерын сүлжээ",
        "fields": [
          {
            "key": "phone_per_office",
            "label": "Оффис бүрд телефоны розетка",
            "kind": "checkbox"
          },
          {
            "key": "phone_separate_service_res",
            "label": "Үйлчилгээ, орон сууц тусдаа систем",
            "kind": "checkbox"
          },
          {
            "key": "computer_multi_isp",
            "label": "Олон ISP сонголтоор үйлчилнэ",
            "kind": "checkbox"
          },
          {
            "key": "computer_per_office",
            "label": "Оффис бүрд компьютерын розетка",
            "kind": "checkbox"
          },
          {
            "key": "computer_separate_service_res",
            "label": "Үйлчилгээ, орон сууц тусдаа систем",
            "kind": "checkbox"
          },
          {
            "key": "network_speed",
            "label": "Сүлжээний хурд (свитч)",
            "kind": "text"
          },
          {
            "key": "cable_category",
            "label": "Кабелийн төрөл",
            "kind": "text"
          }
        ]
      },
      {
        "id": "mobile-tv",
        "title": "Гар утасны сүлжээ өргөгч, кабелийн ТВ",
        "fields": [
          {
            "key": "mobile_booster_basement",
            "label": "B1/B2 зоорийн давхарт гар утасны сүлжээ өргөгч",
            "kind": "checkbox"
          },
          {
            "key": "mobile_booster_high_floors",
            "label": "15-р давхраас дээш гар утасны сүлжээ өргөгч",
            "kind": "checkbox"
          },
          {
            "key": "cable_tv_present",
            "label": "Кабелийн ТВ систем",
            "kind": "checkbox"
          },
          {
            "key": "cable_tv_topology",
            "label": "Кабелийн ТВ-ийн топологи",
            "kind": "select",
            "options": [
              {
                "value": "star",
                "label": "Од хэлбэрийн (star)"
              },
              {
                "value": "tree",
                "label": "Мод хэлбэрийн (tree)"
              },
              {
                "value": "mixed",
                "label": "Холимог"
              }
            ]
          }
        ]
      },
      {
        "id": "access",
        "title": "Нэвтрэх хяналтын систем",
        "fields": [
          {
            "key": "access_main_entry",
            "label": "Гол орц гарц",
            "kind": "checkbox"
          },
          {
            "key": "access_server_room",
            "label": "Серверийн өрөө",
            "kind": "checkbox"
          },
          {
            "key": "access_comms_rooms",
            "label": "Холбооны өрөөнүүд",
            "kind": "checkbox"
          },
          {
            "key": "access_auto_unlock_on_fire",
            "label": "Гал гарсан үед автомат нээгдэх",
            "kind": "checkbox"
          },
          {
            "key": "access_kind",
            "label": "Хяналтын төрөл",
            "kind": "select",
            "options": [
              {
                "value": "card",
                "label": "Карт"
              },
              {
                "value": "biometric",
                "label": "Биометр"
              },
              {
                "value": "pin",
                "label": "PIN код"
              },
              {
                "value": "mixed",
                "label": "Холимог"
              }
            ]
          },
          {
            "key": "access_narrative",
            "label": "Нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "cctv",
        "title": "Хяналтын камерын систем",
        "fields": [
          {
            "key": "cctv_camera_count",
            "label": "Камерын тоо",
            "kind": "number"
          },
          {
            "key": "cctv_camera_min_resolution",
            "label": "Камерын дүрсний нягтрал (доод хязгаар)",
            "kind": "text"
          },
          {
            "key": "cctv_nvr_retention_days",
            "label": "NVR-ийн бичлэг хадгалах хугацаа",
            "kind": "text"
          },
          {
            "key": "cctv_outdoor_cameras",
            "label": "Гадна суурилуулсан камерууд (өдөр шөнийн ажиллагаатай)",
            "kind": "checkbox"
          },
          {
            "key": "cctv_lift_cabs",
            "label": "Цахилгаан шатны кабинд камертай",
            "kind": "checkbox"
          },
          {
            "key": "cctv_parking",
            "label": "Зогсоолд камертай",
            "kind": "checkbox"
          },
          {
            "key": "cctv_poe_powered",
            "label": "PoE-ээр тэжээлтэй камерууд",
            "kind": "checkbox"
          },
          {
            "key": "cctv_max_cable_run",
            "label": "Камерын кабелийн дээд урт",
            "kind": "text"
          },
          {
            "key": "cctv_monitor_size",
            "label": "Хяналтын дэлгэцийн хэмжээ",
            "kind": "text"
          },
          {
            "key": "cctv_monitor_floor",
            "label": "Хяналтын өрөөний давхар",
            "kind": "text"
          },
          {
            "key": "cctv_coverage_text",
            "label": "Хяналт хийгдэх талбайнууд",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "pa",
        "title": "Зарлан мэдээлэл",
        "fields": [
          {
            "key": "pa_present",
            "label": "Зарлан мэдээллийн систем",
            "kind": "checkbox"
          },
          {
            "key": "pa_background_music",
            "label": "Дэвсгэр хөгжимтэй",
            "kind": "checkbox"
          },
          {
            "key": "pa_emergency_override",
            "label": "Гал гарсан үед автомат зарлан мэдээлэх",
            "kind": "checkbox"
          },
          {
            "key": "pa_zoned",
            "label": "Бүсчилсэн чанга яригч",
            "kind": "checkbox"
          }
        ]
      },
      {
        "id": "drawing-list",
        "title": "ХД-ийн зургийн жагсаалт",
        "fields": [
          {
            "key": "dl_cover",
            "label": "1.  Нүүр хуудас",
            "kind": "checkbox"
          },
          {
            "key": "dl_drawing_list",
            "label": "2.  Зургийн жагсаалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_explanatory_note",
            "label": "3.  Тайлбар бичиг",
            "kind": "checkbox"
          },
          {
            "key": "dl_phone_plan",
            "label": "4.  Утасны сүлжээний төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_computer_plan",
            "label": "5.  Компьютерын сүлжээний төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_cctv_plan",
            "label": "6.  CCTV-ийн төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_access_plan",
            "label": "7.  Нэвтрэх хяналтын төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_fa_plan",
            "label": "8.  Гал дохиоллын төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_pa_plan",
            "label": "9.  Зарлан мэдээллийн төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_cable_tv_plan",
            "label": "10. Кабелийн ТВ-ийн төлөвлөгөө",
            "kind": "checkbox"
          },
          {
            "key": "dl_server_room",
            "label": "11. Серверийн өрөөний зураг",
            "kind": "checkbox"
          },
          {
            "key": "dl_riser_diagram",
            "label": "12. Босоо шугамын схем",
            "kind": "checkbox"
          },
          {
            "key": "dl_equipment_schedule",
            "label": "13. Тоног төхөөрөмжийн жагсаалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_details",
            "label": "14. Деталь, зангилаа",
            "kind": "checkbox"
          }
        ]
      }
    ]
  },
  "AU": {
    "team_code": "AU",
    "sections": [
      {
        "id": "inputs",
        "title": "Бусад багуудаас зураг төсөл зохиогчийн даалгавар",
        "fields": [
          {
            "key": "input_from_has",
            "label": "HAS багаас даалгавар хүлээн авсан",
            "kind": "checkbox"
          },
          {
            "key": "input_from_cbu",
            "label": "ЦБУ багаас даалгавар хүлээн авсан",
            "kind": "checkbox"
          },
          {
            "key": "input_from_tsah",
            "label": "ЦАХ багаас даалгавар хүлээн авсан",
            "kind": "checkbox"
          },
          {
            "key": "input_from_hd",
            "label": "ХД багаас даалгавар хүлээн авсан",
            "kind": "checkbox"
          },
          {
            "key": "input_from_client",
            "label": "Захиалагчаас тусгай даалгавар",
            "kind": "checkbox"
          },
          {
            "key": "input_pending_text",
            "label": "Хүлээгдэж буй даалгавар, шийдэл",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "bms",
        "title": "Барилгын удирдлагын систем (BMS)",
        "fields": [
          {
            "key": "bms_present",
            "label": "BMS систем төлөвлөв",
            "kind": "checkbox"
          },
          {
            "key": "bms_protocol",
            "label": "Удирдлагын протокол",
            "kind": "select",
            "options": [
              {
                "value": "bacnet",
                "label": "BACnet"
              },
              {
                "value": "modbus",
                "label": "Modbus"
              },
              {
                "value": "knx",
                "label": "KNX"
              },
              {
                "value": "mixed",
                "label": "Холимог"
              }
            ]
          },
          {
            "key": "bms_monitors_hvac",
            "label": "ХАС-ыг хянадаг",
            "kind": "checkbox"
          },
          {
            "key": "bms_monitors_lighting",
            "label": "Гэрэлтүүлгийг хянадаг",
            "kind": "checkbox"
          },
          {
            "key": "bms_monitors_water",
            "label": "Усан хангамж, насосыг хянадаг",
            "kind": "checkbox"
          },
          {
            "key": "bms_monitors_power",
            "label": "Цахилгаан хангамжийг хянадаг",
            "kind": "checkbox"
          },
          {
            "key": "bms_monitors_smoke",
            "label": "Утаа сорогт системийг хянадаг",
            "kind": "checkbox"
          },
          {
            "key": "bms_monitors_access",
            "label": "Нэвтрэх хяналтыг хянадаг",
            "kind": "checkbox"
          },
          {
            "key": "bms_scheduling",
            "label": "Цаг хуваарийн систем (scheduling)",
            "kind": "checkbox"
          },
          {
            "key": "bms_alarms",
            "label": "Алармын систем (имэйл / SMS мэдээ)",
            "kind": "checkbox"
          },
          {
            "key": "bms_narrative",
            "label": "BMS-ийн нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "home-auto",
        "title": "Home автоматжуулалт (айл бүрд)",
        "fields": [
          {
            "key": "home_auto_present",
            "label": "Айл бүрд home автомат систем",
            "kind": "checkbox"
          },
          {
            "key": "home_auto_lighting",
            "label": "Гэрэлтүүлгийн удирдлага",
            "kind": "checkbox"
          },
          {
            "key": "home_auto_climate",
            "label": "Халаалт, хөргөлтийн удирдлага",
            "kind": "checkbox"
          },
          {
            "key": "home_auto_security",
            "label": "Аюулгүй байдлын удирдлага",
            "kind": "checkbox"
          },
          {
            "key": "home_auto_window_blinds",
            "label": "Цонхны хөшиг (хатгуурт)",
            "kind": "checkbox"
          },
          {
            "key": "home_auto_app_control",
            "label": "Утасны аппликейшнаар удирдах",
            "kind": "checkbox"
          },
          {
            "key": "home_auto_voice_control",
            "label": "Дуун удирдлага (Alexa / Google)",
            "kind": "checkbox"
          },
          {
            "key": "home_auto_narrative",
            "label": "Нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "integration",
        "title": "Системүүдийн уялдаа холбоо",
        "fields": [
          {
            "key": "integ_security_cctv",
            "label": "Нэвтрэх ⇒ CCTV-д үйл явдал бичигдэх",
            "kind": "checkbox"
          },
          {
            "key": "integ_lighting_motion",
            "label": "Хөдөлгөөн мэдрэгч ⇒ гэрэлтүүлэг асах",
            "kind": "checkbox"
          },
          {
            "key": "integ_narrative",
            "label": "Нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "drawing-list",
        "title": "АУ-ийн зургийн жагсаалт",
        "fields": [
          {
            "key": "dl_cover",
            "label": "1.  Нүүр хуудас",
            "kind": "checkbox"
          },
          {
            "key": "dl_drawing_list",
            "label": "2.  Зургийн жагсаалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_explanatory_note",
            "label": "3.  Тайлбар бичиг",
            "kind": "checkbox"
          },
          {
            "key": "dl_bms_architecture",
            "label": "4.  BMS системийн архитектур",
            "kind": "checkbox"
          },
          {
            "key": "dl_bms_io_list",
            "label": "5.  Мэдрэгч, удирдлагын I/O жагсаалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_home_auto",
            "label": "6.  Home автоматжуулалтын зураг",
            "kind": "checkbox"
          },
          {
            "key": "dl_integration_diagram",
            "label": "7.  Системүүдийн уялдааны схем",
            "kind": "checkbox"
          },
          {
            "key": "dl_monitoring_room",
            "label": "8.  Хяналтын өрөөний зураг",
            "kind": "checkbox"
          },
          {
            "key": "dl_equipment_schedule",
            "label": "9.  Тоног төхөөрөмжийн жагсаалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_details",
            "label": "10. Деталь, зангилаа",
            "kind": "checkbox"
          }
        ]
      }
    ]
  },
  "IZ": {
    "team_code": "IZ",
    "sections": [
      {
        "id": "concept",
        "title": "Ерөнхий шийдэл / Концепц",
        "fields": [
          {
            "key": "iz_concept",
            "label": "Концепцийн тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "zones",
        "title": "Бүсчлэлийн шийдэл",
        "fields": [
          {
            "key": "iz_zones",
            "label": "Бүсүүд",
            "kind": "zone-rows",
            "columns": [
              {
                "key": "name",
                "label": "Бүсийн нэр"
              },
              {
                "key": "wall",
                "label": "Хана"
              },
              {
                "key": "floor",
                "label": "Шал"
              },
              {
                "key": "ceiling",
                "label": "Тааз"
              },
              {
                "key": "lighting",
                "label": "Гэрэлтүүлэг"
              },
              {
                "key": "doors",
                "label": "Хаалга, цонх"
              },
              {
                "key": "furniture",
                "label": "Тавилга"
              },
              {
                "key": "fixtures",
                "label": "Тоноглол (АЦӨ)"
              },
              {
                "key": "general",
                "label": "Ерөнхий шийдэл"
              }
            ]
          }
        ]
      },
      {
        "id": "render-index",
        "title": "3D рендерийн индекс",
        "fields": [
          {
            "key": "iz_render_index",
            "label": "Рендерийн индекс",
            "kind": "floor-areas-rows",
            "columns": [
              {
                "key": "floor",
                "label": "Давхар"
              },
              {
                "key": "firstPage",
                "label": "Эхлэх хуудас"
              },
              {
                "key": "areas.name",
                "label": "Хэсгийн нэр"
              },
              {
                "key": "areas.pages",
                "label": "Хуудас"
              }
            ]
          }
        ]
      },
      {
        "id": "drawing-list",
        "title": "Интерьерийн зургийн жагсаалт",
        "fields": [
          {
            "key": "dl_wall_model",
            "label": "1.  Хана модельчлох",
            "kind": "checkbox"
          },
          {
            "key": "dl_floor_model",
            "label": "2.  Шал модельчлох",
            "kind": "checkbox"
          },
          {
            "key": "dl_ceiling_model",
            "label": "3.  Тааз модельчлох",
            "kind": "checkbox"
          },
          {
            "key": "dl_furniture_model",
            "label": "4.  Тавилга модельчлох",
            "kind": "checkbox"
          },
          {
            "key": "dl_demo_wall_layout",
            "label": "5.  Нураах ханын байгуулалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_main_layout",
            "label": "6.  Үндсэн байгуулалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_ceiling_layout",
            "label": "7.  Таазны байгуулалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_floor_layout",
            "label": "8.  Шалны байгуулалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_lighting_layout",
            "label": "9.  Гэрлийн байгуулалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_furniture_layout",
            "label": "10. Тавилгын байгуулалт",
            "kind": "checkbox"
          },
          {
            "key": "dl_sockets_switches",
            "label": "11. Розетка, унтраалга",
            "kind": "checkbox"
          },
          {
            "key": "dl_comms_alarm",
            "label": "12. Холбоо дохиолол",
            "kind": "checkbox"
          },
          {
            "key": "dl_wall_elevations",
            "label": "13. Ханын дэлгээс",
            "kind": "checkbox"
          },
          {
            "key": "dl_furniture_details",
            "label": "14. Тавилгын хэсэгчилсэн зураг",
            "kind": "checkbox"
          },
          {
            "key": "dl_ceiling_wall_sections",
            "label": "15. Тааз, хана хэсэгчлэл",
            "kind": "checkbox"
          },
          {
            "key": "dl_quantities",
            "label": "16. Тоо хэмжээ",
            "kind": "checkbox"
          }
        ]
      }
    ]
  },
  "GENERAL": {
    "team_code": "GENERAL",
    "sections": [
      {
        "id": "justification",
        "title": "Үндэслэл",
        "fields": [
          {
            "key": "justification_kind",
            "label": "Үндэслэлийн төрөл",
            "kind": "select",
            "options": [
              {
                "value": "city",
                "label": "Нийслэлийн / дүүргийн түвшний газар олголт"
              },
              {
                "value": "gov",
                "label": "Улсын / Засгийн газрын түвшний газар олголт"
              },
              {
                "value": "protected",
                "label": "ТХГН-ийн тусгай газар ашиглах эрх"
              }
            ]
          },
          {
            "key": "justification_text",
            "label": "Үндэслэлийн дэлгэрэнгүй",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "location",
        "title": "Байршил",
        "fields": [
          {
            "key": "location_zoning",
            "label": "Байршлын тодорхойлолт",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "classification",
        "title": "Барилгын ангилал",
        "fields": [
          {
            "key": "building_purpose_category",
            "label": "Барилгын үндсэн зориулалт",
            "kind": "select",
            "options": [
              {
                "value": "residential",
                "label": "Орон сууцны"
              },
              {
                "value": "public",
                "label": "Олон нийтийн (иргэний)"
              },
              {
                "value": "service",
                "label": "Үйлчилгээтэй орон сууцны"
              },
              {
                "value": "industrial",
                "label": "Үйлдвэрийн"
              },
              {
                "value": "mixed_use",
                "label": "Холимог зориулалттай"
              }
            ]
          },
          {
            "key": "building_complexity_class",
            "label": "Барилгын төвөгшлийн анги",
            "kind": "select",
            "options": [
              {
                "value": "low",
                "label": "Бага"
              },
              {
                "value": "mid",
                "label": "Дунд"
              },
              {
                "value": "high",
                "label": "Өндөр"
              },
              {
                "value": "special",
                "label": "Онцгой"
              }
            ]
          },
          {
            "key": "fire_safety_class",
            "label": "Гал тэсвэрлэлтийн анги",
            "kind": "select",
            "options": [
              {
                "value": "I",
                "label": "I"
              },
              {
                "value": "II",
                "label": "II"
              },
              {
                "value": "III",
                "label": "III"
              },
              {
                "value": "IV",
                "label": "IV"
              },
              {
                "value": "V",
                "label": "V"
              }
            ]
          },
          {
            "key": "building_lifetime_years",
            "label": "Ашиглалтын хугацаа",
            "kind": "number"
          },
          {
            "key": "seismic_intensity_balls",
            "label": "Газар хөдлөлтийн эрчим",
            "kind": "select",
            "options": [
              {
                "value": "7",
                "label": "7 балл"
              },
              {
                "value": "8",
                "label": "8 балл"
              },
              {
                "value": "9",
                "label": "9 балл"
              }
            ]
          },
          {
            "key": "reliability_class",
            "label": "Найдварлагын анги",
            "kind": "select",
            "options": [
              {
                "value": "I",
                "label": "I (онцгой)"
              },
              {
                "value": "II",
                "label": "II (хэвийн)"
              },
              {
                "value": "III",
                "label": "III (бууруулсан)"
              }
            ]
          },
          {
            "key": "reliability_gamma_f",
            "label": "Найдварлагын итгэлцүүр γf",
            "kind": "text"
          }
        ]
      }
    ]
  },
  "ROOMS": {
    "team_code": "ROOMS",
    "sections": [
      {
        "id": "techroom",
        "title": "Техникийн / насосны өрөө",
        "fields": [
          {
            "key": "techroom_floor",
            "label": "Техникийн өрөөний байрлал (давхар)",
            "kind": "text"
          },
          {
            "key": "techroom_water_reserve_domestic",
            "label": "Ахуйн усны нөөц",
            "kind": "text"
          },
          {
            "key": "techroom_water_reserve_fire",
            "label": "Галын усны нөөц",
            "kind": "text"
          },
          {
            "key": "techroom_pump_sound_dampening",
            "label": "Насосны дуу чимээ тусгаарлалт",
            "kind": "checkbox"
          },
          {
            "key": "techroom_narrative",
            "label": "Нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "server-room",
        "title": "Серверийн / холбооны өрөө",
        "fields": [
          {
            "key": "server_room_floor",
            "label": "Серверийн өрөөний байрлал (давхар)",
            "kind": "text"
          },
          {
            "key": "server_room_area",
            "label": "Серверийн өрөөний талбай",
            "kind": "text"
          },
          {
            "key": "ip_telephony_present",
            "label": "IP телефони сервер",
            "kind": "checkbox"
          },
          {
            "key": "per_floor_signal_cabinet",
            "label": "Давхар бүрийн дохиоллын шүүгээ",
            "kind": "checkbox"
          },
          {
            "key": "server_room_climate_control",
            "label": "Температур/чийгшил хяналт (≈18–24°C, 30–55%)",
            "kind": "checkbox"
          },
          {
            "key": "server_room_positive_pressure",
            "label": "Эерэг даралт / тусгай агааржуулалт",
            "kind": "checkbox"
          },
          {
            "key": "server_room_narrative",
            "label": "Нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "monitoring",
        "title": "Нэгдсэн хяналтын өрөө",
        "fields": [
          {
            "key": "monitoring_room_floor",
            "label": "Хяналтын өрөөний байрлал (давхар)",
            "kind": "text"
          },
          {
            "key": "monitoring_room_area",
            "label": "Хяналтын өрөөний талбай",
            "kind": "text"
          },
          {
            "key": "monitoring_unified_per_block",
            "label": "Блок бүрт нэгдсэн хяналт",
            "kind": "checkbox"
          },
          {
            "key": "monitoring_24_7_staffed",
            "label": "24/7 хүнтэй ажиллана",
            "kind": "checkbox"
          },
          {
            "key": "monitoring_narrative",
            "label": "Нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "backup",
        "title": "Нөөц тэжээл (генератор / UPS)",
        "fields": [
          {
            "key": "backup_generator_present",
            "label": "Дизель генератор",
            "kind": "checkbox"
          },
          {
            "key": "backup_generator_power",
            "label": "Генераторын чадал",
            "kind": "text"
          },
          {
            "key": "backup_generator_autonomy_hours",
            "label": "Генераторын ажиллах хугацаа",
            "kind": "text"
          },
          {
            "key": "backup_generator_fuel_reserve",
            "label": "Дизель түлшний нөөц (цаг / литр)",
            "kind": "text"
          },
          {
            "key": "backup_ups_present",
            "label": "UPS (тасралтгүй тэжээл)",
            "kind": "checkbox"
          },
          {
            "key": "backup_ups_autonomy",
            "label": "UPS ажиллах хугацаа",
            "kind": "text"
          },
          {
            "key": "ups_covers_text",
            "label": "UPS-ээр хамгаалагдах системүүд",
            "kind": "textarea"
          },
          {
            "key": "backup_emergency_fire_rated_cabling",
            "label": "Нөөц/яаралтай тэжээлийн галд тэсвэртэй кабель",
            "kind": "checkbox"
          },
          {
            "key": "backup_narrative",
            "label": "Нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      }
    ]
  },
  "FIRE": {
    "team_code": "FIRE",
    "sections": [
      {
        "id": "fire-class",
        "title": "Галын тусгаарлалт ба бүтээцийн хамгаалалт",
        "fields": [
          {
            "key": "fire_building_separation",
            "label": "Барилга хоорондын галын зай",
            "kind": "text"
          },
          {
            "key": "fire_compartmentation",
            "label": "Галын тусгаарлалт / хэсэгчлэл (галын хана, хаалт)",
            "kind": "checkbox"
          },
          {
            "key": "fire_penetration_sealing",
            "label": "Хэвтээ/босоо нэвчилтийн галын битүүмжлэл",
            "kind": "checkbox"
          },
          {
            "key": "fire_class_narrative",
            "label": "Нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "evacuation",
        "title": "Эвакуац / гал гарах төлөвлөлт",
        "fields": [
          {
            "key": "evac_exit_count_per_floor",
            "label": "Давхар бүрийн гарцын тоо",
            "kind": "number"
          },
          {
            "key": "evac_occupant_load",
            "label": "Тооцоолсон хүний багтаамж (occupant load)",
            "kind": "text"
          },
          {
            "key": "evac_exit_width",
            "label": "Гарцын нийт өргөн / багтаамж",
            "kind": "text"
          },
          {
            "key": "evac_travel_distance",
            "label": "Эвакуацийн зам (м), мухар коридор",
            "kind": "text"
          },
          {
            "key": "evac_secondary_stair_per_apt",
            "label": "Айл/хэсэг бүрт нөөц шат",
            "kind": "checkbox"
          },
          {
            "key": "evac_smoke_free_main_stair",
            "label": "Утаагүй үндсэн шат",
            "kind": "checkbox"
          },
          {
            "key": "evac_pressurized_vestibule",
            "label": "Даралттай гонх (вестибюль)",
            "kind": "checkbox"
          },
          {
            "key": "evac_dedicated_fire_lift",
            "label": "Гал сөнөөгчийн тусгай лифт",
            "kind": "checkbox"
          },
          {
            "key": "evac_narrative",
            "label": "Нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "smoke",
        "title": "Утаа зайлуулах / даралтжуулалт",
        "fields": [
          {
            "key": "smoke_main_stair_pressurized",
            "label": "Үндсэн шат даралтжуулсан",
            "kind": "checkbox"
          },
          {
            "key": "smoke_dedicated_ff_lift_shaft",
            "label": "Гал сөнөөгчийн лифтний тусгай босоо хонгил",
            "kind": "checkbox"
          },
          {
            "key": "smoke_corridor_extract",
            "label": "Коридорын утаа сорох",
            "kind": "checkbox"
          },
          {
            "key": "smoke_lobby_pressurized",
            "label": "Лобби даралтжуулсан",
            "kind": "checkbox"
          },
          {
            "key": "smoke_vestibule_2stage",
            "label": "Хоёр шатлалт гонх",
            "kind": "checkbox"
          },
          {
            "key": "smoke_extract_method",
            "label": "Утаа зайлуулах арга",
            "kind": "select",
            "options": [
              {
                "value": "natural",
                "label": "Байгалийн"
              },
              {
                "value": "mechanical",
                "label": "Механик"
              },
              {
                "value": "hybrid",
                "label": "Холимог"
              }
            ]
          },
          {
            "key": "smoke_narrative",
            "label": "Нэмэлт тайлбар",
            "kind": "textarea"
          }
        ]
      },
      {
        "id": "fire-water",
        "title": "Галын усан хангамж",
        "fields": [
          {
            "key": "fire_sprinkler_auto",
            "label": "Автомат спринклер систем",
            "kind": "checkbox"
          },
          {
            "key": "fire_sprinkler_zones",
            "label": "Спринклерийн бүсчлэл",
            "kind": "textarea"
          },
          {
            "key": "fire_hose_reels",
            "label": "Галын хоолойн ороомог",
            "kind": "checkbox"
          },
          {
            "key": "fire_hydrants_outdoor",
            "label": "Гадна гидрант",
            "kind": "checkbox"
          },
          {
            "key": "fire_hydrants_indoor",
            "label": "Дотор гидрант",
            "kind": "checkbox"
          },
          {
            "key": "fire_reserve_volume",
            "label": "Галын усны нөөцийн эзэлхүүн",
            "kind": "text"
          },
          {
            "key": "fire_reserve_duration",
            "label": "Нөөцийн хүрэлцэх хугацаа",
            "kind": "text"
          },
          {
            "key": "fire_pump_redundancy",
            "label": "2 насос (1 ажлын + 1 нөөц)",
            "kind": "checkbox"
          }
        ]
      },
      {
        "id": "fire-alarm",
        "title": "Гал дохиолол",
        "fields": [
          {
            "key": "fa_facp_location",
            "label": "Галын төв самбар (FACP) байрлал",
            "kind": "text"
          },
          {
            "key": "fa_addressable",
            "label": "Хаягжсан мэдрэгчид",
            "kind": "checkbox"
          },
          {
            "key": "fa_manual_call_points",
            "label": "Давхар бүрт гар дуудлагын товч",
            "kind": "checkbox"
          },
          {
            "key": "fa_fire_rated_cabling",
            "label": "Галд тэсвэртэй кабель",
            "kind": "checkbox"
          },
          {
            "key": "fa_facp_controls_smoke",
            "label": "FACP → утаа сорогч удирдана",
            "kind": "checkbox"
          },
          {
            "key": "fa_facp_controls_doors",
            "label": "FACP → нэвтрэх хаалга удирдана",
            "kind": "checkbox"
          },
          {
            "key": "fa_facp_controls_pa",
            "label": "FACP → зарлан мэдээлэл удирдана",
            "kind": "checkbox"
          }
        ]
      },
      {
        "id": "fire-integration",
        "title": "Галд тэсвэртэй кабель ба системийн интеграц",
        "fields": [
          {
            "key": "fire_rated_cabling_present",
            "label": "Галд тэсвэртэй кабель (БД 43-105-12)",
            "kind": "checkbox"
          },
          {
            "key": "integ_fa_smoke_extract",
            "label": "Гал дохиолол → утаа сорох",
            "kind": "checkbox"
          },
          {
            "key": "integ_fa_pa",
            "label": "Гал дохиолол → зарлан мэдээлэл",
            "kind": "checkbox"
          },
          {
            "key": "integ_fa_access_unlock",
            "label": "Гал дохиолол → хаалга онгойлгох",
            "kind": "checkbox"
          },
          {
            "key": "integ_fa_lift_recall",
            "label": "Гал дохиолол → лифт татах",
            "kind": "checkbox"
          },
          {
            "key": "integ_fa_hvac_shutdown",
            "label": "Гал дохиолол → агаар сэлгэлт зогсоох",
            "kind": "checkbox"
          }
        ]
      }
    ]
  }
};

/** Common drawing-list checkbox keys (dl_*) -> Mongolian label. */
export const DRAWING_LIST_LABELS: Record<string, string> = {
  "BA.dl_cover": "Нүүр хуудас",
  "BA.dl_general_plan": "Ерөнхий төлөвлөгөө, зай хэмжээ, тохижилт, картограмм",
  "BA.dl_drawing_list": "Зургийн жагсаалт",
  "BA.dl_explanatory_note": "Тайлбар бичиг",
  "BA.dl_floor_plans": "Давхрын байгуулалтууд",
  "BA.dl_roof_plan": "Дээврийн байгуулалт",
  "BA.dl_sections": "Огтлолууд",
  "BA.dl_facades": "Нүүр талууд",
  "BA.dl_bathroom": "Ариун цэврийн өрөөний хэсэглэл, дэлгээс",
  "BA.dl_door_window": "Цонх, хаалганы схем, бүтэц, түүвэр",
  "BA.dl_glass_wall": "Шилэн ханын нэгдсэн түүвэр",
  "BA.dl_system_detail": "Систем деталь",
  "BA.dl_wall_section": "Ханын хэсэглэл",
  "BA.dl_floor_assembly": "Шалны байгуулалтууд",
  "BA.dl_floor_ceiling_detail": "Шал, таазны хийц, бүтэц, түүвэр",
  "BA.dl_ceiling_assembly": "Таазны байгуулалтууд",
  "BA.dl_elevator": "Цахилгаан шат, шатны хэсэглэл",
  "BA.dl_outdoor_porch": "Гадна довжоо, шатны хэсэглэл",
  "BA.dl_fire_stair": "Галын шатны хэсэглэл",
  "BA.dl_technology": "Технологийн байгуулалтууд",
  "BA.dl_other": "Бусад нарийн хэсэглэл",
  "BB.dl_cover": "Нүүр хуудас",
  "BB.dl_drawing_list": "Зургийн жагсаалт",
  "BB.dl_explanatory_note": "Тайлбар бичиг",
  "BB.dl_foundation_plan": "Суурийн байгуулалт",
  "BB.dl_column_plan": "Багана / даацын ханын байгуулалт",
  "BB.dl_slab_plan": "Хучилтын байгуулалт",
  "BB.dl_beam_layout": "Дам нурууны байгуулалт",
  "BB.dl_rebar_details": "Арматурын зураг",
  "BB.dl_sections": "Огтлолууд",
  "BB.dl_details": "Деталь, зангилаа",
  "HAS.dl_cover": "Нүүр хуудас",
  "HAS.dl_drawing_list": "Зургийн жагсаалт",
  "HAS.dl_explanatory_note": "Тайлбар бичиг",
  "HAS.dl_heating_plan": "Халаалтын төлөвлөгөө",
  "HAS.dl_vent_plan": "Агаар сэлгэлтийн төлөвлөгөө",
  "HAS.dl_ac_plan": "Хөргөлтийн (АС/VRV) төлөвлөгөө",
  "HAS.dl_smoke_plan": "Утаа зайлуулах төлөвлөгөө",
  "HAS.dl_riser_diagram": "Шугам холболтын схем",
  "HAS.dl_equipment_schedule": "Тоног төхөөрөмжийн жагсаалт",
  "HAS.dl_sections": "Огтлолууд",
  "HAS.dl_details": "Деталь, зангилаа",
  "TSBU.dl_cover": "Нүүр хуудас",
  "TSBU.dl_drawing_list": "Зургийн жагсаалт",
  "TSBU.dl_explanatory_note": "Тайлбар бичиг",
  "TSBU.dl_cold_water_plan": "Цэвэр усны төлөвлөгөө",
  "TSBU.dl_hot_water_plan": "Халуун усны төлөвлөгөө",
  "TSBU.dl_sewage_plan": "Бохирын төлөвлөгөө",
  "TSBU.dl_storm_plan": "Борооны ус зайлуулах төлөвлөгөө",
  "TSBU.dl_sprinkler_plan": "Спринклер, галын төлөвлөгөө",
  "TSBU.dl_riser_diagram": "Босоо шугамын схем",
  "TSBU.dl_techroom": "Техникийн өрөө",
  "TSBU.dl_equipment_schedule": "Тоног төхөөрөмжийн жагсаалт",
  "TSBU.dl_sections": "Огтлолууд",
  "TSBU.dl_details": "Деталь, зангилаа",
  "TSAH.dl_cover": "Нүүр хуудас",
  "TSAH.dl_drawing_list": "Зургийн жагсаалт",
  "TSAH.dl_explanatory_note": "Тайлбар бичиг",
  "TSAH.dl_single_line": "Нэг шугамын схем",
  "TSAH.dl_power_plan": "Цахилгаан хангамжийн төлөвлөгөө",
  "TSAH.dl_lighting_plan": "Гэрэлтүүлгийн төлөвлөгөө",
  "TSAH.dl_outlet_plan": "Розеткын төлөвлөгөө",
  "TSAH.dl_emergency_lighting": "Авагдаах гэрэлтүүлэг",
  "TSAH.dl_grounding_plan": "Газардуулгын төлөвлөгөө",
  "TSAH.dl_lightning_plan": "Аянгаас хамгаалах",
  "TSAH.dl_ev_charging": "EV цэнэглэгчийн төлөвлөгөө",
  "TSAH.dl_equipment_schedule": "Тоног төхөөрөмжийн жагсаалт",
  "TSAH.dl_cable_schedule": "Кабелийн жагсаалт",
  "TSAH.dl_details": "Деталь, зангилаа",
  "HD.dl_cover": "Нүүр хуудас",
  "HD.dl_drawing_list": "Зургийн жагсаалт",
  "HD.dl_explanatory_note": "Тайлбар бичиг",
  "HD.dl_phone_plan": "Утасны сүлжээний төлөвлөгөө",
  "HD.dl_computer_plan": "Компьютерын сүлжээний төлөвлөгөө",
  "HD.dl_cctv_plan": "CCTV-ийн төлөвлөгөө",
  "HD.dl_access_plan": "Нэвтрэх хяналтын төлөвлөгөө",
  "HD.dl_fa_plan": "Гал дохиоллын төлөвлөгөө",
  "HD.dl_pa_plan": "Зарлан мэдээллийн төлөвлөгөө",
  "HD.dl_cable_tv_plan": "Кабелийн ТВ-ийн төлөвлөгөө",
  "HD.dl_server_room": "Серверийн өрөөний зураг",
  "HD.dl_riser_diagram": "Босоо шугамын схем",
  "HD.dl_equipment_schedule": "Тоног төхөөрөмжийн жагсаалт",
  "HD.dl_details": "Деталь, зангилаа",
  "AU.dl_cover": "Нүүр хуудас",
  "AU.dl_drawing_list": "Зургийн жагсаалт",
  "AU.dl_explanatory_note": "Тайлбар бичиг",
  "AU.dl_bms_architecture": "BMS системийн архитектур",
  "AU.dl_bms_io_list": "Мэдрэгч, удирдлагын I/O жагсаалт",
  "AU.dl_home_auto": "Home автоматжуулалтын зураг",
  "AU.dl_integration_diagram": "Системүүдийн уялдааны схем",
  "AU.dl_monitoring_room": "Хяналтын өрөөний зураг",
  "AU.dl_equipment_schedule": "Тоног төхөөрөмжийн жагсаалт",
  "AU.dl_details": "Деталь, зангилаа",
  "IZ.dl_wall_model": "Хана модельчлох",
  "IZ.dl_floor_model": "Шал модельчлох",
  "IZ.dl_ceiling_model": "Тааз модельчлох",
  "IZ.dl_furniture_model": "Тавилга модельчлох",
  "IZ.dl_demo_wall_layout": "Нураах ханын байгуулалт",
  "IZ.dl_main_layout": "Үндсэн байгуулалт",
  "IZ.dl_ceiling_layout": "Таазны байгуулалт",
  "IZ.dl_floor_layout": "Шалны байгуулалт",
  "IZ.dl_lighting_layout": "Гэрлийн байгуулалт",
  "IZ.dl_furniture_layout": "Тавилгын байгуулалт",
  "IZ.dl_sockets_switches": "Розетка, унтраалга",
  "IZ.dl_comms_alarm": "Холбоо дохиолол",
  "IZ.dl_wall_elevations": "Ханын дэлгээс",
  "IZ.dl_furniture_details": "Тавилгын хэсэгчилсэн зураг",
  "IZ.dl_ceiling_wall_sections": "Тааз, хана хэсэгчлэл",
  "IZ.dl_quantities": "Тоо хэмжээ"
};
