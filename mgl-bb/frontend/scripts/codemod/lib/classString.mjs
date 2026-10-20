/**
 * Tailwind класс мөрийг задалж, түүхий палитр класс болон шууд бичсэн
 * үсгийн хэмжээг семантик токен руу зураглана.
 *
 * Гол зарчим: ШИЙДЭЖ ЧАДАХГҮЙ БОЛ БҮҮ ХӨНД. Буруу зураглал нь чимээгүй
 * визуал регресс үүсгэдэг бол шийдэгдээгүй класс нь зүгээр л тайланд
 * гарч, хүн харна.
 */

/* ⚠ Regex-ийг ЛИТЕРАЛ хэлбэрээр бич. `new RegExp('…' + '\\d')` мэтээр
   угсарвал escape алдагдаж (`\/d` болох гэх мэт) дүрэм чимээгүй 0 таарц
   өгнө — энэ төслийн туршилтын үед яг тэр тохиолдсон. */
const TOKEN_RE =
  /^((?:[a-z0-9-]+:|data-\[[^\]]*\]:|\[&[^\]]*\]:)*)(bg|text|border|ring|from|to|via|fill|stroke|divide|shadow|accent|outline|decoration|caret|placeholder)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(50|100|200|300|400|500|600|700|800|900|950)(\/\d{1,3})?$/;

const ARBITRARY_TEXT_RE = /^((?:[a-z0-9-]+:|data-\[[^\]]*\]:|\[&[^\]]*\]:)*)text-\[([0-9.]+)px\]$/;

const MUTED_ALPHA_RE =
  /^((?:[a-z0-9-]+:|data-\[[^\]]*\]:|\[&[^\]]*\]:)*)text-muted-foreground\/(\d{1,3})$/;

/** Палитрын гэр бүл → семантик токен. */
const FAMILY = {
  emerald: 'success',
  green: 'success',
  teal: 'success',
  lime: 'success',
  amber: 'warning',
  yellow: 'warning',
  orange: 'warning',
  red: 'danger',
  rose: 'danger',
  pink: 'danger',
  sky: 'info',
  blue: 'info',
  cyan: 'info',
  indigo: 'info',
  // violet/purple/fuchsia — семантик гэр байхгүй. Зориуд орхив
  // (`LEAVE_TYPE_TONE.remote` нь ягааныг санаатай хэрэглэдэг).
};

/** Саарал гэр бүлүүд — тэнхлэг тус бүрд өөр утгатай, автоматжуулахгүй. */
const NEUTRAL = new Set(['slate', 'gray', 'zinc', 'neutral', 'stone']);

/** Хэмжээ → типографийн шатлал. Кирилл 9-10px дээр уншигдахгүй тул өснө. */
function typeScaleFor(px) {
  const n = Number(px);
  if (n <= 10.5) return 'text-micro';
  if (n <= 12) return 'text-micro';
  if (n <= 14) return 'text-body';
  if (n <= 18) return 'text-section';
  return null; // 22px, 44px — hero тоо, дизайнерын шийдвэр
}

/**
 * Нэг класс токеныг зураглана.
 * @returns {{ok:true, out:string, base:string}|{ok:false, reason:string}}
 */
