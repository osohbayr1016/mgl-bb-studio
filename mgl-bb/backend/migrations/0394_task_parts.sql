-- 0394 — ХҮНГҮЙ ХЭСЭГ: таскийг хүн оноолгүйгээр нэр + хувиар хуваах (эзэн 2026-10-09).
--
-- Ажилтан нэг таскийг (12 «Технологийн байгууламж») өөрөө нэрлэсэн хэсгүүд болгоно: 12.1 «суурь» 40%,
-- 12.2 «тоноглол» 35% … — хүнгүй.  Хэсэг нь үндсэн ажлын ХУВААРИЛАГДААГҮЙ ирээдүйн ажлын (`task_roots.unallocated_units`
-- = U) нэрлэсэн нөөц: Σ units ≤ U.  ▶ дарсан ажилтан хэсгийг АВНА — тэр мөчид хэсэг нь түүний хуваарилалт
-- (`task_allocations`, ижил дугаар + нэр) болж, энэ мөр устна.  Тиймээс оноо, явц, таймер, журнал ХӨНДӨГДӨХГҮЙ:
-- хэсэг дээр хэзээ ч хийсэн (D) байхгүй, хүнгүй тул оноо ч үгүй.
--
--   ordinal — `task_roots.next_ordinal`-оос (хуваарилалттай НЭГ тоолуур) → 12.k дугаар давхцахгүй, авахад хадгалагдана.
--   units   — үндсэн ажлын нэгжээр (1% = 10 000, `lib/taskUnits.ts`).
--
-- Бүх өөрчлөлт `task_roots.revision`-ийн CAS + marker-тэй (`lib/taskRootOps.ts` `applyParts`, `claimPart`).
-- FK ЗОРИУД байхгүй (0376-ийн жишгээр) — root устахад гараар (`taskUnsplit`, `taskRootGuard`, `taskConversion`).
-- Шинэ хүснэгт л: хуучин worker үүнийг үл тоож ажилласаар байна.

CREATE TABLE IF NOT EXISTS task_parts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL,
  ordinal    INTEGER NOT NULL,
  label      TEXT    NOT NULL,
  units      INTEGER NOT NULL CHECK (units > 0 AND units <= 1000000),
  created_by INTEGER,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (task_id, ordinal)
);
