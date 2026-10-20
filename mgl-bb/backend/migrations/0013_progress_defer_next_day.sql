-- "Маргааш хийнэ" daily stand-in: counts as today's report without changing %.
ALTER TABLE progress_entries ADD COLUMN defer_next_day INTEGER NOT NULL DEFAULT 0;
