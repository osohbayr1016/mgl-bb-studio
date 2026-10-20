-- 0360 — Revit-ийн АВТОМАТ ЦАГ БҮРТГЭЛ (эзний Session 4/5, 2026-09-29).
--
-- Хэмжиж буй зүйл: «ажилтны ОДООГИЙН ERP таск дээр Revit-д ИДЭВХТЭЙ
-- ажилласан хугацаа».  Хүний бүх бүтээмж БИШ, Revit-ээс гадуурх ажил БИШ.
-- Add-in нь зөвхөн (а) Revit урд цонх эсэх, (б) Windows-ийн сүүлийн оролтоос
-- хойшхи ХУГАЦАА-г уншина — товчлуур, дэлгэцийн зураг, clipboard, бичсэн
-- текст, хөтчийн түүх, бусад програмын нэр ХЭЗЭЭ Ч цуглуулахгүй.
--
-- revit_work_segments — ХУРИМТЛАЛ, delta БИШ.  Нэг мөр = (Revit сесс, ажилтан,
-- таск, баримт, ажлын өдөр).  Клиент тухайн сегментийн НИЙТ мс-ийг `rev`-тэй
-- илгээнэ, сервер MAX-аар хадгална — давтан хүргэлт, дараалал алдагдах,
-- офлайн дарааллын дахин илгээлт ХЭЗЭЭ Ч давхар тоолохгүй.  `segment_id` нь
-- клиентийн сессийн UUID + дугаар (хэрэглэгч хооронд давхцахгүй).  Өдрийн
-- нийт = SUM(active_ms) (сессүүд давхцахгүй: нэг процесс л урд цонх байна).
--
-- revit_work_presence — Revit сесс тутамд нэг мөр (heartbeat).  `last_seen_at`
-- нь СЕРВЕРИЙН цаг; heartbeat тасарвал админы харагдац OFFLINE болно
-- (`lib/revitTracking.ts` STALE_AFTER_MS) — унасан Revit хэзээ ч «ажиллаж
-- байна» гэж үлдэхгүй.
--
-- ⚠️ НУУЦЛАЛ: 0201-0205-ын «элемент түвшний үйл ажиллагаа зөвхөн өөртөө»
-- дүрэм ХЭВЭЭР — энэ хүснэгтүүд элемент, харагдац, өөрчлөлт АГУУЛАХГҮЙ.
-- ⚠️ ДАЛД СИСТЕМ (эзний шийдвэр 2026-09-29): албан ёсны цаг нь гараар
-- удирдах Play/Pause таймер (тусдаа систем).  Энэ Revit-ийн автомат бүртгэл
-- ажилласаар боловч ERP-ийн ямар ч хуудас (CEO самбар, профайл, ажилтны
-- самбар) харуулахгүй, албан таймертай ХОЛИХГҮЙ.  Уншигч нь зөвхөн
-- admin-only `GET /api/revit/tracking/live|day` (цэсэнд байхгүй).
--
-- ⚠️ users/tasks руу FK ЗОРИУД байхгүй — users-ийн path-B дахин бүтээлтэд
-- cascade-ийн хүүхэд нэмэхгүй.  DELETE /api/users/:id гараар цэвэрлэнэ.
--
-- revit_submissions.revit_active_ms — Revit-ээс явц илгээх агшинд тухайн
-- таскийн өнөөдрийн Revit цаг (аудит, клиентийн утга).

CREATE TABLE IF NOT EXISTS revit_work_segments (
  segment_id        TEXT    PRIMARY KEY,
  session_id        TEXT    NOT NULL,
  user_id           INTEGER NOT NULL,
  task_id           INTEGER NOT NULL,
  project_id        INTEGER,
  work_date         TEXT    NOT NULL,
  doc_key           TEXT,
  revit_document_id INTEGER,
  active_ms         INTEGER NOT NULL DEFAULT 0 CHECK (active_ms >= 0),
  idle_ms           INTEGER NOT NULL DEFAULT 0 CHECK (idle_ms >= 0),
  rev               INTEGER NOT NULL DEFAULT 0,
  first_at          TEXT,
  last_at           TEXT,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rws_user_date ON revit_work_segments (user_id, work_date);

CREATE INDEX IF NOT EXISTS idx_rws_date_user ON revit_work_segments (work_date, user_id);

CREATE INDEX IF NOT EXISTS idx_rws_task_date ON revit_work_segments (task_id, work_date);

CREATE TABLE IF NOT EXISTS revit_work_presence (
  session_id        TEXT    PRIMARY KEY,
  user_id           INTEGER NOT NULL,
  state             TEXT    NOT NULL,
  task_id           INTEGER,
  project_id        INTEGER,
  revit_document_id INTEGER,
  doc_name          TEXT,
  addin_version     TEXT,
  started_at        TEXT    NOT NULL,
  last_seen_at      TEXT    NOT NULL,
  client_at         TEXT,
  ended_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_rwp_seen ON revit_work_presence (last_seen_at);

CREATE INDEX IF NOT EXISTS idx_rwp_user_seen ON revit_work_presence (user_id, last_seen_at);

ALTER TABLE revit_submissions ADD COLUMN revit_active_ms INTEGER;
