-- ============================================================================
-- Recreate Materialized View for HPDAV Project
-- This script drops and recreates the trip_coordinates materialized view
-- with the trip_date column for date filtering support.
-- ============================================================================

-- Usage:
-- docker compose exec -T db psql -U myuser -d hpdavDB < recreate_mv.sql

\echo 'Dropping existing materialized view...'
DROP MATERIALIZED VIEW IF EXISTS trip_coordinates;

\echo 'Creating materialized view with trip_date column...'
\echo '(This may take a few minutes depending on data size)'

CREATE MATERIALIZED VIEW trip_coordinates AS
SELECT 
    t.travelid,
    t.participantid,
    t.purpose::text as purpose,
    t.travelstarttime::date as trip_date,
    EXTRACT(HOUR FROM t.travelstarttime)::int as hour_bucket,
    EXTRACT(DOW FROM t.travelstarttime)::int as day_of_week,
    start_loc.currentlocation[0] as start_x,
    start_loc.currentlocation[1] as start_y,
    end_loc.currentlocation[0] as end_x,
    end_loc.currentlocation[1] as end_y,
    EXTRACT(EPOCH FROM (t.travelendtime - t.travelstarttime))/60 as travel_time_minutes
FROM traveljournal t
LEFT JOIN LATERAL (
    SELECT currentlocation
    FROM participantstatuslogs psl
    WHERE psl.participantid = t.participantid 
      AND psl.timestamp <= t.travelstarttime
      AND psl.currentlocation IS NOT NULL
    ORDER BY psl.timestamp DESC
    LIMIT 1
) start_loc ON true
LEFT JOIN LATERAL (
    SELECT currentlocation
    FROM participantstatuslogs psl
    WHERE psl.participantid = t.participantid 
      AND psl.timestamp >= t.travelendtime
      AND psl.currentlocation IS NOT NULL
    ORDER BY psl.timestamp ASC
    LIMIT 1
) end_loc ON true;

\echo 'Creating indexes...'

CREATE INDEX idx_trip_coords_hour ON trip_coordinates (hour_bucket);
CREATE INDEX idx_trip_coords_dow ON trip_coordinates (day_of_week);
CREATE INDEX idx_trip_coords_purpose ON trip_coordinates (purpose);
CREATE INDEX idx_trip_coords_date ON trip_coordinates (trip_date);
CREATE INDEX idx_trip_coords_start ON trip_coordinates (start_x, start_y) WHERE start_x IS NOT NULL;
CREATE INDEX idx_trip_coords_end ON trip_coordinates (end_x, end_y) WHERE end_x IS NOT NULL;
CREATE INDEX idx_trip_coords_combined ON trip_coordinates (hour_bucket, day_of_week, purpose);
CREATE INDEX idx_trip_coords_date_combined ON trip_coordinates (trip_date, hour_bucket, day_of_week);

\echo 'Analyzing table for query optimization...'
ANALYZE trip_coordinates;

\echo ''
\echo '✓ Materialized view recreated successfully!'
\echo ''

-- Verify
SELECT 
    'trip_coordinates' as view_name,
    COUNT(*) as row_count
FROM trip_coordinates;

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'trip_coordinates'
ORDER BY ordinal_position;
