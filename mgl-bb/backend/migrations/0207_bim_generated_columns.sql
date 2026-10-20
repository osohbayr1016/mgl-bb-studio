-- revit_transactions
ALTER TABLE revit_transactions ADD COLUMN element_total INTEGER
  GENERATED ALWAYS AS (added_count + deleted_count + modified_count) VIRTUAL;
ALTER TABLE revit_transactions ADD COLUMN parts_missing INTEGER
  GENERATED ALWAYS AS (parts_expected & ~parts_present) VIRTUAL;
