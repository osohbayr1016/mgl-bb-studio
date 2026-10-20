-- Дөрвөн үндсэн маягт.  Админ дараа нь нэмж/өөрчилж болно.
-- fields_json: [{key,label_mn,type,required,choices}] — type нь
-- text | textarea | select | date.
-- filename_pattern-ийн токенууд: project_code doc_type discipline yyyymmdd seq3 rev orig

INSERT OR IGNORE INTO client_submission_templates (code, name_mn, description_mn, fields_json, filename_pattern, allowed_ext, sort_order)
VALUES ('DAALGAVAR', 'Даалгавар / Техникийн нөхцөл', 'Зураг төслийн даалгавар, техникийн нөхцөл, зөвшөөрөл', '[{"key":"discipline","label_mn":"Чиглэл","type":"select","required":false,"choices":["BA","BB","HAS","TSBU","TSAH","HD","AU","EZ","IZ","GT"]},{"key":"note","label_mn":"Тайлбар","type":"textarea","required":false}]', '{project_code}-{doc_type}-{discipline}-{yyyymmdd}-{seq3}', NULL, 10);

INSERT OR IGNORE INTO client_submission_templates (code, name_mn, description_mn, fields_json, filename_pattern, allowed_ext, sort_order)
VALUES ('SUDALGAA', 'Судалгаа шинжилгээ', 'Геологи, геодези, хөрсний болон бусад судалгааны тайлан', '[{"key":"kind","label_mn":"Судалгааны төрөл","type":"select","required":true,"choices":["Геологи","Геодези","Хөрс","Байгаль орчин","Бусад"]},{"key":"note","label_mn":"Тайлбар","type":"textarea","required":false}]', '{project_code}-{doc_type}-{yyyymmdd}-{seq3}', NULL, 20);

INSERT OR IGNORE INTO client_submission_templates (code, name_mn, description_mn, fields_json, filename_pattern, allowed_ext, sort_order)
VALUES ('HARIU', 'Асуултын хариу', 'Бидний тавьсан асуулт эсвэл тодруулгад өгөх албан хариу', '[{"key":"ref","label_mn":"Хамаарах бичиг (RFI дугаар)","type":"text","required":false},{"key":"note","label_mn":"Хариу","type":"textarea","required":true}]', '{project_code}-{doc_type}-{yyyymmdd}-{seq3}', NULL, 30);

INSERT OR IGNORE INTO client_submission_templates (code, name_mn, description_mn, fields_json, filename_pattern, allowed_ext, sort_order)
VALUES ('LAVLAGAA', 'Лавлагаа материал', 'Загвар зураг, гэрэл зураг, лавлах материал', '[{"key":"note","label_mn":"Тайлбар","type":"textarea","required":false}]', '{project_code}-{doc_type}-{yyyymmdd}-{seq3}', NULL, 40);
