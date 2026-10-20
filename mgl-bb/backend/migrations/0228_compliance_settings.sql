-- =============================================================
-- 0228_compliance_settings.sql — БОДИТ ХУГАЦААНЫ ХӨДӨЛГҮҮРИЙН ДУГУЙНУУД
-- =============================================================
-- ЗОРИЛГО: v2 §53/§75/§76/§82-ын БҮХ тоог deploy-гүйгээр эргүүлэх боломжтой
--   болгох.  Add-in эдгээрийг `GET /api/learning/settings`-ээс асах үедээ
--   татаж локалдаа кэшлэнэ (0203-ын 1C гэрээ, `learning.ts:225-248`).
--
-- ⚠️ УНШИГЧГҮЙ ДУГУЙ БҮҮ ҮЛДЭЭ.  `assistant.min_confidence` (0195:163) бол
--   энэ репогийн шипсэн урхи: мөр байгаа, `IntentRouter.cs:81` нь 0.45-ыг
--   ЭМХЭТГЭЛИЙН үед авдаг, серверээс уншдаг код БИЧИГДЭЭГҮЙ.  Эзэн утгыг
--   өөрчилж «би унтраалаа» гэж боддог, бодитоор ЮУ Ч БОЛОХГҮЙ.  Доорх найман
--   түлхүүр бүрийн УНШИГЧ нь `routes/learning.ts`-ийн `loadComplianceConfig`
--   дотор байна — нэг ч дугуйг уншигчгүй үлдээвэл ЭНЭ МИГРАЦ БУРУУ.
--   (Есдүгээр ба аравдугаар түлхүүр нь 0230-д.)
--
-- ⚠️ INSERT OR IGNORE тул дахин ажиллуулж болно.
-- ⚠️ ТЭЭВЭР: 8 statement (<= 9 — 0208 нь ЯГ ижил 8-тай, продакшнд хэрэгжсэн).
--   ⚠️ НӨӨЦ ТЭГ: ЕС ДЭХ дугуй нь ШИНЭ ФАЙЛ, ШИНЭ ДУГААР шаардана.

-- УНТРААХ ТОВЧ.  off = хөдөлгүүр бүхэлдээ унтарна (§75, §82).
-- off | observe | explain | recommend  (v2 §80-ын LEVEL 0/1/2)
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.mode', 'observe');

-- Нэгтгэлийн НАМЖИХ цонх (мс).  1200 = хүний хоёр Revit командын хоорондох
-- дундаж завсраас БАГА, гэвч regenerate-тэй командын дуусалтаас (~1000 мс)
-- ИХ.  ⚠️ ТААМАГ — ХЭМЖИГДЭЭГҮЙ (§9).
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.settle_ms', '1200');

-- ХОЙШЛУУЛАЛТЫН дээд хязгаар (мс).  Тасралтгүй загварчлалын үед олонлог
-- эцэст нь хаагдах ёстой.  ⚠️ Хойшлуулалтаар хаагдсан олонлог нь ЦУГЛУУЛАЛТ
-- ЭХЛҮҮЛЭХГҮЙ — хэрэглэгч ЯГ ТЭР мөчид завгүй нь батлагдсан байдаг.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.max_defer_ms', '15000');

-- Нэг логик олонлогийн элементийн дээд тоо.  2000 нь
-- `bim.capture.elements_per_session` = 4000 (0208:20)-ийн ТЭН ХАГАС: түүнээс
-- том наалт нь дизайны шийдвэр биш, БӨӨНИЙ үйлдэл.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.max_elements_per_set', '2000');

-- Түүхийн цагираг (гүйлгээ / баримт).  4000 нь нэг ажилтны нэг өдрийн
-- гүйлгээний дээд таамгаас (1B-1 §9: 40-200 өдөрт — ХЭМЖИГДЭЭГҮЙ) 20 дахин их.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.raw_ring_max', '4000');

-- Нэг POST-д багтах гүйлгээ/үйл явдлын дээд тоо.  100 нь серверийн
-- `txn_batch_max` = 200 (0208:27, `learning.ts:307-311` дээр 413)-аас БАГА —
-- дугуйг доош эргүүлэхэд add-in 413 авахгүй.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.emit_batch_max', '100');

-- МЭДЭГДЭХ доод ноцтой байдал (§76, §67).  Үүнээс доогуур нь ЗӨВХӨН
-- самбарын жагсаалтад орно, тоолуурт нөлөөлнө, ХЭЗЭЭ Ч түлхэхгүй.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.min_severity', 'HIGH');

-- «Дараа» дарсан мөрийг хэдэн цаг чимээгүй байлгах вэ (§76 snooze).
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.snooze_hours', '24');
