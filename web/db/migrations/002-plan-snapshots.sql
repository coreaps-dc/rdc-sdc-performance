BEGIN;

CREATE SCHEMA IF NOT EXISTS daily_activity;

CREATE TABLE IF NOT EXISTS daily_activity.plan_snapshots (
  source_ref text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('inbound', 'outbound')),
  generated_at timestamptz NOT NULL,
  source_revision text NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  source_rows jsonb NOT NULL,
  payload jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_ref, kind, generated_at)
);

COMMIT;
