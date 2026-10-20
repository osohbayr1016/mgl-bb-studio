-- Зургийн жагсаалтын нийтлэг нэмэлт мөрүүд — бүх төсөлд үйлчилнэ.
--
-- Баг бүрийн тайлбар бичгийн "Зургийн жагсаалт" (drawing-list) хэсгийн үндсэн
-- мөрүүд frontend template.ts-д кодоор хэвээр үлдэнэ; энэ хүснэгтэд зөвхөн
-- admin/senior-ийн НЭМСЭН мөрүүд хадгалагдана (норм каталогийн 0120-той ижил
-- зарчим). `key` нь checkbox хариултын (project_team_reports.answers_json)
-- тогтвортой түлхүүр тул засварлахад өөрчлөгддөггүй.

CREATE TABLE IF NOT EXISTS team_drawing_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  team_code  TEXT NOT NULL,               -- BA/BB/HAS/TSBU/TSAH/HD/AU/IZ
  key        TEXT NOT NULL UNIQUE,        -- 'dl_custom_<uuid8>' — immutable
  label      TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_team_drawing_items_team
  ON team_drawing_items (team_code, position);
