-- ============================================================
-- BD 81-16-20-shaped starter template for the price-quote wizard
-- ------------------------------------------------------------
-- Repopulates quote_templates(id=1) with realistic Mongolian
-- design-work pricing structure inspired by the official
-- Construction Rule "Зураг төслийн ажлын жишиг үнэ" (БД 81-16-20)
-- approved by the Construction & Urban Development minister's
-- order #108 of 2020-06-10.
--
-- Demo coverage:
--   * complexity_choice — 4 tiers (I-IV), each scales total ×
--   * area_input        — total m², feeds line_item qty
--   * line_item × 4     — arch / struct / MEP / site, all
--                         inheriting qty from area
--   * multiplier_toggle × 5 — ТЭЗҮ, гадаад хамтрал, орчуулга,
--                             хүндрэлтэй талбар, 3D рендер
--
-- Idempotent: deletes existing sections (cascades to items)
-- before reseeding. Safe to re-run.
--
-- Run:
--   cd backend
--   npx wrangler d1 execute "$(node scripts/wranglerNames.mjs databaseName)" --remote \
--     --file=./scripts/seed-bd81-quote-template.sql
-- ============================================================

-- 1. Top-level template settings.
UPDATE quote_templates
   SET name = 'Зураг төслийн жишиг үнэ (БД 81-16-20)',
       description = 'Барилгын зураг төсөл боловсруулах ажлын урьдчилсан үнэлгээ. Барилга, хот байгуулалтын сайдын 2020 оны 108 дугаар тушаалаар батлагдсан БД 81-16-20 дүрэмд үндэслэв.',
       currency = 'MNT',
       validity_days = 30,
       locale = 'mn',
       intro_md = 'Энэхүү тооцоо нь барилгын зураг төсөл боловсруулах ажлын үнэлгээний урьдчилсан, чиглүүлэх шинж чанартай. Эцсийн үнэ нь талуудын гэрээгээр баталгаажна. Үндсэн томьёо: (нэгж × хувийн талбай) × төвөгшил × нэмэлт нөхцлүүд.',
       terms_md = '* Үнэ нь Улаанбаатар хотын ердийн нөхцөлд (газар хөдлөлийн 7 балл, өрсөн хөрс) тооцсон.\n* Хэрэглээний үнийн ерөнхий индекс 1.55-ыг тооцсон. Эх сурвалж: БД 81-16-20.\n* Эцсийн үнэд НӨАТ-ыг тус тусад нь нэмэх боломжтой.',
       is_active = 1,
       updated_at = datetime('now')
 WHERE id = 1;

-- 2. Wipe existing structure (cascade deletes items).
DELETE FROM quote_template_sections WHERE template_id = 1;

-- 3. Section 1 — Complexity.
INSERT INTO quote_template_sections (template_id, position, title, description) VALUES
  (1, 10, 'Барилгын төвөгшил', 'Барилгын зориулалт, хүчин чадал, давхрын тоо зэргээс хамаарч ангилна. Энэ нь нийт үнийн үндсэн итгэлцүүрийг тодорхойлно.');

INSERT INTO quote_template_items (section_id, position, label, field_type, config_json, required) VALUES
  ((SELECT id FROM quote_template_sections WHERE template_id=1 AND position=10),
   10,
   'Төвөгшлийн ангилал',
   'complexity_choice',
   '{"options":[{"value":"I","label":"I — Бага","description":"Хувийн орон сууц, гараж, жижиг агуулах, 2 давхар хүртэлх энгийн барилга.","multiplier":1.0},{"value":"II","label":"II — Дунд","description":"Олон давхар орон сууц, нийтийн жижиг барилга (сургууль, амралт, үйлчилгээ), 5-9 давхар.","multiplier":1.2},{"value":"III","label":"III — Өндөр","description":"Олон нийтийн томоохон, эмнэлэг, олимп, үйлдвэрийн барилга, 10-25 давхар.","multiplier":1.5},{"value":"IV","label":"IV — Онцгой","description":"Тусгай зориулалттай, төрийн чухал, өндөр давхрын барилга, нисэх онгоцны буудал, метро, чөлөөт бүс.","multiplier":1.8}]}',
   1);

-- 4. Section 2 — Building basics (area + type select).
INSERT INTO quote_template_sections (template_id, position, title, description) VALUES
  (1, 20, 'Барилгын ерөнхий үзүүлэлт', 'Талбайн хэмжээг бичих ба үндсэн зориулалтыг сонгоно. Талбай нь дараах үе шатуудын нэгж тоо хэмжээний үндэс болно.');

INSERT INTO quote_template_items (section_id, position, label, field_type, config_json, required) VALUES
  ((SELECT id FROM quote_template_sections WHERE template_id=1 AND position=20),
   10,
   'Нийт талбай',
   'area_input',
   '{"unit":"м²","min":10,"max":100000,"hint":"Барилгын нийт ашиглалтын талбайг бичнэ үү."}',
   1);

INSERT INTO quote_template_items (section_id, position, label, field_type, config_json, required) VALUES
  ((SELECT id FROM quote_template_sections WHERE template_id=1 AND position=20),
   20,
   'Барилгын төрөл',
   'select',
   '{"options":[{"value":"residential","label":"Орон сууцны"},{"value":"public","label":"Олон нийтийн"},{"value":"industrial","label":"Үйлдвэрийн"},{"value":"office","label":"Алба-захиргааны"},{"value":"mixed","label":"Холимог зориулалттай"}],"hint":"Үндсэн зориулалтыг сонгоно уу."}',
   0);

