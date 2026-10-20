#!/usr/bin/env node
/**
 * nav-matrix — sidebar-ийн цэс роль бүрт ЯГ ЮУ харуулахыг хэвлэнэ.
 *
 * Яагаад хэрэгтэй вэ?  Энэ репод frontend-ийн тест БАЙХГҮЙ.  Цэс нь 19 мөр ×
 * 6 роль × 2 hardcode (CEO id 2, эзэмшигч id 1) тул гараар шалгах боломжгүй
 * хэмжээ бөгөөд ролийн шүүлт эвдэрсэн ч build ч, lint ч УНАХГҮЙ.  Өөрчлөлт
 * хийхийн ӨМНӨ болон ДАРАА ажиллуулж гаралтыг тулгавал «CEO-гийн Миний
 * даалгавар алга болов», «senior-т шинэ мөр нээгдэв» гэх мэт чимээгүй
 * доройтлыг шууд барина.
 *
 *   node scripts/nav-matrix.mjs           # хүн уншихад
 *   node scripts/nav-matrix.mjs --json    # тулгахад (diff-д ээлтэй)
 *
 * Гуравдагч сан ХЭРЭГЛЭХГҮЙ — `check-contrast.mjs`-ийн адил эх файлыг
 * regex-ээр уншина.  TSX-ийг бүрэн парслах шаардлагагүй: NAV_ITEMS нь
 * тогтмол хэлбэртэй литерал массив.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const LAYOUT = resolve(HERE, '../src/shared/components/Layout.tsx');
const MN = resolve(HERE, '../src/shared/i18n/mn.json');

/** Тайлбар мөрийг хасна — тайлбар дотор байгаа цэсийг (Landing CMS) тоохгүй. */
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

function sliceBlock(src, startRe) {
  const i = src.search(startRe);
  if (i < 0) return null;
  // ⚠ Эхний `[`-г шууд авч болохгүй: `const NAV_ITEMS: NavItem[] = [` дэх
  //   ТӨРЛИЙН `[]` нь массивын литералаас ӨМНӨ таарна.  Тиймээс эхлээд
  //   оноолтын `=`-ыг олж, ТҮҮНЭЭС ХОЙШ хайна.
  const eq = src.indexOf('=', i);
  if (eq < 0) return null;
  const open = src.indexOf('[', eq);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '[') depth++;
    else if (src[j] === ']' && --depth === 0) return src.slice(open, j + 1);
  }
  return null;
}

const src = stripComments(await readFile(LAYOUT, 'utf8'));
// ⚠️ `mn.json` нь UTF-8 BOM-той (git HEAD-д ч мөн адил).  BOM-ыг хасахгүй
// бол `JSON.parse` шууд унана — энэ скрипт удаан хугацаанд ажиллахгүй байсан.
const dict = JSON.parse((await readFile(MN, 'utf8')).replace(/^﻿/, ''));
const label = (k) => dict[k] ?? `⟨${k}⟩`;

const itemsBlock = sliceBlock(src, /const NAV_ITEMS\s*:/);
const groupsBlock = sliceBlock(src, /const NAV_GROUPS\s*:/);
if (!itemsBlock || !groupsBlock) {
  console.error(
    'nav-matrix: NAV_ITEMS эсвэл NAV_GROUPS олдсонгүй — Layout.tsx-ийн бүтэц өөрчлөгдсөн үү?',
  );
  process.exit(2);
}

// Бүлгийн дараалал + гарчиг
const groups = [
  ...groupsBlock.matchAll(/key:\s*'([^']+)'\s*,\s*labelKey:\s*(null|'([^']+)')/g),
].map((m) => ({ key: m[1], labelKey: m[3] ?? null }));

