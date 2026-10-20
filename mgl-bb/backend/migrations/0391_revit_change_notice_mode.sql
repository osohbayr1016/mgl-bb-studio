-- 0391 — Revit зөөлтийн мэдэгдэлд зөөлтийн горим + «үл харгалзсан» шалтгаан.
--
-- 0390 нь прод дээр 2026-10-06-нд хэрэгжсэн тул түүний CREATE TABLE-д багана
-- нэмэх нь прод дээр ХЭЗЭЭ Ч ажиллахгүй (миграц append-only) — тиймээс ALTER.
--
-- `mode` = 'simulation' (add-in-ий 3D симуляцаар зөөсөн) | 'native' (Revit-ийн
-- өөрийн Move-оор зөөгөөд хэрэгсэл дараа нь шалгасан) — CHECK-гүй, кодод шалгана.
-- Хуучин мөрүүд бүгд симуляцаар зөөгдсөн тул өгөгдмөл 'simulation'.
-- `forced_reason` = 🔴 дүгнэлтийг үл харгалзан баталсан архитекторын шалтгаан.
--
-- Дүрэм: `backend/src/lib/revitChangeNotices.ts`, замууд
-- `backend/src/routes/revitChangeNotices.ts`.

ALTER TABLE revit_change_notices ADD COLUMN mode TEXT NOT NULL DEFAULT 'simulation';
ALTER TABLE revit_change_notices ADD COLUMN forced_reason TEXT;
