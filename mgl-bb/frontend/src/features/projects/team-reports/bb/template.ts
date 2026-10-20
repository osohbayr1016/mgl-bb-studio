/* =============================================================
 * BB report template — Барилгын бүтээц Тайлбар бичиг.
 * -------------------------------------------------------------
 * 12 sections covering everything in a Mongolian structural-
 * design TOR: classification, soil, foundation, lateral system,
 * concrete / rebar, seismic, wind / special loads, calculation
 * methods, drawing list, signatures.
 *
 * No variant picker today — the lateral-system field handles
 * cast-in-place vs frame-braced vs steel vs hybrid as a single
 * select.  If a future deliverable needs deeper branching (e.g.
 * an all-steel template), promote it to a variant on BbPanel.
 *
 * Field labels and option text are in Mongolian to match the
 * delivered document; English summaries live in the body comments.
 * ============================================================= */
import type { SectionDef } from '@/features/projects/team-reports/types';
import type { BbReportAnswers } from '@/features/projects/team-reports/bb/types';

export type BbSection = SectionDef<BbReportAnswers>;

// Эхний хуудас (header) section removed — building name / location /
// client / design year+month live on the Мэдээлэл project passport.
// "Зураг төсөл боловсруулах үндэслэл" and "Барилгын ангилал" are
// authored on the BA (architecture) form and shared across disciplines.

export const SOIL_SECTION: BbSection = {
  id: 'soil',
  title: 'Геотехникийн нөхцөл',
  blurb: 'Барилгын талбайн хөрсний нөхцөл, гидрогеологийн үзүүлэлт, газар хөдлөлтийн хөрсний анги.',
  fields: [
    {
      key: 'soil_narrative',
      label: 'Хөрсний нөхцлийн товч тайлбар',
      kind: 'textarea',
      span: 'full',
      placeholder:
        'Жишээ нь: Барилгын талбай нь дунд нягт элсэрхэг хайрга, доор нь үндсэн чулуулагаас тогтоно. Хайрга давхрын зузаан ≈ 8м, RQD = 45%, доор үндсэн чулуулаг.',
      hint: 'ИГ судалгаа, штамп туршилт, RQD, давхарга бүрийн зузаан.',
    },
    {
      key: 'soil_groundwater_depth',
      label: 'Газрын доорх усны түвшин',
      kind: 'text',
      span: 'half',
      suffix: 'м',
    },
    {
      key: 'soil_freezing_depth',
      label: 'Хөрс хөлдөлтийн гүн',
      kind: 'text',
      span: 'half',
      suffix: 'м',
    },
    {
      key: 'soil_seismic_category',
      label: 'Хөрсний газар хөдлөлтийн анги',
      kind: 'select',
      span: 'half',
      options: [
        { value: 'I', label: 'I (хатуу чулуулаг)' },
        { value: 'II', label: 'II (хатуу хөрс)' },
        { value: 'III', label: 'III (зөөлөн хөрс)' },
      ],
    },
    {
      key: 'soil_rqd_min',
      label: 'Хамгийн бага RQD утга',
      kind: 'text',
      span: 'half',
      suffix: '%',
    },
    {
      key: 'soil_design_resistance',
      label: 'Хөрсний тооцооны эсэргүүцэл R0',
      kind: 'text',
      span: 'half',
      suffix: 'тонн/м²',
    },
    {
      key: 'soil_special_conditions',
      label: 'Онцгой нөхцөл, нөлөөлөл',
      kind: 'textarea',
      span: 'full',
      placeholder:
        'Жишээ нь: Хөрсний усны шавхалт хийх шаардлагатай. Зэргэлдээх барилгуудын суурьт нөлөөлөл хийсэн судалгаа, штамп туршилт, хамгаалалтын ажлын зураг хавсаргасан.',
      hint: 'Шавхалт, нөлөөллийн үнэлгээ, ойр орчмын барилгад хийх хамгаалалт.',
    },
  ],
};

export const FOUNDATION_SECTION: BbSection = {
  id: 'foundation',
  title: 'Суурь',
  fields: [
    {
      key: 'foundation_type',
      label: 'Суурийн төрөл',
      kind: 'select',
      span: 'half',
      options: [
        { value: 'mat', label: 'Нил хавтан суурь' },
        { value: 'strip', label: 'Шугаман суурь' },
        { value: 'cup', label: 'Аяган суурь' },
        { value: 'pile', label: 'Шонгийн суурь' },
        { value: 'hybrid', label: 'Холимог суурь' },
      ],
    },
    { key: 'foundation_depth', label: 'Суурийн гүн', kind: 'text', span: 'half', suffix: 'м' },
    {
      key: 'foundation_thickness',
      label: 'Суурийн зузаан',
      kind: 'number',
      span: 'half',
      suffix: 'мм',
    },
    {
      key: 'foundation_concrete_grade',
      label: 'Бетоны марк',
      kind: 'text',
      span: 'half',
      placeholder: 'B30',
    },
    {
      key: 'foundation_water_class',
      label: 'Усны эсэргүүцлийн анги',
      kind: 'text',
      span: 'half',
      placeholder: 'W8',
    },
    {
      key: 'foundation_rebar_main',
      label: 'Үндсэн арматур',
      kind: 'text',
      span: 'half',
      placeholder: 'A500C',
    },
    {
      key: 'foundation_rebar_aux',
      label: 'Туслах арматур',
      kind: 'text',
      span: 'half',
      placeholder: 'A240',
    },
    {
      key: 'foundation_settlement_max',
      label: 'Зөвшөөрөгдөх хамгийн их суулт',
      kind: 'text',
      span: 'half',
      suffix: 'см',
      hint: 'Өндөр барилгад 15см-ээс ихгүй (БНбД 50-01-16).',
    },
  ],
};

