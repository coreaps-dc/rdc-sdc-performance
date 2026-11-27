BEGIN;

CREATE TABLE IF NOT EXISTS daily_activity.plan_shift_imports (
  digest text PRIMARY KEY CHECK (digest ~ '^[0-9a-f]{64}$'),
  source_ref text NOT NULL,
  kind text NOT NULL,
  generated_at timestamptz NOT NULL,
  source_revision text NOT NULL,
  source_rows jsonb NOT NULL,
  report jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (source_ref, kind, generated_at)
    REFERENCES daily_activity.plan_snapshots (source_ref, kind, generated_at)
);

COMMIT;
