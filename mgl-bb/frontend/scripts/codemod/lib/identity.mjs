/**
 * ӨНГӨ-ТАНИХ СИСТЕМИЙН ДЕТЕКТОР.
 *
 * Зарим өнгөний бүлэг нь ТӨЛӨВ биш, ТАНИХ ТЭМДЭГ илэрхийлдэг:
 *   ProjectDetailPage `DISCIPLINE_DOT` — 10 мэргэжил, 10 өнгө
 *   ProjectDetailPage `BLOCK_ACCENTS`
 *   DashboardPage      `TIME_OF_DAY`  — өдрийн 5 үе, градиент
 * Эдгээрийг 4 статус токен (success/warning/info/danger) руу шахвал
 * «нэг баг = нэг өнгө» гэдэг ойлголт бүрмөсөн устана.
 *
 * Эвристик: хамгийн ойрын объект/массив литерал дотор 3-аас ОЛОН өөр
 * палитрын гэр бүл байвал энэ нь таних тэмдгийн систем — бүхэлд нь
 * алгасна. Худал эерэг нь хүнд нэг харц зарцуулна; худал сөрөг нь
 * өнгөний системийг устгана. Тиймээс зориуд ХЭТ ТАТГАЛЗАНА.
 *
 * `complexity.ts`-ийн `if (n <= 25) return 'bg-emerald-500/10 …'` мэт
 * ЖИНХЭНЭ статус шаталбарыг барихгүй — тэнд объект литерал байхгүй.
 */

const FAMILY_RE =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|shadow)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/g;

const MAX_CLIMB = 6;
const MIN_FAMILIES = 3;

/**
 * @param {import('typescript')} ts
 * @param {import('typescript').Node} node  — шалгах string literal
 * @returns {{identity:boolean, families?:string[], container?:string}}
 */
export function detectIdentityPalette(ts, node) {
  let container = null;
  let cur = node.parent;
  for (let i = 0; i < MAX_CLIMB && cur; i++, cur = cur.parent) {
    if (ts.isObjectLiteralExpression(cur) || ts.isArrayLiteralExpression(cur)) {
      container = cur;
      break;
    }
  }
  if (!container) return { identity: false };

  const families = new Set();
  const walk = (n) => {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      n.kind === ts.SyntaxKind.TemplateHead ||
      n.kind === ts.SyntaxKind.TemplateMiddle ||
      n.kind === ts.SyntaxKind.TemplateTail
    ) {
      FAMILY_RE.lastIndex = 0;
      let m;
      while ((m = FAMILY_RE.exec(n.text)) !== null) families.add(m[1]);
    }
    ts.forEachChild(n, walk);
  };
  walk(container);

  if (families.size < MIN_FAMILIES) return { identity: false };

  // Контейнерийн нэрийг тайланд гаргахын тулд олох гэж оролдоно.
  let name = '(нэргүй)';
  let p = container.parent;
  for (let i = 0; i < 3 && p; i++, p = p.parent) {
    if (ts.isVariableDeclaration(p) && p.name) {
      name = p.name.getText();
      break;
    }
    if (ts.isPropertyAssignment(p) && p.name) {
      name = p.name.getText();
      break;
    }
  }
  return { identity: true, families: [...families], container: name };
}
