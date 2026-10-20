-- =====================================================================
-- 0374_revit_license_devices.sql — Revit add-in-ий ЛИЦЕНЗИЙН компьютерууд
-- =====================================================================
-- ЗОРИЛГО (эзэн, 2026-10-01): add-in 1.9.0-аас эхлэн БҮХ хэрэгсэл зөвхөн
-- компанийн бүртгэлээр, зөвхөн ажилтны ирц бүртгүүлдэг АЖЛЫН компьютер дээр
-- ажиллана.  Сервер гарын үсэгтэй 3 хоногийн лиценз олгоно
-- (`lib/revitLicense.ts`, `routes/revitLicense.ts`).
--
-- НЭГ мөр = (ажилтан, add-in-ий компьютер).  `device_id` нь add-in-ий
-- SHA-256 hex (Windows MachineGuid + Windows хэрэглэгч) — машины НЭР, түүхий id
-- сервер рүү ХЭЗЭЭ Ч явахгүй (эзэн: админд компьютерын нэр харагдахгүй).
-- `hw_json` = add-in-ий уншсан GPU / цөм / дэлгэц — ирцийн
-- `attendance_devices.hw_json`-той тулгагдана.
--
-- `status` (CHECK-гүй — утгын дүрэм `lib/revitLicense.ts` DEVICE_STATUSES):
--   auto     — техник хангамжийн тулгалтаар (өгөгдмөл)
--   approved — admin гараар зөвшөөрсөн (тулгалт таарахгүй ч ажиллана)
--   blocked  — admin хаасан (тулгалт таарсан ч ажиллахгүй)
-- `last_result` = сүүлийн лицензийн хүсэлтийн үр дүн (ok_match, ok_approved,
-- NOT_WORK_PC г.м.) — админ «энэ компьютер яагаад ажиллахгүй байна» гэдгийг
-- эндээс харна.
-- `bound_attendance_device_id` = анх БҮРЭН таарсан ирцийн төхөөрөмж.  Тэр мөр
-- идэвхтэй, GPU + цөм таарсаар байвал монитор солигдсон ч лиценз унахгүй
-- (`decideLicense`-ийн 2-р алхам).  Татгалзсан хүсэлт үүнийг арилгахгүй.
--
-- ⚠️ users руу FK ЗОРИУД БАЙХГҮЙ: прод D1 нь foreign_keys = 1 тул
-- үйлдэлгүй REFERENCES нь хэрэглэгч устгахыг RESTRICT-ээр хаана.
-- `DELETE /api/users/:id` мөрийг гараар устгана (0361-ийн хэв маяг).
--
-- ⚠️ ТЭЭВЭР: 2 statement, блок тайлбаргүй, мөрөн дотор цэг таслал алга.
-- =====================================================================

CREATE TABLE IF NOT EXISTS revit_license_devices (
  id                           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                      INTEGER NOT NULL,
  device_id                    TEXT    NOT NULL,
  hw_json                      TEXT,
  status                       TEXT    NOT NULL DEFAULT 'auto',
  last_result                  TEXT,
  bound_attendance_device_id   INTEGER,
  addin_version                TEXT,
  revit_year                   TEXT,
  first_seen_at                TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at                 TEXT    NOT NULL DEFAULT (datetime('now')),
  last_lease_at                TEXT,
  decided_by                   INTEGER,
  decided_at                   TEXT,
  UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_revit_license_devices_user
  ON revit_license_devices (user_id, last_seen_at);
