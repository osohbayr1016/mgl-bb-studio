-- 0401 — Блок хуулах (POST /api/blocks/:id/duplicate) үйлдлийн журнал.
--
-- Өмнө нь хуулалт 4 тусдаа бичилт байсан (блок → зураг → бүрэлдэхүүн → таск):
-- дундаас унавал хоосон эсвэл дутуу хуулбар блок үлддэг, мөн давхар дарахад
-- хоёр хуулбар үүсдэг байв.  Одоо бүх мод НЭГ `db.batch` (= нэг транзакц)-аар
-- бичигдэнэ, тэр batch-ийн ХОЁР ДАХЬ мөр нь энэ хүснэгтэд орно:
--   • `request_id` PRIMARY KEY — ижил хүсэлт дахин ирвэл batch бүхэлдээ
--     буцаж, анхны үр дүн (replay) буцна;
--   • `new_block_id` — дараагийн INSERT … SELECT-үүд шинэ блокийн id-г
--     эндээс уншина (RETURNING-ийн байрлалын холбоо хэрэггүй).
-- Хэрэглэгч/төсөл/блок руу FK ЗОРИУД байхгүй: энэ бол түүх, блок устсан ч үлдэнэ.
CREATE TABLE IF NOT EXISTS block_duplicate_ops (
  request_id      TEXT    PRIMARY KEY,
  user_id         INTEGER NOT NULL,
  project_id      INTEGER NOT NULL,
  source_block_id INTEGER NOT NULL,
  new_block_id    INTEGER NOT NULL,
  name            TEXT    NOT NULL,
  weight_percent  REAL    NOT NULL,
  created_at      TEXT    NOT NULL
);
