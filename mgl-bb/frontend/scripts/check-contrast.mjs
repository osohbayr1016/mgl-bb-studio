#!/usr/bin/env node
/**
 * check-contrast — `src/index.css`-ийн семантик токенуудын WCAG 2.x
 * контрастыг шалгана. Гуравдагч сан ХЭРЭГЛЭХГҮЙ.
 *
 * Хэрэглээ:
 *   node scripts/check-contrast.mjs             # зөвхөн унасан/сануулга
 *   node scripts/check-contrast.mjs --verbose   # бүх мөр
 *   node scripts/check-contrast.mjs --json      # CI-д зориулсан JSON
 *
 * Exit код:
 *   0  бүх хатуу шалгалт хангасан
 *   1  дизайн унасан (контраст доогуур эсвэл scope parity зөрчигдсөн)
 *   2  бүтцийн алдаа — index.css уншигдахгүй, scope хоосон, г.м.
 *      (CI-д «дизайн муудсан» ба «script эвдэрсэн» хоёрыг ялгах боломж)
 *
 * Арга зүй:
 *   1. HSL → sRGB нь CSS Color 4-ийн алгоритмаар.
 *   2. Alpha-г gamma-кодлогдсон sRGB дотор нийлүүлнэ (browser-ийн хийдэг
 *      зүйл) — `bg-success/10` гэх мэт tint-ийг зөв загварчлахын тулд.
 *   3. Харьцангуй гэрэлтэлт + харьцаа нь WCAG 2.x-ийн томьёогоор.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(HERE, '../src/index.css');

/* ─────────────────────────  Өнгөний математик  ───────────────────────── */

/** `H S% L%` → sRGB [0..1, 0..1, 0..1] (CSS Color 4). */
function hslToRgb(h, s, l) {
  const S = s / 100;
  const L = l / 100;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** Gamma-кодлогдсон sRGB дотор alpha нийлүүлэлт (browser-тэй ижил). */
function composite(fg, bg, alpha) {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha));
}

