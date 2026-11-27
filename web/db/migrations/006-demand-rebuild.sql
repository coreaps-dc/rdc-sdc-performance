BEGIN;

CREATE TABLE IF NOT EXISTS daily_activity.demand_event_resolutions (
  source_ref text NOT NULL,
  source_row integer NOT NULL,
  reason text NOT NULL CHECK (trim(reason) <> ''),
  approved_by text NOT NULL CHECK (trim(approved_by) <> ''),
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_ref, source_row),
  FOREIGN KEY (source_ref, source_row)
    REFERENCES daily_activity.demand_events (source_ref, source_row)
);

CREATE OR REPLACE VIEW daily_activity.rebuilt_activity_demand AS
SELECT e.source_ref, e.business_date, e.dc, e.bu, e.shift, e.activity,
  (array_agg(e.department ORDER BY e.source_row))[1] AS department,
  (array_agg(e.unit ORDER BY e.source_row))[1] AS unit,
  coalesce(sum(e.demand), 0) AS demand,
  count(e.demand) > 0 AS demand_entered
FROM daily_activity.demand_events e
WHERE NOT EXISTS (
  SELECT 1 FROM daily_activity.demand_event_resolutions r
  WHERE r.source_ref = e.source_ref AND r.source_row = e.source_row
)
GROUP BY e.source_ref, e.business_date, e.dc, e.bu, e.shift, e.activity;

COMMIT;
