#!/usr/bin/env node
/**
 * gen-system-catalog — СИСТЕМИЙН КАТАЛОГ үүсгэнэ (MGL AI §15).
 *
 *   node scripts/gen-system-catalog.mjs           # src/lib/mglai/systemCatalog.generated.ts бичнэ
 *   node scripts/gen-system-catalog.mjs --check   # хуучирсан бол exit 1 (тест ашиглана)
 *
 * ⚠️ ЯАГААД ҮҮСГЭДЭГ ВЭ.  «Манай сайт юу агуулдаг вэ» гэсэн асуултад
 *    загвар САНАХУЙГААС хариулж («хувьцааны мэдээлэл, мөнгөний төлбөр…»
 *    гэж ЗОХИОСОН — хэмжигдсэн 2026-09-10) байв.  Эх сурвалж нь frontend-ийн
 *    `Layout.tsx` NAV_ITEMS (хуудас + роль) ба `sections.ts` APP_SECTIONS
 *    (хуудас доторх хэсгүүд, синоним).  Worker нь frontend файл импортолж
 *    чадахгүй тул ЭНД нэг удаа уншиж, TS модуль болгон бичнэ.
 *
 * ⚠️ ГАРААР ЗАСАХГҮЙ — `--check` тест нь зөрүүг барина.  Цэс өөрчлөгдвөл
 *    энэ скриптийг дахин ажиллуулна.
 *
 * Парсер нь `frontend/scripts/nav-matrix.mjs`-ийн ижил арга: TSX-ийг
 * regex-ээр уншина (NAV_ITEMS нь тогтмол хэлбэртэй литерал).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONT = resolve(HERE, '../../frontend/src');
const LAYOUT = resolve(FRONT, 'shared/components/Layout.tsx');
const SECTIONS = resolve(FRONT, 'shared/lib/search/sections.ts');
const MN = resolve(FRONT, 'shared/i18n/mn.json');
const EN = resolve(FRONT, 'shared/i18n/en.json');
const OUT = resolve(HERE, '../src/lib/mglai/systemCatalog.generated.ts');

const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const stripBom = (s) => s.replace(/^﻿/, '');

function sliceBlock(src, startRe) {
  const i = src.search(startRe);
  if (i < 0) return null;
  const eq = src.indexOf('=', i);
  const open = src.indexOf('[', eq);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '[') depth++;
    else if (src[j] === ']' && --depth === 0) return src.slice(open, j + 1);
  }
  return null;
}

const layout = stripComments(await readFile(LAYOUT, 'utf8'));
const sectionsSrc = stripComments(await readFile(SECTIONS, 'utf8'));
const mn = JSON.parse(stripBom(await readFile(MN, 'utf8')));
const en = JSON.parse(stripBom(await readFile(EN, 'utf8')));
const t = (dict, k) => (typeof dict[k] === 'string' ? dict[k] : null);

const itemsBlock = sliceBlock(layout, /const NAV_ITEMS\s*:/);
if (!itemsBlock) {
  console.error('gen-system-catalog: NAV_ITEMS олдсонгүй.');
  process.exit(2);
}

const pages = [];
for (const m of itemsBlock.matchAll(/\{\s*\n\s*to:/g)) {
  let depth = 0;
  for (let j = m.index; j < itemsBlock.length; j++) {
    if (itemsBlock[j] === '{') depth++;
    else if (itemsBlock[j] === '}' && --depth === 0) {
      const body = itemsBlock.slice(m.index, j + 1);
      const to = /to:\s*'([^']+)'/.exec(body)?.[1];
      const labelKey = /labelKey:\s*'([^']+)'/.exec(body)?.[1];
      const group = /group:\s*'([^']+)'/.exec(body)?.[1] ?? null;
      const roles = [...(/roles:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((r) => r[1]);
      const kidsBlock = /children:\s*\[([\s\S]*?)\]\s*,?\s*\}$/.exec(body)?.[1] ?? '';
      const children = [...kidsBlock.matchAll(/\{[^}]*to:\s*'([^']+)'[^}]*labelKey:\s*'([^']+)'[^}]*\}/g)]
        .map((c) => {
          const cr = [...(/roles:\s*\[([^\]]*)\]/.exec(c[0])?.[1] ?? '').matchAll(/'([^']+)'/g)].map((r) => r[1]);
          return { to: c[1], labelMn: t(mn, c[2]) ?? c[2], labelEn: t(en, c[2]) ?? c[2], roles: cr.length ? cr : null };
        })
        .filter((c) => c.to !== to);
      // Серверийн эрхээр хаагдсан мөр (`capability`, ж. «Програмын хүсэлтүүд» = баталгаажсан Software
      // Engineer л) — MGL AI-ийн `describe_system` зөвхөн role-оор шүүдэг тул энд ОРУУЛАХГҮЙ: эс бөгөөс
      // эрхгүй admin/engineer-т тэр хуудсыг сурталчилна.
      if (/capability:\s*'/.test(body)) break;
      if (to && labelKey) {
        pages.push({
          path: to,
          labelMn: t(mn, labelKey) ?? labelKey,
          labelEn: t(en, labelKey) ?? labelKey,
          group,
          roles,
          children,
          sections: [],
        });
      }
      break;
    }
  }
}

// ── Хуудас доторх хэсгүүд ──────────────────────────────────────────
const secBlock = sliceBlock(sectionsSrc, /export const APP_SECTIONS\s*:/);
const sections = [];
if (secBlock) {
  for (const m of secBlock.matchAll(/\{\s*page:\s*'([^']+)'[\s\S]*?\}/g)) {
    const body = m[0];
    const page = m[1];
    const to = /to:\s*'([^']+)'/.exec(body)?.[1];
    const labelKey = /labelKey:\s*'([^']+)'/.exec(body)?.[1];
    const keywords = /keywords:\s*'([^']*)'/.exec(body)?.[1] ?? '';
    const roles = [...(/roles:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((r) => r[1]);
    if (page && to && labelKey) sections.push({ page, to, labelMn: t(mn, labelKey) ?? labelKey, labelEn: t(en, labelKey) ?? labelKey, keywords, roles: roles.length ? roles : null });
  }
}
for (const s of sections) {
  const page = pages.find((p) => p.path === s.page) ?? pages.find((p) => p.children.some((c) => c.to === s.page));
  if (page) {
    const { page: _p, ...rest } = s;
    page.sections.push(rest);
  }
}

const orphanSections = sections.filter((s) => !pages.some((p) => p.path === s.page || p.children.some((c) => c.to === s.page)));

const header = `/**
 * ⚠️ ҮҮСГЭСЭН ФАЙЛ — ГАРААР ЗАСАХГҮЙ.
 *    \`node scripts/gen-system-catalog.mjs\` (backend/) дахин ажиллуулна.
 *    Эх сурвалж: frontend Layout.tsx NAV_ITEMS + search/sections.ts + i18n.
 *    \`systemCatalog.test.ts\` нь \`--check\`-ээр зөрүүг барина.
 */