function relativeLuminance([r, g, b]) {
  const lin = [r, g, b].map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(rgbA, rgbB) {
  const la = relativeLuminance(rgbA);
  const lb = relativeLuminance(rgbB);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/* ────────────────────────────  CSS задлалт  ──────────────────────────── */

/**
 * ЭРТ ХААГДСАН ТАЙЛБАР — CSS-ийн хамгийн аюултай чимээгүй алдаа.
 *
 * `/* … `bg-x/10` … *​/` гэж бичвэл дотор нь орсон од+налуу зураас нь
 * тайлбарыг ТЭНД хаана. Үлдсэн текст нь хогийн declaration болж,
 * парсер дараагийн `;` хүртэл алгасахдаа ЖИНХЭНЭ токенуудыг залгина.
 *
 * Яагаад энэ шалгалт заавал хэрэгтэй вэ: энэ алдаа бодитоор гарч,
 * `.light` scope-ийн эхний ~30 токен хүргэгдэх CSS-ээс алга болж,
 * гэрэл горим бүхэлдээ харанхуй утгаа хэрэглэж байсан. `tsc` ч,
 * `vite build` ч, ЭНЭ SCRIPT-ийн өмнөх хувилбар ч барьсангүй — учир нь
 * бүгд эх кодыг харж байсан бөгөөд declaration-ууд эх кодод бүрэн
 * байсан. Зөвхөн browser-т ачаалж үзэхэд илэрсэн.
 */
function assertNoEarlyClosedComments(css) {
  const lines = css.split(/\r?\n/);
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let j = 0;
    while (j < line.length) {
      if (!inComment) {
        const k = line.indexOf('/*', j);
        if (k < 0) break;
        inComment = true;
        j = k + 2;
      } else {
        const k = line.indexOf('*/', j);
        if (k < 0) break;
        // Жинхэнэ хаалт нь ` * /` хэлбэрээр зайтай ирдэг. Од нь үсэг,
        // тоо, backtick, зураасны ард шууд байвал энэ нь ЭРТ хаалт.
        if (k > 0 && /[A-Za-z0-9`\-\]]/.test(line[k - 1])) {
          console.error(
            `check:contrast — index.css:${i + 1}: ТАЙЛБАР ЭРТ ХААГДСАН\n` +
              `  ${line.trim()}\n` +
              `  Тайлбар доторх «од + налуу зураас» хослол тайлбарыг тэнд хаана.\n` +
              `  Дараагийн хэдэн арван токен хүргэгдэх CSS-ээс чимээгүй алга болно.\n` +
              `  Засвар: тайлбартаа тэр хослолыг бүү бич (үгээр тайлбарла).`,
          );
          process.exit(2);
        }
        inComment = false;
        j = k + 2;
      }
    }
  }
}

function stripComments(css) {
  assertNoEarlyClosedComments(css);
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Хаалтын гүнээр алхаж блок бүрийг { selector, body } болгож цуглуулна.
 * `@layer base { :root { … } }` гэх мэт үүрлэсэн бүтцийг нэвтэрч чадна.
 */
function parseBlocks(css) {
  const blocks = [];
  const stack = [];
  let boundary = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      stack.push({
        selector: css.slice(boundary, i).trim().replace(/\s+/g, ' '),
        bodyStart: i + 1,
      });
      boundary = i + 1;
    } else if (ch === '}') {
      const open = stack.pop();
      if (open) blocks.push({ selector: open.selector, body: css.slice(open.bodyStart, i) });
      boundary = i + 1;
    } else if (ch === ';') {
      boundary = i + 1;
    }
  }
  return blocks;
}

/** Үүрлэсэн `{…}`-г устгаж, зөвхөн тухайн блокийн шууд declaration-уудыг үлдээнэ. */
function directBody(body) {
  let s = body;
  let prev;
  do {
    prev = s;
    s = s.replace(/\{[^{}]*\}/g, '');
  } while (s !== prev);
  return s;
}

const HSL_DECL = /--([\w-]+)\s*:\s*(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*(?:;|$)/g;

/**
 * Блокуудыг гурван бодит scope болгон эвхнэ. Document order-оор давхарлана
 * (сүүлийнх нь хожино) — тиймээс `:root`/`.dark` нэгтгэсэн ч, тусад нь
 * байсан ч ижил үр дүн гарна. Энэ нь restructure-ийн өмнө/дараа хоёуланд
 * ажиллана гэсэн үг.
 */
function buildScopes(blocks) {
  const dark = new Map();
  const light = new Map();
  const client = new Map();
  const dim = new Map();
  const names = { dark: new Set(), light: new Set(), client: new Set(), dim: new Set() };

  const matchesAny = (selector, needles) =>
    selector
      .split(',')
      .map((s) => s.trim())
      .some((s) => needles.includes(s));

  for (const { selector, body } of blocks) {
    const isDark = matchesAny(selector, [':root', '.dark']);
    const isLight = matchesAny(selector, ['.light']);
    const isClient = matchesAny(selector, ['html.dark .client-dashboard-root']);
    // `.dim` (Дундаж) нь `:root`-оос өвлөж эхлээд дараа нь өөрийн 46 семантик
    // + 16 QTO токеноороо дардаг.  `:root` нь сэдвээс үл хамааран ҮРГЭЛЖ
    // таардаг тул суурийг эхэлж тавьж, дараа нь `.dim`-ээр дарна — эс бөгөөс
    // дарагдаагүй токен «алга» мэт харагдана.
    const isRoot = matchesAny(selector, [':root']);
    const isDim = matchesAny(selector, ['.dim']);
    if (!isDark && !isLight && !isClient && !isDim && !isRoot) continue;

    const decls = directBody(body);

    // HSL гурвал — өнгө шалгалт БА scope parity-д.
    // Parity нь зөвхөн ӨНГӨНИЙ токеныг хардаг: `--radius`,
    // `--app-bottom-nav-h`, `--apple-card-shadow` зэрэг нь зориудаар
    // нэг scope-д л тодорхойлогддог тул тэднийг оруулбал худал эерэг гарна.
    HSL_DECL.lastIndex = 0;
    let m;
    while ((m = HSL_DECL.exec(decls)) !== null) {
      const [, name, h, s, l] = m;
      const rgb = hslToRgb(Number(h), Number(s), Number(l));
      const raw = `${h} ${s}% ${l}%`;
      if (isDark) {
        dark.set(name, { rgb, raw });
        names.dark.add(name);
      }
      if (isLight) {
        light.set(name, { rgb, raw });
        // `.light` нь client-dashboard div дээр ч тавигддаг (ClientDashboardPage.tsx)
        client.set(name, { rgb, raw });
        names.light.add(name);
        names.client.add(name);
      }
      if (isClient) {
        client.set(name, { rgb, raw });
        names.client.add(name);
      }
      // Дундаж: эхлээд `:root`-ийн суурь (`.dark` БИШ — `<html class="dim">`
      // дээр `.dark` compound таарахгүй), дараа нь `.dim` өөрөө дарна.
      // Document order нь `:root` (301, 875) → `.dim` (538, 914) тул дараалал
      // зөв.
      if (isRoot) {
        dim.set(name, { rgb, raw });
        names.dim.add(name);
      }
      if (isDim) {
        dim.set(name, { rgb, raw });
        names.dim.add(name);
      }
    }
  }

  return { dark, light, client, dim, names };
}

/* ───────────────────────────  Шалгалтын хүснэгт  ─────────────────────── */

/** Хуудасны гадаргуу — `bg-X/10` өөрийн будалтыг эдгээр дээр шалгана. */
const PAGE_SURFACES = ['background', 'card', 'popover'];
/** Бэх токеныг унших боломжтой байх ёстой бүх гадаргуу. */
const ALL_SURFACES = [...PAGE_SURFACES, 'muted', 'secondary'];

/**
 * Scope тус бүрд ХАСАГДАХ гадаргуу.
 *
 * `dim` (Дундаж): `--secondary` нь энэ scope-д ЦАЙВАР дүүргэлт (L* 69.5),
 * учир нь index.css:514-ийн 1-р хязгаар — дэвсгэрээс бараан гадаргуу 3:1-ийг
 * ХЭЗЭЭ Ч давахгүй тул бүх дүүргэлт цайвар тал руугаа гарсан.  Цайвар
 * дүүргэлт дээр цайвар бэх тавих нь тодорхойлолтоороо уншигдахгүй — тийм
 * хослол ЗУРАГДДАГГҮЙ, `--secondary-foreground` (бараан, 6.62:1) л
 * зурагддаг.  Энэ нь хөх хувилбарт ч ижил байсан (`foreground` on
 * `secondary` = 2.42:1) — зүгээр л тэр үед `.dim` шалгагддаггүй байв.
 */
const SURFACE_SKIP = { dim: ['secondary'] };

/**
 * A. Тодорхойлогдсон гадаргуу/foreground хосууд.
 * Гурав дахь элемент нь заавал биш — тухайн хосыг АЛГАСАХ scope-ууд.
 */
const PAIRS = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  ['info-foreground', 'info'],
  ['danger-foreground', 'danger'],
  ['sidebar-foreground', 'sidebar-background'],
  ['sidebar-primary-foreground', 'sidebar-primary'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
  // Layout-ийн sidebar/header нь `bg-chrome` дээр muted текст гаргадаг.
  // Client Dashboard энэ хосыг ашигладаггүй — `bg-chrome` тэр файлд огт
  // байхгүй (өөрийн header дизайнтай), харин `--chrome` нь брэндийн
  // харанхуй утгаа хадгалдаг. Тиймээс client scope-д алгасана.
  ['muted-foreground', 'chrome', ['client']],
];

/** B. Бэх токен — бүх гадаргуу дээр + өөрийн /10 будалт дээр. Хатуу 4.5. */
const INK = [
  'foreground',
  'muted-foreground',
  'success',
  'warning',
  'info',
  'danger',
  'primary-ink',
  'destructive-ink',
];

/** C. Чимэглэл / текст бус (WCAG 1.4.11). Хатуу 3.0. */
const GRAPHIC = ['muted-subtle', 'ring', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'];

/**
 * D. Зөвхөн мэдээлэл — хэзээ ч унагаахгүй.
 * `primary`/`destructive` нь ЗАРИМДАА дүүргэлт (`bg-primary` — тэр хосыг A
 * шалгана), гэхдээ 374 / 188 газар БЭХ болж хэрэглэгдсэн. Тэр буруу
 * хэрэглээг `--primary-ink` / `--destructive-ink` + codemod засна; токен
 * өөрөө буруу биш тул энд зөвхөн харуулна.
 */
const SOFT = ['primary', 'destructive', 'border', 'input', 'sidebar-border', 'chrome-border'];

const MIN_TEXT = 4.5;
const MIN_GRAPHIC = 3.0;
const TINT_ALPHA = 0.1;

/* ──────────────────────────────  Гүйцэтгэл  ──────────────────────────── */

function runScope(scopeName, tokens, checks) {
  const get = (n) => tokens.get(n);

  const push = (kind, fg, bg, alpha, ratio, min) => {
    checks.push({
      scope: scopeName,
      kind,
      fg,
      bg,
      alpha,
      ratio: Number(ratio.toFixed(2)),
      min,
      status: kind === 'soft' ? 'info' : ratio >= min ? 'pass' : 'fail',
    });
  };

  const missing = [];

  // A — тодорхойлогдсон хосууд
  for (const [fgName, bgName, skipScopes] of PAIRS) {
    if (skipScopes?.includes(scopeName)) continue;
    const fg = get(fgName);
    const bg = get(bgName);
    if (!fg || !bg) {
      missing.push(`${fgName} / ${bgName}`);
      continue;
    }
    push('pair', fgName, bgName, 1, contrast(fg.rgb, bg.rgb), MIN_TEXT);
  }

  // B — бэх токен бүх гадаргуу дээр, дараа нь өөрийн /10 будалт дээр
  for (const inkName of INK) {
    const ink = get(inkName);
    if (!ink) {
      missing.push(inkName);
      continue;
    }
    for (const surfName of ALL_SURFACES) {
      if (SURFACE_SKIP[scopeName]?.includes(surfName)) continue;
      const surf = get(surfName);
      if (!surf) continue;
      push('ink', inkName, surfName, 1, contrast(ink.rgb, surf.rgb), MIN_TEXT);
    }
    // `bg-X/10 text-X` — status-colors.ts-ийн үндсэн badge хэв маяг
    if (!['foreground', 'muted-foreground'].includes(inkName)) {
      for (const surfName of PAGE_SURFACES) {
        const surf = get(surfName);
        if (!surf) continue;
        const tinted = composite(ink.rgb, surf.rgb, TINT_ALPHA);
        push('tint', inkName, `${surfName}+${inkName}/10`, TINT_ALPHA, contrast(ink.rgb, tinted), MIN_TEXT);
      }
    }
  }

  // C — чимэглэл
  for (const gName of GRAPHIC) {
    const g = get(gName);
    if (!g) {
      missing.push(gName);
      continue;
    }
    for (const surfName of PAGE_SURFACES) {
      const surf = get(surfName);
      if (!surf) continue;
      push('graphic', gName, surfName, 1, contrast(g.rgb, surf.rgb), MIN_GRAPHIC);
    }
  }

  // D — зөвхөн мэдээлэл
  for (const sName of SOFT) {
    const s = get(sName);
    const card = get('card');
    if (!s || !card) continue;
    push('soft', sName, 'card', 1, contrast(s.rgb, card.rgb), MIN_TEXT);
  }

  return missing;
}

async function main() {
  const argv = process.argv.slice(2);
  const verbose = argv.includes('--verbose');
  const asJson = argv.includes('--json');

  let css;
  try {
    css = await readFile(CSS_PATH, 'utf8');
  } catch (err) {
    console.error(`check:contrast — ${CSS_PATH} уншигдсангүй: ${err.message}`);
    process.exit(2);
  }

  const blocks = parseBlocks(stripComments(css));
  const { dark, light, client, dim, names } = buildScopes(blocks);

  for (const [name, map] of [
    ['dark', dark],
    ['light', light],
    ['client', client],
    ['dim', dim],
  ]) {
    if (map.size === 0) {
      console.error(
        `check:contrast — «${name}» scope хоосон гарлаа. index.css-ийн selector-ууд ` +
          `өөрчлөгдсөн байж магадгүй (:root / .dark / .light / .dim / html.dark .client-dashboard-root). ` +
          `Script чимээгүй PASS болохоос сэргийлж зогслоо.`,
      );
      process.exit(2);
    }
  }

  const checks = [];
  const missing = {
    dark: runScope('dark', dark, checks),
    light: runScope('light', light, checks),
    client: runScope('client', client, checks),
    dim: runScope('dim', dim, checks),
  };

  // E — scope parity: drift-ийг барих цорын ганц шалгалт
  const parity = [];
  const darkOnly = [...names.dark].filter((n) => !names.light.has(n));
  const lightOnly = [...names.light].filter((n) => !names.dark.has(n));
  for (const n of darkOnly) parity.push(`--${n}: dark-д байна, light-д АЛГА`);
  for (const n of lightOnly) parity.push(`--${n}: light-д байна, dark-д АЛГА`);
  for (const n of names.light) {
    if (!names.client.has(n)) parity.push(`--${n}: light-д байна, client scope-д АЛГА`);
  }
  // Дундаж нь `:root`-оос өвлөдөг тул «алга» гэдэг нь ҮРГЭЛЖ ХӨХ утга
  // чимээгүй үлдсэн гэсэн үг — parity-д заавал орно.
  for (const n of names.dark) {
    if (!names.dim.has(n)) parity.push(`--${n}: dark-д байна, dim-д АЛГА`);
  }

  const failures = checks.filter((c) => c.status === 'fail');

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok: failures.length === 0 && parity.length === 0,
          scopes: { dark: dark.size, light: light.size, client: client.size, dim: dim.size },
          missing,
          parity,
          checks,
        },
        null,
        2,
      ),
    );
  } else {
    const rel = CSS_PATH.replace(/\\/g, '/').replace(/^.*\/frontend\//, 'frontend/');
    console.log(`check:contrast  ·  ${rel}`);
    console.log(
      `scopes: dark (${dark.size} токен) · light (${light.size}) · client (${client.size})` +
        ` · dim (${dim.size})\n`,
    );

    const shown = verbose ? checks : checks.filter((c) => c.status !== 'pass');
    if (shown.length) {
      console.log('  scope   ratio   min    pair');
      console.log('  ' + '─'.repeat(72));
      for (const c of shown) {
        const tag =
          c.status === 'fail' ? 'FAIL' : c.status === 'info' ? 'info' : 'ok  ';
        const alpha = c.alpha === 1 ? '' : ` (α=${c.alpha})`;
        console.log(
          `  ${tag.padEnd(6)}${c.scope.padEnd(8)}${String(c.ratio).padStart(5)}  ` +
            `${String(c.min).padStart(4)}   --${c.fg}  on  --${c.bg}${alpha}`,
        );
      }
      console.log('');
    }

    for (const [scope, list] of Object.entries(missing)) {
      const uniq = [...new Set(list)];
      if (uniq.length) console.log(`  note  ${scope}: тодорхойлогдоогүй токен → ${uniq.join(', ')}`);
    }
    if (parity.length) {
      console.log('\n  SCOPE PARITY ЗӨРЧИЛ:');
      for (const p of parity) console.log(`    ${p}`);
    }

    const passCount = checks.filter((c) => c.status === 'pass').length;
    const infoCount = checks.filter((c) => c.status === 'info').length;
    console.log(
      `\n  ${checks.length} шалгалт · ${passCount} тэнцсэн · ${failures.length} унасан · ${infoCount} мэдээлэл`,
    );
  }

  process.exit(failures.length > 0 || parity.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`check:contrast — гэнэтийн алдаа: ${err.stack ?? err.message}`);
  process.exit(2);
});
