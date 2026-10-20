-- =============================================
-- Компанийн баярын / ажлын бус өдрүүдийн календарь.
--
-- Төслийн "Графикууд" tab-ийн өдрийн лаа (candle) өнгийг тооцоход
-- ашиглана: ажлын бус өдөр (амралт + энд бүртгэсэн баяр) дээр явц
-- гараагүй бол улаан биш улбар шар болж, "амрах ёстой өдөр"-ийг
-- "хоцорсон ажлын өдөр"-өөс ялгана.  Хүн ажиллаж явц гаргасан бол
-- хэвийн ногоон/улаанаар дүгнэгдэнэ.
--
-- date нь UNIQUE — нэг өдөрт нэг л бичлэг.  Засварлахын оронд устгаад
-- дахин нэмнэ (цөөн бичлэгтэй тул хямд).
-- =============================================

CREATE TABLE holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,           -- yyyy-mm-dd (UB)
  name TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_holidays_date ON holidays(date);