export const FRAMING_SECTION: BbSection = {
  id: 'framing',
  title: 'Үндсэн каркас (даацын систем)',
  blurb: 'Барилгын үндсэн даацын системийн төрөл, баганын хэмжээ, алслал, хучилтын систем.',
  fields: [
    {
      key: 'lateral_system',
      label: 'Үндсэн системийн төрөл',
      kind: 'select',
      span: 'full',
      options: [
        { value: 'cast_in_place', label: 'Бүрэн цутгамал төмөр бетон' },
        { value: 'rc_frame', label: 'Рам-холбоост ТБ каркас' },
        { value: 'shear_wall', label: 'ТБ ханан даацт' },
        { value: 'steel_frame', label: 'Металл каркас' },
        { value: 'hybrid', label: 'Холимог систем' },
      ],
      hint: 'МАКС ӨРГӨӨ хурлын зөвлөмжийн дагуу 21 давхрын өндөр барилгад бүрэн цутгамал хийц зөвлөмж болгодог.',
    },
    {
      key: 'wall_thickness',
      label: 'Хана / цөмийн зузаан',
      kind: 'number',
      span: 'half',
      suffix: 'мм',
    },
    {
      key: 'column_grid',
      label: 'Баганын алслал',
      kind: 'text',
      span: 'half',
      placeholder: '9 × 8 м',
    },
    {
      key: 'column_size',
      label: 'Баганын хэмжээ',
      kind: 'text',
      span: 'half',
      placeholder: '400 × 600 мм',
    },
    {
      key: 'slab_system',
      label: 'Хучилтын систем',
      kind: 'select',
      span: 'half',
      options: [
        { value: 'flat', label: 'Тэгш хавтан (flat slab)' },
        { value: 'beam_slab', label: 'Дам нуруутай хавтан' },
        { value: 'metal_deck', label: 'Металл тавцантай ТБ' },
      ],
    },
    { key: 'slab_thickness', label: 'Хучилтын зузаан', kind: 'number', span: 'half', suffix: 'мм' },
  ],
};

export const MATERIALS_SECTION: BbSection = {
  id: 'materials',
  title: 'Бетон, арматур',
  fields: [
    {
      key: 'concrete_grade_main',
      label: 'Үндсэн бетоны марк',
      kind: 'text',
      span: 'half',
      placeholder: 'B30',
    },
    {
      key: 'concrete_grade_secondary',
      label: 'Хоёрдогч бетоны марк',
      kind: 'text',
      span: 'half',
      placeholder: 'B25 / B20',
    },
    {
      key: 'rebar_grade_main',
      label: 'Үндсэн арматурын марк',
      kind: 'text',
      span: 'half',
      placeholder: 'A500C',
      hint: 'MNS GOST 34028:2024 шаардлагад нийцсэн байна.',
    },
    {
      key: 'rebar_secondary',
      label: 'Хоёрдогч арматур',
      kind: 'text',
      span: 'half',
      placeholder: 'A400',
    },
    {
      key: 'rebar_grade_aux',
      label: 'Туслах арматур',
      kind: 'text',
      span: 'half',
      placeholder: 'A240',
    },
  ],
};

export const SEISMIC_SECTION: BbSection = {
  id: 'seismic',
  title: 'Газар хөдлөлтийн тооцоо',
  blurb:
    'БНОД 22-01-21 дагуу тооцоонд авах нэмэлт өгөгдлүүд + блок хооронд төлөвлөсөн газар хөдлөлтийн заадас.',
  fields: [
    { key: 'seismic_k0', label: 'K0', kind: 'text', span: 'half', placeholder: '1.1' },
    { key: 'seismic_k1', label: 'K1', kind: 'text', span: 'half', placeholder: '0.25' },
    { key: 'seismic_k_psi', label: 'Kψ', kind: 'text', span: 'half', placeholder: '1' },
    {
      key: 'seismic_calc_method',
      label: 'Тооцооны арга',
      kind: 'select',
      span: 'half',
      options: [
        { value: 'response_spectrum', label: 'Хариу спектр (response spectrum)' },
        { value: 'time_history', label: 'Цаг хугацааны (time history)' },
        { value: 'pushover', label: 'Пушовер (pushover)' },
      ],
    },
    {
      key: 'seismic_joint_count',
      label: 'Газар хөдлөлтийн заадасны тоо',
      kind: 'number',
      span: 'half',
      suffix: 'тоо',
    },
    {
      key: 'seismic_joint_locations',
      label: 'Заадасны байрлал',
      kind: 'textarea',
      span: 'full',
      placeholder:
        'Жишээ нь: Y8 тэнхлэгээр А блок ба Б блокын хооронд салгасан суултын заадас 50мм өргөнтэй.',
    },
  ],
};

