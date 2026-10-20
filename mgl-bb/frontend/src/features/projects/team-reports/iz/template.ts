/* =============================================================
 * IZ (Интерьер зураг) report template.
 * -------------------------------------------------------------
 * Бодит интерьер тайлан шиг: концепц → бүсээр давтагдах өнгөлгөө,
 * тоноглолын шийдэл → 3D рендерийн индекс → зургийн жагсаалт. Норм/техникийн
 * өрөө/гал зэрэг нийтлэг зүйлс нь project-level табуудад байгаа
 * тул энд давхардуулахгүй.
 * ============================================================= */
import type { SectionDef } from '@/features/projects/team-reports/types';
import type { IzReportAnswers } from '@/features/projects/team-reports/iz/types';

export type IzSection = SectionDef<IzReportAnswers>;

export const IZ_SECTIONS: IzSection[] = [
  {
    id: 'concept',
    title: 'Ерөнхий шийдэл / Концепц',
    blurb: 'Интерьерийн хэв маяг, өнгө аяс, дизайны гол санаа, цар хүрээ.',
    fields: [
      {
        key: 'iz_concept',
        label: 'Концепцийн тайлбар',
        kind: 'textarea',
        span: 'full',
        placeholder:
          'Жишээ нь: Орчин үеийн минимал хэв маяг, байгалийн материал (мод, чулуу), дулаан өнгөний шийдэлд тулгуурлан тав тухтай, нэр хүндтэй орчныг бий болгох...',
      },
    ],
  },
  {
    id: 'zones',
    title: 'Бүсчлэлийн шийдэл',
    blurb:
      'Бүс (хэсэг) тус бүрээр хана, шал, тааз, гэрэлтүүлэг, тавилга зэрэг өнгөлгөө, тоноглолын шийдлийг бичнэ.',
    fields: [{ key: 'iz_zones', label: 'Бүсүүд', kind: 'zone-rows', span: 'full' }],
  },
  {
    id: 'render-index',
    title: '3D рендерийн индекс',
    blurb: 'Давхар бүрээр рендер зургийн хэсэг ба хуудасны тоо.',
    fields: [{ key: 'iz_render_index', label: 'Рендерийн индекс', kind: 'floor-areas-rows', span: 'full' }],
  },
  {
    id: 'drawing-list',
    title: 'Интерьерийн зургийн жагсаалт',
    fields: [
      { key: 'dl_wall_model', label: '1.  Хана модельчлох', kind: 'checkbox', span: 'full' },
      { key: 'dl_floor_model', label: '2.  Шал модельчлох', kind: 'checkbox', span: 'full' },
      { key: 'dl_ceiling_model', label: '3.  Тааз модельчлох', kind: 'checkbox', span: 'full' },
      { key: 'dl_furniture_model', label: '4.  Тавилга модельчлох', kind: 'checkbox', span: 'full' },
      { key: 'dl_demo_wall_layout', label: '5.  Нураах ханын байгуулалт', kind: 'checkbox', span: 'full' },
      { key: 'dl_main_layout', label: '6.  Үндсэн байгуулалт', kind: 'checkbox', span: 'full' },
      { key: 'dl_ceiling_layout', label: '7.  Таазны байгуулалт', kind: 'checkbox', span: 'full' },
      { key: 'dl_floor_layout', label: '8.  Шалны байгуулалт', kind: 'checkbox', span: 'full' },
      { key: 'dl_lighting_layout', label: '9.  Гэрлийн байгуулалт', kind: 'checkbox', span: 'full' },
      { key: 'dl_furniture_layout', label: '10. Тавилгын байгуулалт', kind: 'checkbox', span: 'full' },
      { key: 'dl_sockets_switches', label: '11. Розетка, унтраалга', kind: 'checkbox', span: 'full' },
      { key: 'dl_comms_alarm', label: '12. Холбоо дохиолол', kind: 'checkbox', span: 'full' },
      { key: 'dl_wall_elevations', label: '13. Ханын дэлгээс', kind: 'checkbox', span: 'full' },
      { key: 'dl_furniture_details', label: '14. Тавилгын хэсэгчилсэн зураг', kind: 'checkbox', span: 'full' },
      { key: 'dl_ceiling_wall_sections', label: '15. Тааз, хана хэсэгчлэл', kind: 'checkbox', span: 'full' },
      { key: 'dl_quantities', label: '16. Тоо хэмжээ', kind: 'checkbox', span: 'full' },
    ],
  },
];
