BEGIN;

CREATE TABLE IF NOT EXISTS daily_activity.historical_imports (
  digest text PRIMARY KEY CHECK (digest ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK (kind IN ('summary', 'productivity-queue')),
  source_ref text NOT NULL,
  source_revision text NOT NULL,
  source_rows jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, source_ref, source_revision)
);

CREATE TABLE IF NOT EXISTS daily_activity.historical_records (
  batch_digest text NOT NULL REFERENCES daily_activity.historical_imports (digest),
  source_row integer NOT NULL CHECK (source_row >= 2),
  record_key jsonb NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (batch_digest, source_row),
  UNIQUE (batch_digest, record_key)
);

COMMIT;