export const LOADS_SECTION: BbSection = {
  id: 'loads',
  title: 'Салхины ачаалал ба онцгой ачаалал',
  fields: [
    {
      key: 'wind_5yr_pressure',
      label: '5 жилд нэг удаа тохиох салхины даралт',
      kind: 'text',
      span: 'half',
      suffix: 'кг/м²',
      hint: 'БНбД 23-01-09: Улаанбаатарт ≈ 33 кг/м².',
    },
    {
      key: 'wind_resonance_check',
      label: 'Салхины резонансыг шалгасан',
      kind: 'checkbox',
      span: 'full',
      hint: '30м-ээс өндөр барилгад заавал хийнэ.',
    },
    { key: 'vehicle_load_3t', label: 'Авто ачаалал 3 тонн', kind: 'checkbox', span: 'full' },
    {
      key: 'vehicle_load_5t',
      label: 'Хүргэлтийн машины ачаалал 5 тонн',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'vehicle_load_26t',
      label: 'Гал унтраах машины ачаалал 26 тонн',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'helipad_static_load',
      label: 'Нисдэг тэрэгний статик ачаалал',
      kind: 'text',
      span: 'half',
      suffix: 'кг',
      hint: 'Дээвэр дээр нисдэг тэрэгний буудал төлөвлөсөн тохиолдолд.',
    },
    {
      key: 'helipad_dynamic_load',
      label: 'Нисдэг тэрэгний динамик ачаалал',
      kind: 'text',
      span: 'half',
      suffix: 'кг',
    },
    {
      key: 'aerodynamic_method',
      label: 'Аэродинамик илтгэлцүүрийн тодорхойлох арга',
      kind: 'textarea',
      span: 'full',
      placeholder:
        'БНбД 20-04-17 + "Өндөр барилгын төлөвлөлт" норм + зөвшөөрөгдсөн програмаар тодорхойлсон.',
    },
  ],
};

export const CALC_SECTION: BbSection = {
  id: 'calc',
  title: 'Тооцоо төлөвлөлт',
  blurb: 'Хязгаарын төлвүүдээр тооцоо хийсэн эсэх, өргөжин нурах эвдрэл, байнгын хяналт.',
  fields: [
    {
      key: 'limit_state_first_group',
      label: '1-р бүлэг хязгаарын төлвөөр тооцсон',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'limit_state_second_group',
      label: '2-р бүлэг хязгаарын төлвөөр шалгасан',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'progressive_collapse_calc',
      label: 'Өргөжин нурах эвдрэлийг тооцсон',
      kind: 'checkbox',
      span: 'full',
    },
    {
      key: 'permanent_monitoring',
      label: 'Даацын бүтээцийн байнгын хяналт шинжилгээ',
      kind: 'checkbox',
      span: 'full',
    },
  ],
};

export const DRAWING_LIST_SECTION: BbSection = {
  id: 'drawing-list',
  title: 'Барилгын бүтээцийн зургийн жагсаалт',
  blurb: 'Тайлбар бичигт хавсаргах БВ зургийн төрлүүдийг чагтлах.',
  fields: [
    { key: 'dl_cover', label: '1.  Нүүр хуудас', kind: 'checkbox', span: 'full' },
    { key: 'dl_drawing_list', label: '2.  Зургийн жагсаалт', kind: 'checkbox', span: 'full' },
    { key: 'dl_explanatory_note', label: '3.  Тайлбар бичиг', kind: 'checkbox', span: 'full' },
    { key: 'dl_foundation_plan', label: '4.  Суурийн байгуулалт', kind: 'checkbox', span: 'full' },
    {
      key: 'dl_column_plan',
      label: '5.  Багана / даацын ханын байгуулалт',
      kind: 'checkbox',
      span: 'full',
    },
    { key: 'dl_slab_plan', label: '6.  Хучилтын байгуулалт', kind: 'checkbox', span: 'full' },
    { key: 'dl_beam_layout', label: '7.  Дам нурууны байгуулалт', kind: 'checkbox', span: 'full' },
    { key: 'dl_rebar_details', label: '8.  Арматурын зураг', kind: 'checkbox', span: 'full' },
    { key: 'dl_sections', label: '9.  Огтлолууд', kind: 'checkbox', span: 'full' },
    { key: 'dl_details', label: '10. Деталь, зангилаа', kind: 'checkbox', span: 'full' },
  ],
};

// Гарын үсэг (signatures) section removed — signatures aren't authored
// per-discipline in the digital form; the bundled cover handles them.

export const BB_SECTIONS: BbSection[] = [
  SOIL_SECTION,
  FOUNDATION_SECTION,
  FRAMING_SECTION,
  MATERIALS_SECTION,
  SEISMIC_SECTION,
  LOADS_SECTION,
  CALC_SECTION,
  DRAWING_LIST_SECTION,
];
