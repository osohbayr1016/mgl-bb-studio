-- Архивын ДАВХАРДСАН үндсэн хавтсыг арилгана.
--
-- Алдаа: `DocumentsPage.importTree` нь чирсэн хавтсаар АРХИВ үүсгээд
-- (`name = tree.rootName`), дараа нь `useFolderImport` тэр модыг яг тэр
-- чигээр нь буюу `rootName/...` угтвартай нь дотор нь дахин үүсгэдэг байв.
-- Үр дүнд нь архив руу орсны дараа яг ижил нэртэй ганц хавтас гарч, бүтэц
-- харагдахын тулд ХОЁР удаа дарах шаардлагатай болсон:
--   Төслийн баримт бичиг > 00. DOC-251124 TEMPLATE > 00. DOC-251124 TEMPLATE > 00 БИЧИГ БАРИМТ
-- Импортын тал нь `folderScan.stripRoot`-оор зассан, энэ файл нь БАЙГАА
-- өгөгдлийг цэгцэлнэ (2026-09-07-нд 21 архив ийм байсан).
--
-- Дараалал нь ЧУХАЛ: `document_folders.parent_id` нь ON DELETE CASCADE тул
-- `migrations apply`-ийн транзакц дотор эцгийг нь эхэлж устгавал БҮХ ХҮҮХЭД
-- арчигдана.  Тиймээс эхлээд хүүхдийг дээш нь зөөж, эцэг нь ХООСОРСНЫ дараа
-- л устгана.
--
-- Мөн id-г урьдчилж таблицад хураана: хүүхдийг root болгож зөөх нь
-- «архивт яг НЭГ root хавтас байна» гэсэн нөхцөлийг мөр дундуур өөрчилдөг
-- тул UPDATE дотроос тэр нөхцөлийг шалгаж БОЛОХГҮЙ.
CREATE TABLE _dupe_root AS
SELECT f.id AS id
FROM document_folders f
JOIN document_archives a ON a.id = f.archive_id
WHERE f.parent_id IS NULL
  AND f.deleted_at IS NULL
  AND f.name = a.name
  AND (SELECT COUNT(*) FROM document_folders g
        WHERE g.archive_id = f.archive_id AND g.parent_id IS NULL AND g.deleted_at IS NULL) = 1
  AND (SELECT COUNT(*) FROM documents d
        WHERE d.archive_id = f.archive_id AND d.folder_id IS NULL AND d.deleted_at IS NULL) = 0;

-- Устгасан хүүхдийг ч зөөнө: сагснаас сэргээхэд эцэг нь байхгүй бол өнчирнө.
UPDATE document_folders SET parent_id = NULL WHERE parent_id IN (SELECT id FROM _dupe_root);

-- Давхардсан root дотор шууд байсан файл архивын үндэс рүү гарна.
UPDATE documents SET folder_id = NULL WHERE folder_id IN (SELECT id FROM _dupe_root);

DELETE FROM document_folders WHERE id IN (SELECT id FROM _dupe_root);

DROP TABLE _dupe_root;