export interface SystemPageSection {
  to: string;
  labelMn: string;
  labelEn: string;
  keywords: string;
  roles: readonly string[] | null;
}
export interface SystemPageChild {
  to: string;
  labelMn: string;
  labelEn: string;
  roles: readonly string[] | null;
}
export interface SystemPage {
  path: string;
  labelMn: string;
  labelEn: string;
  group: string | null;
  /** Цэсэнд ХАРАГДАХ роль — \`Layout.tsx\`-ийн ЯГ жагсаалт. */
  roles: readonly string[];
  children: readonly SystemPageChild[];
  sections: readonly SystemPageSection[];
}

export const SYSTEM_PAGES: readonly SystemPage[] = `;

const body = `${header}${JSON.stringify(pages, null, 2)} as const;

/** Цэсэнд ороогүй ч бүртгэлтэй хэсгүүд (профайл гэх мэт). */
export const SYSTEM_ORPHAN_SECTIONS: readonly SystemPageSection[] = ${JSON.stringify(
  orphanSections.map(({ page: _p, ...rest }) => rest),
  null,
  2,
)} as const;
`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = await readFile(OUT, 'utf8');
  } catch {
    /* байхгүй */
  }
  if (current.replace(/\r\n/g, '\n') !== body.replace(/\r\n/g, '\n')) {
    console.error('gen-system-catalog: systemCatalog.generated.ts ХУУЧИРСАН — `node scripts/gen-system-catalog.mjs` ажиллуул.');
    process.exit(1);
  }
  console.log(`gen-system-catalog: шинэ (${pages.length} хуудас, ${sections.length} хэсэг).`);
  process.exit(0);
}

await writeFile(OUT, body, 'utf8');
console.log(`gen-system-catalog: ${pages.length} хуудас, ${sections.length} хэсэг (${orphanSections.length} цэсгүй) → ${OUT}`);