function mapToken(tok) {
  const arb = ARBITRARY_TEXT_RE.exec(tok);
  if (arb) {
    const scale = typeScaleFor(arb[2]);
    return scale
      ? { ok: true, out: `${arb[1]}${scale}`, base: `${arb[1]}${scale}` }
      : { ok: false, reason: 'HERO_SIZE' };
  }

  const muted = MUTED_ALPHA_RE.exec(tok);
  if (muted) {
    const a = Number(muted[2]);
    // ≥70% нь суурь токеноос ялгагдахгүй; <70% нь 1.6–3.1:1 буюу уншигдахгүй.
    const out = a >= 70 ? `${muted[1]}text-muted-foreground` : `${muted[1]}text-muted-subtle`;
    return { ok: true, out, base: out };
  }

  const m = TOKEN_RE.exec(tok);
  if (!m) return { ok: false, reason: 'NOT_PALETTE' };
  const [, variant, prop, family, shadeStr, alpha] = m;
  const shade = Number(shadeStr);

  if (NEUTRAL.has(family)) return { ok: false, reason: 'NEUTRAL_SURFACE' };
  const token = FAMILY[family];
  if (!token) return { ok: false, reason: 'UNMAPPED_FAMILY' };

  // Градиент / зурах шинж чанарууд — семантик эквивалент байхгүй.
  if (['from', 'to', 'via', 'fill', 'stroke', 'shadow', 'accent', 'outline', 'decoration', 'caret', 'placeholder'].includes(prop))
    return { ok: false, reason: 'DECORATIVE_PROP' };

  if (prop === 'text') {
    // 300-700 нь харанхуй (-400) ба гэрэл (-700) хоёрын нийтлэг идиом.
    if (shade < 300 || shade > 700) return { ok: false, reason: 'TEXT_EDGE_SHADE' };
    return { ok: true, out: `${variant}text-${token}${alpha ?? ''}`, base: `${variant}text-${token}` };
  }

  if (prop === 'bg') {
    if (alpha) return { ok: true, out: `${variant}bg-${token}${alpha}`, base: `${variant}bg-${token}` };
    if (shade <= 100) return { ok: true, out: `${variant}bg-${token}/10`, base: `${variant}bg-${token}` };
    if (shade >= 400 && shade <= 700)
      return { ok: true, out: `${variant}bg-${token}`, base: `${variant}bg-${token}` };
    return { ok: false, reason: 'BG_EDGE_SHADE' };
  }

  if (prop === 'border' || prop === 'ring' || prop === 'divide') {
    if (alpha)
      return { ok: true, out: `${variant}${prop}-${token}${alpha}`, base: `${variant}${prop}-${token}` };
    if (shade <= 300)
      return { ok: true, out: `${variant}${prop}-${token}/30`, base: `${variant}${prop}-${token}` };
    return { ok: true, out: `${variant}${prop}-${token}`, base: `${variant}${prop}-${token}` };
  }

  return { ok: false, reason: 'UNKNOWN_PROP' };
}

/** `dark:` угтвартай эсэх. */
const isDark = (tok) => /(^|:)dark:/.test(tok);
/** `dark:` угтварыг хасаад суурь токеныг буцаана. */
const stripDark = (tok) => tok.replace(/(^|:)dark:/, '$1');

/**
 * Класс мөрийг бүхэлд нь дахин бичнэ.
 *
 * `dark:` ХОСЫН ДҮРЭМ: `dark:` токеныг ЗӨВХӨН түүний суурь зорилт нь
 * тухайн мөрөнд аль хэдийн үүссэн байвал хаяна. Болзолгүй хаявал
 * ийм алдаа гарна (прототипт бодитоор тохиолдсон):
 *   'from-rose-100 … dark:from-rose-950/60' → 'from-rose-100 …'
 * буюу градиент нь зураглагдаагүй мөртлөө харанхуй хувилбар нь устаж,
 * харанхуй горимд ЦАЙВАР градиент үлдэнэ.
 */
