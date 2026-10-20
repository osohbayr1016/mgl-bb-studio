-- Төслийн бус ажлын шалгалт (2026-09-24) — админ батлах үеийн SNAPSHOT.
--
-- Админ «Тайлан → Төслийн бус ажлын тайлан» дээр бүртгэлийг батлахад оноо
-- (засвартай ИЖИЛ томьёо: өдрийн дундаж ханш × цаг / 8) `user_points`-д
-- source = 'non_project'-оор бичигдэнэ (0343).  Ханш ба түүний шат энд
-- хөлдөнө — `repair_entries.weekly_avg_pct` / `rate_source`-ийн адил:
-- `user_points` бол ДЭВТЭР, хожим цонх гүйсэн ч түүхэн оноо хөдлөхгүй, харин
-- «яагаад ийм хувь гарав?» гэхэд хариулах цорын ганц ул мөр нь эдгээр.
-- Хүлээгдэж буй / татгалзсан мөрөнд гурвуулаа NULL.
--
-- Индекс нь батлах замын давхар бичлэгээс сэргийлэх `NOT EXISTS` шалгалтад
-- (routes/nonProjectWorkReview.ts) — partial тул хуучин мөрүүдэд зай эзлэхгүй.
ALTER TABLE non_project_work_entries ADD COLUMN daily_rate REAL;
ALTER TABLE non_project_work_entries ADD COLUMN rate_source TEXT;
ALTER TABLE non_project_work_entries ADD COLUMN computed_pct REAL;
CREATE INDEX IF NOT EXISTS idx_user_points_non_project
  ON user_points(non_project_work_id) WHERE non_project_work_id IS NOT NULL;
