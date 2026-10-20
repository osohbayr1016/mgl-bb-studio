-- Багийн профайл — «Бүтээмж» таб, ахлахад илгээсэн анхааруулгын түүх (2026-09-24).
--
-- Эзний хүсэлт: багийн хамгийн дээд ба хамгийн доод хүний өдрийн дундаж
-- бүтээмжийн зөрүү 20%-иас (захирал өөрчилнө, app_settings
-- 'team_productivity.gap_threshold_pct') хэтэрвэл захирал ахлахад анхааруулна,
-- дараа нь «хэзээ, хэнд, ямар тоогоор анхааруулсан бэ» гэж буцааж шалгана.
--
-- ⚠️ Мөр бүр ИЛГЭЭСЭН МӨЧИЙН SNAPSHOT: gap/top/bottom/team_avg нь тухайн үеийн
--    тоо, below_json = шугамаас доош байсан гишүүд [{user_id, full_name, avg}],
--    recipients_json = [{id, full_name}].  Дараа нь оноо дахин бодогдсон ч
--    түүх өөрчлөгдөхгүй — дэлгэц дээрх амьд тоо өөр байж болно.
-- ⚠️ Хэрэглэгч рүү FK ЗОРИУД байхгүй (asr_safety_acknowledgements-ийн шалтгаан):
--    нэрс snapshot-д байгаа тул хэрэглэгч устгахад гараар цэвэрлэх хүүхэд
--    хүснэгт нэмэгдэхгүй.  Баг устахад түүх нь хамт устна.
-- ⚠️ Устгах/засах зам БАЙХГҮЙ — append-only түүх.
CREATE TABLE IF NOT EXISTS team_productivity_warnings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id         INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  period_kind     TEXT    NOT NULL CHECK (period_kind IN ('day', 'week', 'month')),
  period_from     TEXT    NOT NULL,
  period_to       TEXT    NOT NULL,
  gap_pct         REAL,
  threshold_pct   REAL    NOT NULL,
  top_user_id     INTEGER,
  top_avg         REAL,
  bottom_user_id  INTEGER,
  bottom_avg      REAL,
  team_avg        REAL,
  below_json      TEXT,
  note            TEXT,
  recipients_json TEXT    NOT NULL,
  sent_by         INTEGER NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tpw_team_created ON team_productivity_warnings(team_id, created_at DESC);
