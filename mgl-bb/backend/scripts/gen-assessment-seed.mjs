#!/usr/bin/env node
// scripts/assessments/architect-v1.json → migrations/0138_assessment_seed_architect.sql үүсгэнэ.
//
//   node scripts/gen-assessment-seed.mjs
//
// Асуулгын схем (AssessmentSchema) нь КОДОНД БИШ, DB-д JSON-оор амьдардаг
// (assessment_templates.schema_json — docs/dev/assessments-spec.md §4/§5).
// Эх JSON нь хүн засварладаг цорын ганц эх сурвалж; SQL нь түүний ҮҮСМЭЛ,
// тул .sql-ийг ГАРААР БҮҮ ЗАСВАРЛА — JSON-оо зассаны дараа энэ script-ээ
// дахин ажиллуулж, гарсан migration-ыг commit хий.
//
// Схем нь нэг statement-д багтдаг (~55KB) тул resources seed шиг chunk хийх
// шаардлагагүй.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, 'assessments', 'architect-v1.json');
const outPath = join(here, '..', 'migrations', '0140_assessment_seed_architect.sql');

// Гараар барьсан толгойн мэдээлэл — цагийн машинаас БИШ (Date.now() хэрэглэвэл
// дахин ажиллуулах бүрд файл өөрчлөгдөж git-д хий чимээ гаргана).
// Схемээ шинэчлээд seed-ээ ДАХИН үүсгэвэл энэ огноог гараар шинэчил.
const GENERATED_ON = '2026-08-05';

// code нь ТОМ үсгээр: POST/PUT /api/assessments/templates нь ирсэн код бүрийг
// `.toUpperCase()` хийдэг (routes/assessments.ts).  Seed нь route-ыг тойрч
// шууд DB-д ордог тул хэлбэрийг нь гараар тааруулж өгөхгүй бол админ UI-аас
// нэг удаа хадгалахад код өөрчлөгдөж, хоёр өөр мөр үүсэх эрсдэлтэй.
const TEMPLATE = {
  code: 'ARCHITECT_SKILLS_V1',
  title_mn: 'Архитекторын ур чадвар ба зан чанарын үнэлгээ',
  title_en: 'Architect Skills & Behavior Assessment',
  status: 'active',
};

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

// --- Тоолол + эрүүл мэндийн шалгалт ------------------------------------
// (Асуулга нь DB-д ЖИНХЭНЭ өгөгдөл болж очих тул seed-ийн өмнө барина.)

if (schema.version !== 1) throw new Error(`schema.version 1 байх ёстой, ${schema.version} байна`);
if (!Array.isArray(schema.scales) || schema.scales.length === 0) throw new Error('scales[] хоосон байна');
if (!Array.isArray(schema.levels) || schema.levels.length === 0) throw new Error('levels[] хоосон байна');
if (!Array.isArray(schema.parts) || schema.parts.length === 0) throw new Error('parts[] хоосон байна');

const scaleIds = new Set(schema.scales.map((s) => s.id));
const itemIds = new Set();
const stats = [];
let itemTotal = 0;
let sectionTotal = 0;

for (const part of schema.parts) {
  if (!scaleIds.has(part.scaleId)) throw new Error(`part '${part.id}': үл мэдэгдэх scaleId '${part.scaleId}'`);
  let partItems = 0;
  let weightSum = 0;
  for (const section of part.sections) {
    let sectionItems = 0;
    for (const group of section.groups) {
      for (const item of group.items) {
        if (itemIds.has(item.id)) throw new Error(`item id давхардлаа: '${item.id}'`);
        if (!item.id.startsWith(`${group.id}-`)) {
          throw new Error(`item '${item.id}' нь group '${group.id}'-ийн нэрийн конвенцод нийцэхгүй`);
        }
        if (typeof item.text !== 'string' || !item.text.trim()) throw new Error(`item '${item.id}': text хоосон`);
        itemIds.add(item.id);
        sectionItems += 1;
      }
    }
    if (sectionItems === 0) throw new Error(`section '${section.id}': мөр байхгүй`);
    weightSum += section.weight;
    partItems += sectionItems;
    sectionTotal += 1;
    stats.push({ part: part.id, section: section.id, code: section.code, weight: section.weight, items: sectionItems });
  }
  // Жин нь зөвхөн weighted part-д утгатай; нийлбэр 100 байх ёстой (§1).
  if (part.weighted && weightSum !== 100) {
    throw new Error(`part '${part.id}': жингийн нийлбэр 100 биш, ${weightSum} байна`);
  }
  itemTotal += partItems;
}

const description =
  `${schema.parts.length} хэсэг · ${sectionTotal} бүлэг · ${itemTotal} мөр. ` +
  schema.parts.map((p) => `${p.title} (${p.sections.length} бүлэг)`).join('; ') + '.';

// --- SQL --------------------------------------------------------------

const q = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const schemaJson = JSON.stringify(schema); // НЯГТ — indent-гүй

const header = `-- Архитекторын үнэлгээний загварын seed — scripts/gen-assessment-seed.mjs-ээр
-- ҮҮСГЭСЭН (${GENERATED_ON}), ГАРААР БҮҮ ЗАСВАРЛА.
--
-- Эх сурвалж : backend/scripts/assessments/architect-v1.json
--              (${schema.parts.length} хэсэг, ${sectionTotal} бүлэг, ${itemTotal} мөр)
-- Дахин үүсгэх: backend/ дотроос  node scripts/gen-assessment-seed.mjs
--
-- Асуулгын бүтэц бүхэлдээ schema_json дотор (AssessmentSchema — types.ts /
-- backend/src/lib/assessmentSchema.ts).  Асуулга өөрчлөх = JSON-оо зассаны
-- дараа ШИНЭ seed migration нэмэх (append-only дүрэм), энэ файлыг засах биш.
--
-- ⚠️ ЗОРИУДААР \`ON CONFLICT(code) DO UPDATE\`, \`INSERT OR REPLACE\` БИШ.
--    INSERT OR REPLACE нь давхцсан мөрийг УСТГААД шинэ id-тай дахин оруулдаг.
--    assessment_rounds.template_id нь ON DELETE CASCADE тул тэр устгалт нь
--    тухайн загварын БҮХ round + response-ыг дагуулж устгана.  DO UPDATE нь
--    мөрийн id-г хадгалдаг тул энэ файлыг хэд ч удаа ажиллуулж болно.

`;

// Мөрийн id хадгалагдана → cascade үүсэхгүй → дахин ажиллуулахад аюулгүй.
const sql = `INSERT INTO assessment_templates
  (code, title_mn, title_en, description, schema_json, status)
VALUES (
  ${q(TEMPLATE.code)},
  ${q(TEMPLATE.title_mn)},
  ${q(TEMPLATE.title_en)},
  ${q(description)},
  ${q(schemaJson)},
  ${q(TEMPLATE.status)}
)
ON CONFLICT(code) DO UPDATE SET
  title_mn    = excluded.title_mn,
  title_en    = excluded.title_en,
  description = excluded.description,
  schema_json = excluded.schema_json,
  status      = excluded.status,
  updated_at  = datetime('now');
`;

writeFileSync(outPath, header + sql, 'utf8');

for (const s of stats) {
  console.log(`  ${s.part.padEnd(8)} ${s.section.padEnd(5)} ${s.code.padEnd(24)} weight=${String(s.weight).padStart(3)}  мөр=${s.items}`);
}
console.log(
  `OK: ${outPath} — ${sectionTotal} бүлэг, ${itemTotal} мөр, schema_json ${schemaJson.length} тэмдэгт`,
);
