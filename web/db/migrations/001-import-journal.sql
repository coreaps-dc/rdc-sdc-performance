BEGIN;

CREATE SCHEMA IF NOT EXISTS daily_activity;

CREATE TABLE IF NOT EXISTS daily_activity.import_batches (
  digest text PRIMARY KEY CHECK (digest ~ '^[0-9a-f]{64}$'),
  source_ref text NOT NULL,
  source_revision text NOT NULL,
  batch_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  imported_at timestamptz NOT NULL DEFAULT now(),
  accepted integer NOT NULL CHECK (accepted >= 0),
  rejected integer NOT NULL CHECK (rejected >= 0)
);

CREATE TABLE IF NOT EXISTS daily_activity.import_rows (
  batch_digest text NOT NULL REFERENCES daily_activity.import_batches (digest),
  row_number integer NOT NULL CHECK (row_number >= 2),
  payload jsonb NOT NULL,
  rejection text,
  PRIMARY KEY (batch_digest, row_number)
);

CREATE TABLE IF NOT EXISTS daily_activity.demand_events (
  source_ref text NOT NULL,
  source_row integer NOT NULL CHECK (source_row >= 2),
  first_batch_digest text NOT NULL REFERENCES daily_activity.import_batches (digest),
  row_digest text NOT NULL CHECK (row_digest ~ '^[0-9a-f]{64}$'),
  business_date date NOT NULL,
  dc text NOT NULL CHECK (dc <> ''),
  bu text NOT NULL CHECK (bu IN ('HCI', 'AHI')),
  shift text NOT NULL CHECK (shift <> ''),
  department text NOT NULL CHECK (department <> ''),
  activity text NOT NULL CHECK (activity <> ''),
  demand numeric,
  unit text NOT NULL,
  legacy_resource numeric,
  operator_label text,
  occurred_at timestamptz,
  resource numeric,
  event_type text NOT NULL,
  reason text,
  legacy_event_id text,
  PRIMARY KEY (source_ref, source_row)
);

CREATE INDEX IF NOT EXISTS demand_events_scope_idx
  ON daily_activity.demand_events (dc, bu, business_date, shift, department, activity);

COMMIT;
