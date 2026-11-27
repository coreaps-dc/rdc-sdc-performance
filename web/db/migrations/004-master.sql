BEGIN;

CREATE TABLE IF NOT EXISTS daily_activity.master_sites (
  code text PRIMARY KEY CHECK (code <> ''),
  work_hours numeric CHECK (work_hours > 0 AND work_hours < 'Infinity'::numeric)
);

CREATE TABLE IF NOT EXISTS daily_activity.master_imports (
  source_ref text PRIMARY KEY,
  source_revision text NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  source_rows jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_activity.master_activities (
  name text PRIMARY KEY CHECK (name <> ''),
  department text NOT NULL CHECK (department <> ''),
  unit text NOT NULL CHECK (unit <> ''),
  default_rate numeric CHECK (default_rate >= 0 AND default_rate < 'Infinity'::numeric),
  CHECK (name <> 'Check & Pack' OR
    (department = 'OUTBOUND' AND unit = 'CASE ID' AND default_rate IS NOT DISTINCT FROM 50::numeric))
);

CREATE TABLE IF NOT EXISTS daily_activity.site_productivity (
  site text NOT NULL REFERENCES daily_activity.master_sites (code),
  activity text NOT NULL REFERENCES daily_activity.master_activities (name),
  department text NOT NULL,
  unit text NOT NULL,
  rate numeric CHECK (rate >= 0 AND rate < 'Infinity'::numeric),
  PRIMARY KEY (site, activity),
  CHECK (activity <> 'Check & Pack' OR
    (department = 'OUTBOUND' AND unit = 'CASE ID' AND rate IS NOT DISTINCT FROM 50::numeric))
);

-- Serialize catalog additions so a site and an activity added concurrently see each other.
CREATE OR REPLACE FUNCTION daily_activity.seed_site_productivity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'master_sites' THEN
    INSERT INTO daily_activity.site_productivity (site, activity, department, unit, rate)
      SELECT NEW.code, name, department, unit, default_rate FROM daily_activity.master_activities
      ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO daily_activity.site_productivity (site, activity, department, unit, rate)
      SELECT code, NEW.name, NEW.department, NEW.unit, NEW.default_rate FROM daily_activity.master_sites
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION daily_activity.lock_master_catalog()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(404, 1);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER lock_master_sites BEFORE INSERT ON daily_activity.master_sites
  FOR EACH STATEMENT EXECUTE FUNCTION daily_activity.lock_master_catalog();
CREATE OR REPLACE TRIGGER lock_master_activities BEFORE INSERT ON daily_activity.master_activities
  FOR EACH STATEMENT EXECUTE FUNCTION daily_activity.lock_master_catalog();
CREATE OR REPLACE TRIGGER seed_site_productivity AFTER INSERT ON daily_activity.master_sites
  FOR EACH ROW EXECUTE FUNCTION daily_activity.seed_site_productivity();
CREATE OR REPLACE TRIGGER seed_activity_productivity AFTER INSERT ON daily_activity.master_activities
  FOR EACH ROW EXECUTE FUNCTION daily_activity.seed_site_productivity();

INSERT INTO daily_activity.master_activities (name, department, unit, default_rate)
VALUES ('Check & Pack', 'OUTBOUND', 'CASE ID', 50) ON CONFLICT DO NOTHING;

COMMIT;
