CREATE TRIGGER IF NOT EXISTS bim_artifacts_append_only
BEFORE UPDATE ON bim_artifacts
WHEN NEW.redacted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'bim_artifacts is append-only — only redaction may UPDATE');
END;

CREATE TRIGGER IF NOT EXISTS bim_artifacts_redact_once
BEFORE UPDATE ON bim_artifacts
WHEN OLD.redacted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'bim_artifacts: row already redacted');
END;

CREATE TRIGGER IF NOT EXISTS revit_transactions_append_only
BEFORE UPDATE ON revit_transactions
WHEN NEW.redacted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'revit_transactions is append-only — only redaction may UPDATE');
END;

CREATE TRIGGER IF NOT EXISTS revit_transactions_redact_once
BEFORE UPDATE ON revit_transactions
WHEN OLD.redacted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'revit_transactions: row already redacted');
END;

CREATE TRIGGER IF NOT EXISTS revit_element_touches_append_only
BEFORE UPDATE ON revit_element_touches
WHEN NEW.redacted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'revit_element_touches is append-only — only redaction may UPDATE');
END;

CREATE TRIGGER IF NOT EXISTS revit_element_touches_redact_once
BEFORE UPDATE ON revit_element_touches
WHEN OLD.redacted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'revit_element_touches: row already redacted');
END;

CREATE TRIGGER IF NOT EXISTS learning_events_append_only
BEFORE UPDATE ON learning_events
WHEN NEW.redacted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'learning_events is append-only — only redaction may UPDATE');
END;

CREATE TRIGGER IF NOT EXISTS learning_events_redact_once
BEFORE UPDATE ON learning_events
WHEN OLD.redacted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'learning_events: row already redacted');
END;
