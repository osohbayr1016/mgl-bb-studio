-- 0250-д нөөцөлсөн өгөгдлийг шинэ бүтэц рүү буцааж тавина.
--
-- `block_id` / `drawing_id` / `component_id` / `task_id` багана АЛГА БОЛСОН:
-- баримтыг төслийн шатлалд наах зориулалттай байсан ч нэг ч мөр ашиглаагүй.
--
-- Хувилбарууд (`document_revisions`) нь 0250-ийн DROP-д cascade-аар арчигдсан
-- тул эндээс сэргэнэ.  `WHERE document_id IN (SELECT id FROM documents)` нь
-- өнчирсөн хувилбар (архивт зөөгдөөгүй баримтынх) буцаж орохоос сэргийлнэ.
INSERT INTO document_folders
  (id, archive_id, parent_id, name, code, is_system, sort_order, created_by, created_at, deleted_at, deleted_by, trash_op)
SELECT id, archive_id, parent_id, name, code, is_system, sort_order, created_by, created_at, deleted_at, deleted_by, trash_op
FROM _fold_bak;

INSERT INTO documents
  (id, archive_id, folder_id, title, description, created_by, created_at, deleted_at, deleted_by, trash_op)
SELECT id, archive_id, folder_id, title, description, created_by, created_at, deleted_at, deleted_by, trash_op
FROM _doc_bak;

INSERT INTO document_revisions
  (id, document_id, revision_number, file_url, file_name, file_type, file_size, status, uploaded_by, uploaded_at, reviewed_by, reviewed_at, review_notes)
SELECT id, document_id, revision_number, file_url, file_name, file_type, file_size, status, uploaded_by, uploaded_at, reviewed_by, reviewed_at, review_notes
FROM _rev_bak
WHERE document_id IN (SELECT id FROM documents);

DROP TABLE _fold_bak;

DROP TABLE _doc_bak;

DROP TABLE _rev_bak;
