import type { SectionDef } from '@/features/projects/team-reports/types';

/* =============================================================
 * GENERAL — "Үндэслэл, байршил, ангилал" төслийн нэгдсэн хэсэг.
 * -------------------------------------------------------------
 * Эдгээр нь барилгыг бүхэлд нь тодорхойлдог ТӨСЛИЙН ерөнхий
 * мэдээлэл бөгөөд зөвхөн архитектур (BA)-гийнх биш. Иймд BA-гийн
 * "Үндэслэл", "Байршил", "Барилгын ангилал" хэсгүүдийг энд
 * нэгтгэв (Норм/ROOMS/FIRE-тэй ижил project-level). Талбарын
 * түлхүүрийг хуучин BA-гийн нэрээр нь үлдээсэн.
 * ============================================================= */

export const GENERAL_SECTIONS: SectionDef[] = [
  {
    id: 'justification',
    title: 'Үндэслэл',
    blurb: 'Газар олголтын түвшин болон үндсэн зургийн даалгаврын товчоо.',
    fields: [
      {
        key: 'justification_kind',
        label: 'Үндэслэлийн төрөл',
        kind: 'select',
        span: 'full',
        options: [
          { value: 'city', label: 'Нийслэлийн / дүүргийн түвшний газар олголт' },
          { value: 'gov', label: 'Улсын / Засгийн газрын түвшний газар олголт' },
          { value: 'protected', label: 'ТХГН-ийн тусгай газар ашиглах эрх' },
        ],
      },
      {
        key: 'justification_text',
        label: 'Үндэслэлийн дэлгэрэнгүй',
        kind: 'textarea',
        span: 'full',
        placeholder:
          'Жишээ нь: НЗД-ын 2024.05.10-ны өдрийн А/127 тоот захирамжтай, СБД-ийн 4-р хорооны нутаг дэвсгэрт байршуулсан…',
        hint: 'Олгосон захирамж/тогтоол, нэгж талбарын дугаар, га, зориулалт, ХБХГ-ын даалгаврын дугаар, огнооноос бүрдэх.',
      },
    ],
  },
  {
    id: 'location',
    title: 'Байршил',
    blurb: 'Бүсчлэл, гудамж, нутаг дэвсгэрийн тодорхойлолт.',
    fields: [
      {
        key: 'location_zoning',
        label: 'Байршлын тодорхойлолт',
        kind: 'textarea',
        span: 'full',
        placeholder:
          'Жишээ нь: УБ хотын СБД, 4-р хорооны нутаг дэвсгэр, …-р гудамж, орон сууцны бүсэд багтана.',
      },
    ],
  },
  {
    id: 'classification',
    title: 'Барилгын ангилал',
    blurb:
      'Барилгын зориулалт, гал тэсвэршил, ашиглалтын хугацаа, газар хөдлөлтийн анги — норм дүрэмд тулгуурлан сонгох.',
    fields: [
      {
        key: 'building_purpose_category',
        label: 'Барилгын үндсэн зориулалт',
        kind: 'select',
        span: 'full',
        options: [
          { value: 'residential', label: 'Орон сууцны' },
          { value: 'public', label: 'Олон нийтийн (иргэний)' },
          { value: 'service', label: 'Үйлчилгээтэй орон сууцны' },
          { value: 'industrial', label: 'Үйлдвэрийн' },
          { value: 'mixed_use', label: 'Холимог зориулалттай' },
        ],
      },
      {
        key: 'building_complexity_class',
        label: 'Барилгын төвөгшлийн анги',
        kind: 'select',
        span: 'half',
        options: [
          { value: 'low', label: 'Бага' },
          { value: 'mid', label: 'Дунд' },
          { value: 'high', label: 'Өндөр' },
          { value: 'special', label: 'Онцгой' },
        ],
        hint: 'Онцгой: 51м-ээс дээш эсвэл 16 давхраас дээш барилга.',
      },
      {
        key: 'fire_safety_class',
        label: 'Гал тэсвэрлэлтийн анги',
        kind: 'select',
        span: 'half',
        options: ['I', 'II', 'III', 'IV', 'V'].map((v) => ({ value: v, label: v })),
        hint: 'БНбД 21-01-02 ангилал',
      },
      {
        key: 'building_lifetime_years',
        label: 'Ашиглалтын хугацаа',
        kind: 'number',
        span: 'half',
        suffix: 'жил',
        hint: 'БНбД 20-11 1-р хүснэгт: ихэвчлэн 50 эсвэл 100 жил',
      },
      {
        key: 'seismic_intensity_balls',
        label: 'Газар хөдлөлтийн эрчим',
        kind: 'select',
        span: 'half',
        options: [
          { value: '7', label: '7 балл' },
          { value: '8', label: '8 балл' },
          { value: '9', label: '9 балл' },
        ],
      },
      {
        key: 'reliability_class',
        label: 'Найдварлагын анги',
        kind: 'select',
        span: 'half',
        options: [
          { value: 'I', label: 'I (онцгой)' },
          { value: 'II', label: 'II (хэвийн)' },
          { value: 'III', label: 'III (бууруулсан)' },
        ],
      },
      {
        key: 'reliability_gamma_f',
        label: 'Найдварлагын итгэлцүүр γf',
        kind: 'text',
        span: 'half',
        placeholder: '1.1',
        hint: 'II ангид γf = 1.1, I ангид 1.2',
      },
    ],
  },
];