-- 5. Section 3 — Design stages (line_items with qty_from_area=true).
INSERT INTO quote_template_sections (template_id, position, title, description) VALUES
  (1, 30, 'Зураг төслийн үе шат', 'Барилгын зураг төслийг бүрэн боловсруулах үндсэн дөрвөн үе шат. Тоо нь дээрх талбайгаас автомат тооцоологдоно.');

INSERT INTO quote_template_items (section_id, position, label, field_type, config_json, required) VALUES
  ((SELECT id FROM quote_template_sections WHERE template_id=1 AND position=30),
   10,
   'Архитектур төлөвлөлт',
   'line_item',
   '{"unit":"м²","default_unit_price":12000,"qty_from_area":true,"hint":"Эх загвар зураг, ажлын зургийн архитектурын хэсэг."}',
   0);

INSERT INTO quote_template_items (section_id, position, label, field_type, config_json, required) VALUES
  ((SELECT id FROM quote_template_sections WHERE template_id=1 AND position=30),
   20,
   'Барилгын бүтээц',
   'line_item',
   '{"unit":"м²","default_unit_price":9000,"qty_from_area":true,"hint":"Суурь, баганы тооцоо, хийц, бүтээцийн зураг."}',
   0);

INSERT INTO quote_template_items (section_id, position, label, field_type, config_json, required) VALUES
  ((SELECT id FROM quote_template_sections WHERE template_id=1 AND position=30),
   30,
   'Инженерийн хангамж (УЦК, дулаан, цахилгаан, холбоо)',
   'line_item',
   '{"unit":"м²","default_unit_price":9000,"qty_from_area":true,"hint":"Дотор инженерийн шугам сүлжээний зураг төсөл."}',
   0);

INSERT INTO quote_template_items (section_id, position, label, field_type, config_json, required) VALUES
  ((SELECT id FROM quote_template_sections WHERE template_id=1 AND position=30),
   40,
   'Гадна тохижилт ба газар зохион байгуулалт',
   'line_item',
   '{"unit":"м²","default_unit_price":3000,"qty_from_area":true,"hint":"Гадна тохижилт, авто зам, ногоон байгууламжийн хэсэг."}',
   0);

-- 6. Section 4 — Multiplier toggles (BD 81-16-20 §2-3 references).
INSERT INTO quote_template_sections (template_id, position, title, description) VALUES
  (1, 40, 'Нэмэлт нөхцөл', 'Энд тэмдэглэгдсэн нөхцөл тус бүр нийт дүнг үржүүлэн нэмнэ. БД 81-16-20 дүрмийн §2-3-д заасан стандарт нэмэгдлүүд.');

INSERT INTO quote_template_items (section_id, position, label, field_type, config_json, required) VALUES
  ((SELECT id FROM quote_template_sections WHERE template_id=1 AND position=40),
   10,
   'ТЭЗҮ (техник, эдийн засгийн үндэслэл) боловсруулах',
   'multiplier_toggle',
   '{"multiplier":1.2,"hint":"БД 81-16-20 §3.4.3 — ТЭЗҮ заавал боловсруулах тохиолдолд +20%."}',
   0);

INSERT INTO quote_template_items (section_id, position, label, field_type, config_json, required) VALUES
  ((SELECT id FROM quote_template_sections WHERE template_id=1 AND position=40),
   20,
   'Гадаадын байгууллагатай хамтран ажиллах',
   'multiplier_toggle',
   '{"multiplier":1.4,"hint":"БД 81-16-20 §2.8 — гадаадын байгууллагатай хамтран зургийг уялдуулах +40%."}',
   0);

INSERT INTO quote_template_items (section_id, position, label, field_type, config_json, required) VALUES
  ((SELECT id FROM quote_template_sections WHERE template_id=1 AND position=40),
   30,
   'Англи хэлээр орчуулга бэлтгэх',
   'multiplier_toggle',
   '{"multiplier":1.15,"hint":"БД 81-16-20 §2.9 — гадаад хэлээр орчуулгатай зураг төсөлд +15%."}',
   0);

INSERT INTO quote_template_items (section_id, position, label, field_type, config_json, required) VALUES
  ((SELECT id FROM quote_template_sections WHERE template_id=1 AND position=40),
   40,
   'Хүндрэлтэй талбар (намаг, эгц налуу, овойлт суулттай хөрс)',
   'multiplier_toggle',
   '{"multiplier":1.2,"hint":"БД 81-16-20 §3.6.3 — байгалийн нөхцөл хүндрэлтэй талбарт +10-30%."}',
   0);

INSERT INTO quote_template_items (section_id, position, label, field_type, config_json, required) VALUES
  ((SELECT id FROM quote_template_sections WHERE template_id=1 AND position=40),
   50,
   '3D рендер бэлтгэх',
   'multiplier_toggle',
   '{"multiplier":1.05,"hint":"БД 81-16-20 §3.5.2 — рендер буюу 3 хэмжээст зураглал хийх үед +5%."}',
   0);
