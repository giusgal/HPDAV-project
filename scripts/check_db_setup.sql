-- ============================================================================
-- Database Diagnostic Script for HPDAV Project
-- Run this script to verify that all required views, indexes, and tables
-- are properly set up for optimal performance.
-- ============================================================================

-- Usage:
-- docker compose exec -T db psql -U myuser -d hpdavDB < check_db_setup.sql

\echo '=============================================='
\echo 'HPDAV Database Diagnostic Report'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Check if materialized view exists
-- ============================================================================
\echo '1. MATERIALIZED VIEW: trip_coordinates'
\echo '----------------------------------------------'

SELECT 
    CASE WHEN EXISTS (
        SELECT 1 FROM pg_matviews WHERE matviewname = 'trip_coordinates'
    ) THEN '✓ EXISTS' ELSE '✗ MISSING - Run setup.sh to create' END as status;

-- Check columns in the materialized view
\echo ''
\echo 'Columns in trip_coordinates:'
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'trip_coordinates'
ORDER BY ordinal_position;

-- Check if trip_date column exists (required for date filtering)
\echo ''
SELECT 
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'trip_coordinates' AND column_name = 'trip_date'
    ) THEN '✓ trip_date column EXISTS (date filtering enabled)' 
    ELSE '✗ trip_date column MISSING - Recreate MV to enable date filtering' END as date_filter_status;

-- Row count
\echo ''
\echo 'Row count in trip_coordinates:'
SELECT COUNT(*) as row_count FROM trip_coordinates;

-- ============================================================================
-- 2. Check indexes on materialized view
-- ============================================================================
\echo ''
\echo '2. INDEXES on trip_coordinates'
\echo '----------------------------------------------'

SELECT 
    indexname,
    CASE WHEN indexname IS NOT NULL THEN '✓' ELSE '✗' END as status
FROM pg_indexes 
WHERE tablename = 'trip_coordinates'
ORDER BY indexname;

-- Expected indexes check
\echo ''
\echo 'Expected indexes status:'

SELECT 'idx_trip_coords_hour' as index_name,
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_trip_coords_hour') 
    THEN '✓ EXISTS' ELSE '✗ MISSING' END as status
UNION ALL
SELECT 'idx_trip_coords_dow',
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_trip_coords_dow') 
    THEN '✓ EXISTS' ELSE '✗ MISSING' END
UNION ALL
SELECT 'idx_trip_coords_purpose',
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_trip_coords_purpose') 
    THEN '✓ EXISTS' ELSE '✗ MISSING' END
UNION ALL
SELECT 'idx_trip_coords_date',
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_trip_coords_date') 
    THEN '✓ EXISTS' ELSE '✗ MISSING (needed for date filtering)' END
UNION ALL
SELECT 'idx_trip_coords_start',
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_trip_coords_start') 
    THEN '✓ EXISTS' ELSE '✗ MISSING' END
UNION ALL
SELECT 'idx_trip_coords_end',
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_trip_coords_end') 
    THEN '✓ EXISTS' ELSE '✗ MISSING' END
UNION ALL
SELECT 'idx_trip_coords_combined',
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_trip_coords_combined') 
    THEN '✓ EXISTS' ELSE '✗ MISSING' END
UNION ALL
SELECT 'idx_trip_coords_date_combined',
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_trip_coords_date_combined') 
    THEN '✓ EXISTS' ELSE '✗ MISSING (needed for date filtering)' END;

-- ============================================================================
-- 3. Check base tables
-- ============================================================================
\echo ''
\echo '3. BASE TABLES'
\echo '----------------------------------------------'

SELECT 
    tablename as table_name,
    '✓ EXISTS' as status
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('traveljournal', 'participantstatuslogs', 'apartments', 'restaurants', 'pubs', 'checkinjournal')
ORDER BY tablename;

-- Row counts for key tables
\echo ''
\echo 'Row counts for key tables:'
SELECT 'traveljournal' as table_name, COUNT(*) as row_count FROM traveljournal
UNION ALL
SELECT 'participantstatuslogs', COUNT(*) FROM participantstatuslogs
UNION ALL
SELECT 'apartments', COUNT(*) FROM apartments
UNION ALL
SELECT 'checkinjournal', COUNT(*) FROM checkinjournal;

-- ============================================================================
-- 4. Check indexes on base tables
-- ============================================================================
\echo ''
\echo '4. INDEXES on participantstatuslogs (critical for LATERAL joins)'
\echo '----------------------------------------------'

SELECT indexname, indexdef
FROM pg_indexes 
WHERE tablename = 'participantstatuslogs'
ORDER BY indexname;

-- ============================================================================
-- 5. Date range in data
-- ============================================================================
\echo ''
\echo '5. DATA DATE RANGES'
\echo '----------------------------------------------'

SELECT 
    'traveljournal' as source,
    MIN(travelstarttime::date) as min_date,
    MAX(travelstarttime::date) as max_date
FROM traveljournal;

SELECT 
    'checkinjournal' as source,
    MIN(timestamp::date) as min_date,
    MAX(timestamp::date) as max_date
FROM checkinjournal;

-- ============================================================================
-- 6. Sample query performance test
-- ============================================================================
\echo ''
\echo '6. QUERY PERFORMANCE TEST'
\echo '----------------------------------------------'
\echo 'Testing a sample flow query (should be < 1 second with proper indexes)...'

\timing on

-- Test query similar to what the API runs
SELECT COUNT(*) as flow_count
FROM trip_coordinates
WHERE start_x IS NOT NULL 
  AND end_x IS NOT NULL
  AND day_of_week BETWEEN 1 AND 5
  AND hour_bucket = 8;

\timing off

-- ============================================================================
-- 7. Recommendations
-- ============================================================================
\echo ''
\echo '7. RECOMMENDATIONS'
\echo '----------------------------------------------'
\echo 'If any indexes are MISSING, run the following SQL:'
\echo ''
\echo 'CREATE INDEX idx_trip_coords_hour ON trip_coordinates (hour_bucket);'
\echo 'CREATE INDEX idx_trip_coords_dow ON trip_coordinates (day_of_week);'
\echo 'CREATE INDEX idx_trip_coords_purpose ON trip_coordinates (purpose);'
\echo 'CREATE INDEX idx_trip_coords_date ON trip_coordinates (trip_date);'
\echo 'CREATE INDEX idx_trip_coords_start ON trip_coordinates (start_x, start_y) WHERE start_x IS NOT NULL;'
\echo 'CREATE INDEX idx_trip_coords_end ON trip_coordinates (end_x, end_y) WHERE end_x IS NOT NULL;'
\echo 'CREATE INDEX idx_trip_coords_combined ON trip_coordinates (hour_bucket, day_of_week, purpose);'
\echo 'CREATE INDEX idx_trip_coords_date_combined ON trip_coordinates (trip_date, hour_bucket, day_of_week);'
\echo 'ANALYZE trip_coordinates;'
\echo ''
\echo 'If trip_date column is MISSING, recreate the materialized view:'
\echo 'Run: docker compose exec -T db psql -U myuser -d hpdavDB < recreate_mv.sql'
\echo ''
\echo '=============================================='
\echo 'End of Diagnostic Report'
\echo '=============================================='