// Цэсний мөрүүд — объект бүрийг тэнцвэрт хаалтаар тасална
const items = [];
for (const m of itemsBlock.matchAll(/\{\s*\n\s*to:/g)) {
  let depth = 0;
  const start = m.index;
  for (let j = start; j < itemsBlock.length; j++) {
    if (itemsBlock[j] === '{') depth++;
    else if (itemsBlock[j] === '}' && --depth === 0) {
      const body = itemsBlock.slice(start, j + 1);
      const to = /to:\s*'([^']+)'/.exec(body)?.[1];
      const labelKey = /labelKey:\s*'([^']+)'/.exec(body)?.[1];
      // admin/senior БУС ролид харагдах нэр (жишээ нь «Багууд» → «Баг»).
      const ownScopeLabelKey = /ownScopeLabelKey:\s*'([^']+)'/.exec(body)?.[1];
      const group = /group:\s*'([^']+)'/.exec(body)?.[1];
      // Серверийн эрх (role-оос гадна) — жишээ нь `engineering_feedback_reviewer`.
      const capability = /capability:\s*'([^']+)'/.exec(body)?.[1] ?? null;
      const roles = [...(/roles:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
        (r) => r[1],
      );
      const kidsBlock = /children:\s*\[([\s\S]*?)\]\s*,?\s*\}$/.exec(body)?.[1] ?? '';
      const children = [
        ...kidsBlock.matchAll(/\{[^}]*to:\s*'([^']+)'[^}]*labelKey:\s*'([^']+)'[^}]*\}/g),
      ].map((c) => {
        const seg = c[0];
        const cr = [...(/roles:\s*\[([^\]]*)\]/.exec(seg)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
          (r) => r[1],
        );
        return { to: c[1], labelKey: c[2], roles: cr.length ? cr : null };
      });
      if (to && labelKey && group) items.push({ to, labelKey, ownScopeLabelKey, roles, group, children, capability });
      break;
    }
  }
}

/** Layout.tsx-ийн `visibleItems`-ийг ЯГ давтана (hardcode-ууд орсон).
 *  `caps` = серверийн баталсан эрхүүд (`capability` мөрүүд — ачаалж байхад хоосон = нуугдана). */
function visibleFor(role, id, caps = []) {
  return items.filter((it) => {
    if (it.to === '/app/my-tasks' && id === 2) return true; // CEO — lib/ceo.ts
    if (!it.roles.includes(role)) return false;
    if (it.to === '/app/revit-addin' && id !== 1) return false; // эзэмшигч
    if (it.capability && !caps.includes(it.capability)) return false; // серверийн эрх
    return true;
  });
}
const childrenFor = (it, role) => it.children.filter((c) => !c.roles || c.roles.includes(role));

const PERSONAS = [
  { name: 'admin', role: 'admin', id: 99 },
  { name: 'admin (эзэмшигч id 1)', role: 'admin', id: 1 },
  { name: 'CEO (admin id 2)', role: 'admin', id: 2 },
  { name: 'senior', role: 'senior', id: 99 },
  { name: 'engineer', role: 'engineer', id: 99 },
  { name: 'architect', role: 'architect', id: 99 },
  // Баталгаажсан Software Engineer reviewer (Өсөхбаяр) — серверийн `can_review` эрхтэй.
  { name: 'reviewer (Software Engineer)', role: 'engineer', id: 75, caps: ['engineering_feedback_reviewer'] },
  { name: 'worker', role: 'worker', id: 99 },
  { name: 'client', role: 'client', id: 99 },
];

const result = {};
for (const p of PERSONAS) {
  const vis = visibleFor(p.role, p.id, p.caps ?? []);
  const byGroup = groups
    .map((g) => ({
      group: g.key,
      title: g.labelKey ? label(g.labelKey) : '(гарчиггүй)',
      rows: vis
        .filter((i) => i.group === g.key)
        .map((i) => {
          const kids = childrenFor(i, p.role);
          const sub = kids.filter((c) => c.to !== i.to).map((c) => label(c.labelKey));
          const own = i.ownScopeLabelKey && p.role !== 'admin' && p.role !== 'senior';
          const name = label(own ? i.ownScopeLabelKey : i.labelKey);
          return sub.length ? `${name} ▸ ${sub.join(' · ')}` : name;
        }),
    }))
    .filter((g) => g.rows.length > 0);
  result[p.name] = { total: vis.length, groups: byGroup };
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log(`nav-matrix  ·  ${items.length} цэсний мөр · ${groups.length} бүлэг\n`);
for (const [name, r] of Object.entries(result)) {
  console.log(`${'─'.repeat(64)}\n${name}  —  ${r.total} мөр`);
  for (const g of r.groups) {
    console.log(`  ${g.title}`);
    for (const row of g.rows) console.log(`    · ${row}`);
  }
  console.log();
}
