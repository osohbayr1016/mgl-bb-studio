// Файлын нэрнээс салбар (дисциплин) таних — MGL-ийн нэршлийн конвенц:
// 260701_TOYOTA_ServiceCenter_BA_F.rvt → БА, ..._HAS_D → ХАС, ..._TSBU_C → ЦБУ,
// ..._INT_A / INT_ЗААЛ → Интерьер, STEEL STRUCTURE → ББ гэх мэт. Танигдахгүй
// бол OTHER. Цэвэр функц — React-гүй, тесте хялбар.

export type DisciplineCode =
  | 'BA'
  | 'BB'
  | 'INT'
  | 'HAS'
  | 'TSBU'
  | 'TSAH'
  | 'HD'
  | 'AU'
  | 'ET'
  | 'OTHER';

/** i18n түлхүүр: qtoPage.disc<Code> (хоёр тольд бий). */
export const DISCIPLINE_LABEL_KEY: Record<DisciplineCode, string> = {
  BA: 'qtoPage.discBA',
  BB: 'qtoPage.discBB',
  INT: 'qtoPage.discINT',
  HAS: 'qtoPage.discHAS',
  TSBU: 'qtoPage.discTSBU',
  TSAH: 'qtoPage.discTSAH',
  HD: 'qtoPage.discHD',
  AU: 'qtoPage.discAU',
  ET: 'qtoPage.discET',
  OTHER: 'qtoPage.discOTHER',
};

/** Тогтмол дараалал — chips болон бүлгүүдийн эрэмбэ. */
export const DISCIPLINE_ORDER: DisciplineCode[] = [
  'BA',
  'BB',
  'INT',
  'HAS',
  'TSBU',
  'TSAH',
  'HD',
  'AU',
  'ET',
  'OTHER',
];

/** Токен → салбар. Латин ба кирилл хувилбарууд хоёулаа танигдана. */
const TOKEN_MAP: Record<string, DisciplineCode> = {
  BA: 'BA',
  БА: 'BA',
  BB: 'BB',
  ББ: 'BB',
  STEEL: 'BB',
  INT: 'INT',
  ИНТ: 'INT',
  HAS: 'HAS',
  ХАС: 'HAS',
  TSBU: 'TSBU',
  ЦБУ: 'TSBU',
  TSAH: 'TSAH',
  ЦАХ: 'TSAH',
  HD: 'HD',
  ХД: 'HD',
  AU: 'AU',
  АУ: 'AU',
  ET: 'ET',
  ЕТ: 'ET',
};

/** Нэг файлын нэрнээс салбарын код гаргана. */
export function detectDiscipline(fileName: string | null | undefined): DisciplineCode {
  if (!fileName) return 'OTHER';
  const tokens = fileName
    .toUpperCase()
    .split(/[^A-ZА-ЯЁӨҮ0-9]+/u)
    .filter(Boolean);
  // INT нь бусад кодтой хамт орсон байж болно (ж: INT_A) — эхэлж шалгана.
  if (tokens.includes('INT') || tokens.includes('ИНТ')) return 'INT';
  for (const token of tokens) {
    const code = TOKEN_MAP[token];
    if (code) return code;
  }
  return 'OTHER';
}
