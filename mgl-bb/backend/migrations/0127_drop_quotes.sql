-- Үнийн санал (Price Quote) feature-ийг БҮРЭН устгах.
--
-- Хэрэглэгчийн шийдвэрээр (2026-07-24) уг боломжийг апп-аас бүрмөсөн хассан:
-- frontend features/quotes/*, backend routes/quotes.ts, MCP quote+salesPipeline
-- tool-ууд, sidebar цэс, нийтийн /q/:token хуудас бүгд устсан. Энэ migration нь
-- үлдсэн өгөгдлийн сангийн хүснэгтүүдийг цэвэрлэнэ.
--
-- Устгах үеийн төлөв: 5 үнийн санал (бүгд тест — qwe/asd/26/test1/test) +
-- «Зураг төслийн жишиг үнэ (БД 81-16-20)» загвар. Бодит үйлчлүүлэгчид
-- илгээсэн санал байгаагүй.
--
-- FK хамаарлын дагуу хүүхэд хүснэгтээс нь эхэлж устгана.

DROP TABLE IF EXISTS quote_comments;
DROP TABLE IF EXISTS quotes;
DROP TABLE IF EXISTS quote_template_items;
DROP TABLE IF EXISTS quote_template_sections;
DROP TABLE IF EXISTS quote_templates;
