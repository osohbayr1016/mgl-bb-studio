/* Drawing/component preset catalogue.

 Codes (BA, BB, …) match both a drawing type prefix and a `teams.code` row,
 which is how we can filter the assignee picker by team once the user has
 chosen a drawing type.
 *
 * Moved verbatim out of `AdminProjectSetupPage.tsx` when that ~5 700-line
 * module was split up. Data only — no behavioural change. */

export const DRAWING_TYPES = [
  { code: 'BA', name: 'Барилга архитектур' },
  { code: 'BB', name: 'Барилга бүтээц' },
  { code: 'HAS', name: 'Халаалт агаар сэлгэлт' },
  { code: 'TSBU', name: 'Цэвэр бохир ус' },
  { code: 'TSAH', name: 'Цахилгаан' },
  { code: 'HD', name: 'Холбоо дохиолол' },
  { code: 'AU', name: 'Автомат удирдлага' },
  { code: 'EZ', name: 'Эскиз зураг' },
  { code: 'IZ', name: 'Интерьер зураг' },
  { code: 'GT', name: 'Гадна тохижилт' },
];

export const BA_COMPONENT_PRESETS = [
  'Ерөнхий төлөвлөгөө',
  'Байгуулалт',
  'Огтлол',
  'Хэсэгчилсэн байгуулалт',
  'Гадна фасад',
  'Түүвэр',
  'Хэсэглэл',
  '3D харагдах байдал',
];

export const BB_COMPONENT_PRESETS = [
  'Барилга бүтээцийн тооцоо',
  'Тооцооны тайлан',
  'Барилгын модел /Revit tekla/',
  'Суурийн ажлын зураг',
  'Рамын ажлын зураг (багана, дам нуруу)',
  'Хана',
  'Хучилт',
  'Шат',
  'Ажлын зураг хэвлэлтэнд бэлдэх',
];

export const HAS_COMPONENT_PRESETS = [
  'Халаалтын систем',
  'Агаар сэлгэлтийн систем',
  'Хөргөлтийн систем',
  'ХАС-н систем',
];

export const TSBU_COMPONENT_PRESETS = ['Цэвэр ус', 'Бохир ус', 'Автомат галын ус', 'Борооны ус', 'Бусад'];

export const TSAH_COMPONENT_PRESETS = [
  'Гэрэлтүүлэг',
  'Розетка',
  'Хүчит төхөөрөмж',
  'Аянга хамгаалалт, газардуулга',
  'Бусад (Цахилгаан)',
];

// HD (Холбоо дохиолол) — five-component layout per the latest spec.
// Drawing-level weight = 5 % of the block. Component weights live in
// PRESET_COMPONENT_WEIGHTS.HD below.
export const HD_COMPONENT_PRESETS = [
  'Галын дохиоллын байгуулалт',
  'Интернет, телефон, IPTB сүлжээний байгуулалт',
  'Нэвтрэх системийн байгуулалт',
  'Камер, зарлан мэдээлэх системийн байгуулалт',
  'Бусад (Холбоо дохиолол)',
];

// AU (Автомат удирдлага) = ИСА + ГА (50 / 50). БНУС stays defined in
// COMPONENT_TASK_PRESETS for ad-hoc manual add via the +Бүрдэл dialog,
// but is not part of the auto-scaffold tree.
export const AU_COMPONENT_PRESETS = ['ИСА', 'ГА'];

export const EZ_COMPONENT_PRESETS = [
  'Судалгааны үе шат',
  'Концепц санаа',
  'Төлөвлөлтийн үе шат',
  'Бичиг баримт',
  'Диаграмм-Зураглал',
  'Ерөнхий төлөвлөгөө (Эскиз)',
  'Давхрын байгуулалт (Эскиз)',
  'Нүүр тал (Эскиз)',
  'Огтлол (Эскиз)',
  'Харагдах байдал (Эскиз)',
  'Хүлээлгэж өгөх',
];

export const IZ_COMPONENT_PRESETS = [
  'Интерьер дизайны санаа танилцуулах',
  'Модельчлол',
  'Рендер боловсруулах',
  'Үндсэн байгуулалт (Интерьер)',
  'Огтлол, хэсэглэл',
  'Ханын дэлгээс (Интерьер)',
  'Түүвэр (Интерьер)',
];

export const GT_COMPONENT_PRESETS = [
  'Зургийн жагсаалт, тайлбар бичиг (Гадна тохижилт)',
  'Ерөнхий төлөвлөгөө (Гадна тохижилт)',
  'Улаан шугам (Гадна тохижилт)',
  'Өндөржилт (Гадна тохижилт)',
  'Зай хэмжээ (Гадна тохижилт)',
  'Картограмм',
  'Зам талбайн хучилт',
  'Ногоон байгууламж',
  'Усны гаргалгаа',
  'Гадна гэрэлтүүлэгийн байгуулалт',
  'Зам талбайн тэмдэглэгээ',
  'Хэсэгчилсэн байгуулалт (Гадна тохижилт)',
  'Хэсэглэл (Гадна тохижилт)',
  'Түшиц хана',
  'Нэгдсэн түүвэр',
  'Харагдах байдал (Гадна тохижилт)',
];