export function rewriteClassString(text) {
  // `split(/(\s+)/)` нь зайн зурвасуудыг ХАДГАЛНА. Тэдгээрийг эргүүлэн
  // тавих нь ЗААВАЛ: className-ууд олон мөрт байдаг бөгөөд нэг мөр
  // болгож нийлүүлбэл файлын мөрийн тоо өөрчлөгдөж, офсет хайчилбарын
  // «мөр урсгахгүй» гэсэн бүх баталгаа нурна (run.mjs-ийн хамгаалалт
  // үүнийг бодитоор барьсан).
  const parts = text.split(/(\s+)/);
  const undecidable = [];

  // 1-р дамжлага: `dark:` биш токенуудыг зураглаж, үүссэн суурь олонлогийг цуглуулна.
  const bases = new Set();
  const mapped = parts.map((p) => {
    if (/^\s*$/.test(p) || isDark(p)) return { raw: p, res: null };
    const res = mapToken(p);
    if (res.ok) bases.add(res.base);
    else if (res.reason !== 'NOT_PALETTE') undecidable.push({ token: p, reason: res.reason });
    return { raw: p, res };
  });

  // 2-р дамжлага: токен бүрийг ЗӨВХӨН ӨӨРИЙН БАЙРАНД нь сольж, эсвэл
  // хаях гэж тэмдэглэнэ. Зайн зурвасуудыг хөдөлгөхгүй.
  const slots = parts.slice();
  const drop = new Array(parts.length).fill(false);
  const seen = new Set();
  let changed = false;

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === '' || /^\s+$/.test(p)) continue;

    if (isDark(p)) {
      const inner = mapToken(stripDark(p));
      if (inner.ok && bases.has(inner.base)) {
        // Суурь токен хоёр горимыг хамарна → `dark:` илүүц.
        drop[i] = true;
        changed = true;
        continue;
      }
      if (!inner.ok && inner.reason !== 'NOT_PALETTE')
        undecidable.push({ token: p, reason: 'DARK_' + inner.reason });
      continue;
    }

    const res = mapped[i].res;
    if (res?.ok) {
      if (res.out !== p) changed = true;
      slots[i] = res.out;
    }
  }

  /* ── ШОШГЫН ХЭВ МАЯГ ──
   * `text-[10px] uppercase tracking-wider` гэх мэт гурвал нь шатлалын
   * ШОШГЫН түвшин (баганын толгой, eyebrow, тэмдэглэгээ). `text-label`
   * нь хэмжээ + 600 жин + uppercase + tracking-ийг бүгдийг агуулдаг тул
   * дагалдах хоёр классыг хамт хаяна. Ганц токеноор шийдэх боломжгүй —
   * мөр бүхэлдээ харагдах ёстой. */
  const idxOf = (pred) => slots.findIndex((s, i) => !drop[i] && pred(s));
  const microIdx = idxOf((s) => s === 'text-micro');
  const upperIdx = idxOf((s) => s === 'uppercase');
  const trackIdx = idxOf((s) => /^tracking-/.test(s));
  if (microIdx >= 0 && upperIdx >= 0 && trackIdx >= 0) {
    slots[microIdx] = 'text-label';
    drop[upperIdx] = true;
    drop[trackIdx] = true;
    changed = true;
  }

  if (!changed) return { changed: false, text, undecidable };

  // Зураглалын дараа үүссэн давхардлыг хаяна (ж: `text-emerald-500
  // text-green-500` хоёулаа `text-success` болно).
  for (let i = 0; i < slots.length; i++) {
    if (drop[i] || slots[i] === '' || /^\s+$/.test(slots[i])) continue;
    if (seen.has(slots[i])) drop[i] = true;
    else seen.add(slots[i]);
  }

  /* Токен хаяхдаа хажуугийн НЭГ зайн зурваст нь хамт хаяна, эс тэгвэл
     давхар зай үлдэнэ.
     ⚠ Мөр таслалт АГУУЛСАН зурвасыг ХЭЗЭЭ Ч хаяхгүй: файлын мөрийн тоо
     өөрчлөгдвөл офсет хайчилбарын бүх баталгаа нурна. Хоёр тал нь мөр
     таслалттай бол ЮУГ Ч хаяхгүй — className дотор илүү зай огт хор
     хөнөөлгүй, харин алга болсон мөр бол алдаа. */
  for (let i = 0; i < slots.length; i++) {
    if (!drop[i]) continue;
    const isPlainWs = (j) =>
      j >= 0 && j < slots.length && /^\s+$/.test(slots[j]) && !drop[j] && !slots[j].includes('\n');
    if (isPlainWs(i + 1)) drop[i + 1] = true;
    else if (isPlainWs(i - 1)) drop[i - 1] = true;
  }

  const nextText = slots
    .filter((_, i) => !drop[i])
    .join('')
    // Гоо сайхны цэвэрлэгээ. Хоёулаа мөрийн ТООГ хөндөхгүй:
    // мөрийн төгсгөлийн зай, давхарласан энгийн зай.
    .replace(/[ \t]+(\r?\n)/g, '$1')
    .replace(/ {2,}/g, ' ');
  return { changed: nextText !== text, text: nextText, undecidable };
}
